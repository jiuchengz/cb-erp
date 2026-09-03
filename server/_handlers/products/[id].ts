import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, assertWarehouseVisible, fetchProductBindingsVisible, loadProductBindings, hasUnrestrictedWarehouse } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const bindingItemSchema = z.object({
  warehouse_id: z.string().uuid(),
  sale_price: z.coerce.number().min(0).optional().default(0),
});

const updateSchema = z.object({
  sku: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(200).optional(),
  barcode: z.string().max(64).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  unit_price: z.coerce.number().min(0).optional(),
  currency: z.string().max(8).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  // [deprecated] 一货多仓后不再"迁移仓库"：仅传 warehouse_id 时按"改绑为该仓"兼容旧调用
  warehouse_id: z.string().uuid().optional(),
  // 一货多仓：传 warehouse_bindings 时全量替换"当前账号可见"的绑定（可空数组=解绑全部可见绑定）；
  // 未传则仅更新主档字段（可见绑定由前端在编辑弹窗内显式提交）。
  warehouse_bindings: z.array(bindingItemSchema).optional(),
  // 老系统 listings 业务字段
  code: z.string().max(255).nullable().optional(),
  listing_time: z.string().max(255).nullable().optional(),
  image_text: z.string().max(255).nullable().optional(),
  link_id: z.string().max(255).nullable().optional(),
  unit: z.string().max(50).optional(),
  remark: z.string().max(1000).nullable().optional(),
  competitor_id: z.string().max(255).nullable().optional(),
  shipping_mode: z.string().max(20).optional(),
  purchase_cost: z.coerce.number().min(0).optional(),
  first_leg_freight: z.coerce.number().min(0).optional(),
  last_mile_delivery_peso: z.coerce.number().min(0).optional(),
  ml_commission_rate: z.coerce.number().min(0).max(1).optional(),
  overseas_stock: z.coerce.number().min(0).optional(),
  safety_stock: z.coerce.number().min(0).optional(),
});

// 抓取商品并校验当前账号经绑定表可见（不可见按不存在处理，防越权枚举）
async function fetchProductVisible(supabase: any, ctx: any, id: string) {
  const { row, bindings } = await fetchProductBindingsVisible(supabase, ctx, id);
  row.bindings = bindings; // 编辑回显：可见绑定明细（超管为全量）
  row.warehouse_ids = bindings.map((b) => b.warehouse_id);
  row.warehouse_count = bindings.length;
  row.sale_price = bindings.length ? bindings[0].sale_price : Number(row.unit_price ?? 0);
  return row;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'products.read');
      const data = await fetchProductVisible(supabase, ctx, id);
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      requirePermission(ctx, 'products.write');
      const body = parse(updateSchema, req.body || {});
      if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');
      // P2 数据规范：字符串字段去首尾空白；可空字段空串归一为 null
      const textKeys = ['sku', 'code', 'link_id', 'name', 'barcode', 'category', 'unit', 'remark', 'competitor_id', 'shipping_mode', 'listing_time', 'image_text', 'currency'];
      const nullableKeys = ['code', 'link_id', 'barcode', 'category', 'remark', 'competitor_id', 'listing_time', 'image_text'];
      const normalized = body as Record<string, unknown>;
      for (const k of textKeys) {
        const val = normalized[k];
        if (typeof val === 'string') {
          const v = val.trim();
          normalized[k] = v === '' && nullableKeys.includes(k) ? null : v;
        }
      }
      const before = await fetchProductVisible(supabase, ctx, id);
      // ===== 一货多仓绑定维护 =====
      // 规则：提交的 warehouse_bindings 只允许包含当前账号可见仓（super_admin 全量）；
      // 受限账号提交绑定全量替换"可见仓"旧绑定，其它仓旧绑定自动保留（防越权解绑）；super_admin 全量替换。
      const fullBeforeBindings = (await loadProductBindings(supabase, [id])).get(id) || [];
      const visibleOldIds: string[] = [];
      const keptInvisible: { warehouse_id: string; sale_price: number }[] = [];
      if (!hasUnrestrictedWarehouse(ctx)) {
        const visWh = new Set(ctx.warehouseIds || []);
        for (const b of fullBeforeBindings) {
          if (visWh.has(b.warehouse_id)) visibleOldIds.push(b.warehouse_id);
          else keptInvisible.push(b);
        }
      } else {
        for (const b of fullBeforeBindings) visibleOldIds.push(b.warehouse_id);
      }

      let nextBindings: { warehouse_id: string; sale_price: number }[] | null = null;

      if (Array.isArray((normalized as any).warehouse_bindings)) {
        const submitted: { warehouse_id: string; sale_price: number }[] = Array.from(
          new Map(
            ((normalized as any).warehouse_bindings as any[]).map((b: any) => [
              b.warehouse_id,
              { warehouse_id: b.warehouse_id, sale_price: Number(b.sale_price ?? 0) },
            ])
          ).values()
        );
        delete (normalized as any).warehouse_bindings;
        // 提交绑定仓库可见性校验（super_admin 放行）
        for (const b of submitted) assertWarehouseVisible(ctx, b.warehouse_id, '该仓库');
        nextBindings = [...keptInvisible, ...submitted];
        if (!nextBindings.length) throw Errors.badRequest('商品至少需保留一个绑定仓库（解绑请先在商品详情内加绑其它仓库）');
      } else if ((normalized as any).warehouse_id !== undefined) {
        // [deprecated] 旧调用迁移仓：改绑为该仓（054 后前端不应再触发）
        const targetWh = (normalized as any).warehouse_id as string;
        delete (normalized as any).warehouse_id;
        assertWarehouseVisible(ctx, targetWh, '该仓库');
        nextBindings = [
          ...keptInvisible.filter((b) => b.warehouse_id !== targetWh),
          { warehouse_id: targetWh, sale_price: Number((normalized as any).unit_price ?? before.unit_price ?? 0) },
        ];
      }

      // 产品编码全库唯一（054：code 不再按仓唯一）
      if ((normalized as any).code && (normalized as any).code !== before.code) {
        const { data: dup } = await supabase
          .from('products')
          .select('id')
          .eq('code', (normalized as any).code)
          .neq('id', id)
          .is('deleted_at', null)
          .limit(1);
        if (dup && dup.length) throw Errors.conflict(`产品编码已存在：${(normalized as any).code}`);
      }

      // 绑定变更时主档兼容字段与"主绑定仓"保持一致（主绑定=提交首仓，未提交则首条保留绑定）
      const appliedBindings: { warehouse_id: string; sale_price: number }[] = nextBindings ?? fullBeforeBindings;
      if (nextBindings) {
        const primary = nextBindings.find((b) => !keptInvisible.some((k) => k.warehouse_id === b.warehouse_id)) || nextBindings[0];
        (normalized as any).warehouse_id = primary.warehouse_id;
        (normalized as any).unit_price = primary.sale_price;
      }

      const { data, error } = await supabase.from('products').update(normalized).eq('id', id).select().single();
      if (error) {
        if (error.code === '23505') {
          // code 冲突已前置校验，此处兜底仅剩 SKU 冲突
          throw Errors.conflict(`SKU 已存在：${(normalized as any).sku || ''}`);
        }
        if (error.code === 'PGRST116') throw Errors.notFound('商品不存在');
        throw error;
      }

      // 绑定行落库：先删被替换的可见旧绑定，再 upsert 合并后绑定
      if (nextBindings) {
        if (visibleOldIds.length) {
          const { error: delErr } = await supabase
            .from('product_warehouses')
            .delete()
            .eq('product_id', id)
            .in('warehouse_id', visibleOldIds);
          if (delErr) throw delErr;
        }
        const bindRows = nextBindings.map((b) => ({ product_id: id, warehouse_id: b.warehouse_id, sale_price: b.sale_price }));
        const { error: insErr } = await supabase.from('product_warehouses').upsert(bindRows);
        if (insErr) throw insErr;
      }

      await writeAudit(ctx, req, 'update', 'product', id, before, { ...data, bindings: appliedBindings });
      return res.status(200).json({ data: { ...data, bindings: appliedBindings } });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'products.delete');
      const before = await fetchProductVisible(supabase, ctx, id);
      // 一货多仓下商品为公司级主档：普通账号仅当其"全部"绑定仓均可见时才允许删除整档，
      // 防止 A 仓用户删除同时绑定其它不可见仓的主档（超管不受限）。
      if (!hasUnrestrictedWarehouse(ctx)) {
        const fullBindings = (await loadProductBindings(supabase, [id])).get(id) || [];
        const whSet = new Set(ctx.warehouseIds || []);
        const allVisible = fullBindings.every((b) => whSet.has(b.warehouse_id));
        if (!allVisible) {
          throw Errors.forbidden('商品已绑定其它仓库，仅可解绑当前仓库，不能删除整档商品');
        }
      }
      // 软删除：置 deleted_at，数据进入回收站
      const { error } = await supabase.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'product', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
