import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse, loadProductBindings } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// 批量删除商品：单次请求删除多条（in 查询），避免前端逐条串行调用
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'products.delete');
    const { ids } = parse(batchDeleteSchema, req.body || {});
    const supabase = getAdminClient();

    const { data: before, error: selErr } = await supabase
      .from('products')
      .select('id, sku, name')
      .in('id', ids)
      .is('deleted_at', null);
    if (selErr) throw selErr;
    const found = (before || []) as any[];
    const foundIds = found.map((p) => p.id);
    // 一货多仓：商品为公司级主档。受限账号仅当其"全部"绑定仓均可见时才可删除整档，
    // 含任一不可见绑定仓则整批取消（防 A 仓用户删除同时绑定了其它仓的主档）。
    if (foundIds.length && !hasUnrestrictedWarehouse(ctx)) {
      const bindMap = await loadProductBindings(supabase, foundIds);
      const visWh = new Set(ctx.warehouseIds || []);
      const denied = found.filter((p) => {
        const binds = bindMap.get(p.id) || [];
        return binds.length === 0 || binds.some((b) => !visWh.has(b.warehouse_id));
      });
      if (denied.length) throw Errors.forbidden('批量删除包含同时绑定其它仓库的商品，已取消');
    }
    if (foundIds.length) {
      // 软删除：置 deleted_at，数据进入回收站
      const { error: delErr } = await supabase.from('products').update({ deleted_at: new Date().toISOString() }).in('id', foundIds);
      if (delErr) throw delErr;
    }
    // 汇总审计（一次写入，避免逐条写导致慢）
    await writeAudit(ctx, req, 'batch_delete', 'product', undefined, found, null);
    return res
      .status(200)
      .json({ ok: true, deleted: foundIds.length, missing: ids.length - foundIds.length });
  } catch (e) {
    return handleError(res, e);
  }
}
