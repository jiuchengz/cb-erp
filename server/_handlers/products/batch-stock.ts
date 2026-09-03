import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const batchStockSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        overseas_stock: z.coerce.number().min(0),
      })
    )
    .min(1)
    .max(500),
});

// 批量更新海外库存（销售统计导入用）：一次请求更新多个商品的 overseas_stock
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'products.write');
    const { items } = parse(batchStockSchema, req.body || {});
    const supabase = getAdminClient();

    const ids = Array.from(new Set(items.map((it: any) => it.id)));
    const { data: found, error: selErr } = await supabase
      .from('products')
      .select('id, sku, name, overseas_stock, warehouse_id')
      .in('id', ids)
      .is('deleted_at', null);
    if (selErr) throw selErr;

    // 仓库级隔离：普通账号只能更新本账号可见仓库的商品库存，含越权仓库则整批取消
    if (!hasUnrestrictedWarehouse(ctx)) {
      const visible = new Set(ctx.warehouseIds || []);
      const denied = (found || []).filter((p: any) => !visible.has(p.warehouse_id));
      if (denied.length) throw Errors.forbidden('批量更新库存包含无权访问的仓库商品，已取消');
    }

    const foundIds = new Set((found || []).map((p: any) => p.id));
    const now = new Date().toISOString();
    const updates = items
      .filter((it: any) => foundIds.has(it.id))
      .map((it: any) => ({ id: it.id, overseas_stock: it.overseas_stock, updated_at: now }));

    let updatedCount = 0;
    // 批量更新库存语义：只更新已存在的商品，绝不 INSERT 新行。
    // 使用 update 而非 upsert，避免因目标 id 不存在（如外部写入的临时商品已被删除）触发
    // name not-null 的 23502 错误。
    // 按 overseas_stock 值分组，一次 UPDATE 更新所有相同库存值的商品，
    // 将最多 500 次网络往返压缩到「不同库存值个数」次，避免函数超时。
    const groupByStock = new Map<number, string[]>();
    for (const u of updates) {
      const v = Number(u.overseas_stock) || 0;
      if (!groupByStock.has(v)) groupByStock.set(v, []);
      groupByStock.get(v)!.push(u.id);
    }
    for (const [stock, idList] of groupByStock) {
      const { data: upd, error: upErr } = await supabase
        .from('products')
        .update({ overseas_stock: stock, updated_at: now })
        .in('id', idList)
        .is('deleted_at', null)
        .select('id');
      if (upErr) throw upErr;
      updatedCount += (upd || []).length;
    }

    await writeAudit(ctx, req, 'batch_stock', 'product', undefined, null, {
      updated: updatedCount,
      missing: items.length - updatedCount,
    });
    return res.status(200).json({ ok: true, updated: updatedCount, missing: items.length - updatedCount });
  } catch (e) {
    return handleError(res, e);
  }
}
