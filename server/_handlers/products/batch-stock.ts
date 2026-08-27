import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError } from '../_lib/error';
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
      .select('id, sku, name, overseas_stock')
      .in('id', ids)
      .is('deleted_at', null);
    if (selErr) throw selErr;

    const foundIds = new Set((found || []).map((p: any) => p.id));
    const now = new Date().toISOString();
    const updates = items
      .filter((it: any) => foundIds.has(it.id))
      .map((it: any) => ({ id: it.id, overseas_stock: it.overseas_stock, updated_at: now }));

    let updatedCount = 0;
    if (updates.length) {
      const { error: upErr } = await supabase.from('products').upsert(updates, { onConflict: 'id' });
      if (upErr) throw upErr;
      updatedCount = updates.length;
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
