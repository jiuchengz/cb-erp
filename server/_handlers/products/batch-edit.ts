import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse, assertWarehouseVisible, loadProductBindings } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const batchEditSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  patch: z
    .object({
      unit_price: z.coerce.number().min(0).optional(),
      category: z.string().max(100).nullable().optional(),
      status: z.enum(['active', 'inactive']).optional(),
      safety_stock: z.coerce.number().min(0).optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: '至少提供一个要修改的字段' }),
  // 改价方式：fixed=直接设为该值；percent=在现价基础上按百分比调整（如 10 表示上涨 10%，-5 表示下调 5%）
  price_mode: z.enum(['fixed', 'percent']).optional().default('fixed'),
  // 一货多仓：改价目标仓（售价按仓存于 product_warehouses.sale_price）。
  // 不传=对每个商品的“全部可见绑定仓”改价；传了则仅对该绑定行改价（未绑定该仓的商品改价被跳过，主档其它字段照常）。
  warehouse_id: z.string().uuid().optional(),
});

// 批量编辑商品：单次请求批量改价（固定值/百分比）、改类目、改状态、改安全库存
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'products.write');
    const { ids, patch, price_mode, warehouse_id } = parse(batchEditSchema, req.body || {});
    const supabase = getAdminClient();

    const { data: before, error: selErr } = await supabase
      .from('products')
      .select('id, sku, name, unit_price, category, status, safety_stock')
      .in('id', ids)
      .is('deleted_at', null);
    if (selErr) throw selErr;
    const found = (before || []) as any[];
    const foundIds = found.map((p) => p.id);
    if (!foundIds.length) {
      return res.status(200).json({ ok: true, updated: 0, missing: ids.length });
    }

    // 一货多仓：以绑定表判定可见性。受限账号对某商品至少拥有 1 个可见绑定仓才可编辑
    // （类目/状态/安全库存为公司级主档属性，任一见即可改；改价仅作用于可见绑定行的 sale_price）。
    const bindMap = await loadProductBindings(supabase, foundIds);
    const visWh = hasUnrestrictedWarehouse(ctx) ? null : new Set(ctx.warehouseIds || []);
    if (warehouse_id) assertWarehouseVisible(ctx, warehouse_id, '该仓库');
    // 当前账号可见绑定（super_admin 全量；受限账号仅其绑定仓）
    const allVisibleBindingsOf = (pid: string): any[] => {
      const all = bindMap.get(pid) || [];
      return visWh ? all.filter((b) => visWh.has(b.warehouse_id)) : all;
    };
    // 目标仓限定后仅对目标仓绑定行改价；未指定则作用于全部可见绑定行
    const visibleBindingsOf = (pid: string): any[] => {
      const out = allVisibleBindingsOf(pid);
      return warehouse_id ? out.filter((b) => b.warehouse_id === warehouse_id) : out;
    };
    if (!hasUnrestrictedWarehouse(ctx)) {
      const denied = found.filter((p) => allVisibleBindingsOf(p.id).length === 0);
      if (denied.length) throw Errors.forbidden('批量编辑包含无权访问的仓库商品，已取消');
    }

    // 构造主档更新 + 绑定行价格更新
    const now = new Date().toISOString();
    const mainRows: any[] = [];
    const priceRows: { product_id: string; warehouse_id: string; newPrice: number }[] = [];
    for (const p of found) {
      const binds = visibleBindingsOf(p.id);
      const row: any = {};
      let primaryPrice: number | null = null;
      if (patch.unit_price !== undefined) {
        // 售价按仓存 sale_price：对每个可见绑定行单独定价；主档 unit_price 仅在改价范围包含“主绑定仓（首个可见绑定）”时同步（兼容旧读方），
        // 避免仅改某子仓售价时误覆盖主档售价。
        const allBinds = allVisibleBindingsOf(p.id);
        const touchesPrimary = !warehouse_id || allBinds[0]?.warehouse_id === warehouse_id;
        for (const b of binds) {
          const base = Number(b.sale_price ?? p.unit_price ?? 0);
          const np =
            price_mode === 'percent'
              ? Math.max(0, Math.round(base * (1 + patch.unit_price / 100) * 100) / 100)
              : Math.max(0, patch.unit_price);
          priceRows.push({ product_id: p.id, warehouse_id: b.warehouse_id, newPrice: np });
          if (primaryPrice === null && touchesPrimary) primaryPrice = np;
        }
        if (primaryPrice !== null) row.unit_price = primaryPrice;
      }
      if (patch.category !== undefined) row.category = patch.category;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.safety_stock !== undefined) row.safety_stock = patch.safety_stock;
      if (Object.keys(row).length === 0) continue;
      row.updated_at = now;
      mainRows.push({ id: p.id, ...row });
    }

    let updatedCount = 0;
    if (mainRows.length) {
      const { error: upErr } = await supabase.from('products').upsert(mainRows, { onConflict: 'id' });
      if (upErr) throw upErr;
      updatedCount = mainRows.length;
    }
    // 绑定行售价落库（按仓定价）
    for (const pr of priceRows) {
      const { error: bErr } = await supabase
        .from('product_warehouses')
        .update({ sale_price: pr.newPrice, updated_at: now })
        .eq('product_id', pr.product_id)
        .eq('warehouse_id', pr.warehouse_id);
      if (bErr) throw bErr;
    }

    await writeAudit(ctx, req, 'batch_edit', 'product', undefined, found, { mainRows, priceRows });
    return res.status(200).json({ ok: true, updated: updatedCount, missing: ids.length - foundIds.length });
  } catch (e) {
    return handleError(res, e);
  }
}
