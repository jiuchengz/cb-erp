import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError } from '../_lib/error';
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
      .in('id', ids);
    if (selErr) throw selErr;
    const found = before || [];
    const foundIds = found.map((p: any) => p.id);
    if (foundIds.length) {
      const { error: delErr } = await supabase.from('products').delete().in('id', foundIds);
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
