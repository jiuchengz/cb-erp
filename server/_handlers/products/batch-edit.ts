import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError } from '../_lib/error';
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
    const { ids, patch, price_mode } = parse(batchEditSchema, req.body || {});
    const supabase = getAdminClient();

    const { data: before, error: selErr } = await supabase
      .from('products')
      .select('id, sku, name, unit_price, category, status, safety_stock')
      .in('id', ids)
      .is('deleted_at', null);
    if (selErr) throw selErr;
    const found = before || [];
    const foundIds = found.map((p: any) => p.id);
    if (!foundIds.length) {
      return res.status(200).json({ ok: true, updated: 0, missing: ids.length });
    }

    // 构造每行更新值：percent 模式仅对 unit_price 生效
    const now = new Date().toISOString();
    const updates = found.map((p: any) => {
      const row: any = {};
      if (patch.unit_price !== undefined) {
        if (price_mode === 'percent') {
          row.unit_price = Math.max(0, Math.round((Number(p.unit_price || 0) * (1 + patch.unit_price / 100)) * 100) / 100);
        } else {
          row.unit_price = patch.unit_price;
        }
      }
      if (patch.category !== undefined) row.category = patch.category;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.safety_stock !== undefined) row.safety_stock = patch.safety_stock;
      if (Object.keys(row).length === 0) return null;
      row.updated_at = now;
      return { id: p.id, ...row };
    }).filter(Boolean) as any[];

    let updatedCount = 0;
    if (updates.length) {
      const { error: upErr } = await supabase.from('products').upsert(updates, { onConflict: 'id' });
      if (upErr) throw upErr;
      updatedCount = updates.length;
    }

    await writeAudit(ctx, req, 'batch_edit', 'product', undefined, found, updates);
    return res.status(200).json({ ok: true, updated: updatedCount, missing: ids.length - foundIds.length });
  } catch (e) {
    return handleError(res, e);
  }
}
