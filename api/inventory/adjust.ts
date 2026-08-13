import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const adjustSchema = z.object({
  product_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  quantity: z.coerce.number(),
  type: z.enum(['purchase_in', 'sales_out', 'transfer_out', 'transfer_in', 'adjustment', 'after_sales_in', 'loss', 'other']),
  reference_type: z.string().max(64).nullable().optional(),
  reference_id: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'inventory.adjust');
    const body = parse(adjustSchema, req.body || {});
    const supabase = getAdminClient();

    const { data, error } = await supabase.rpc('adjust_inventory', {
      p_product_id: body.product_id,
      p_warehouse_id: body.warehouse_id,
      p_quantity: body.quantity,
      p_type: body.type,
      p_reference_type: body.reference_type ?? null,
      p_reference_id: body.reference_id ?? null,
      p_created_by: ctx.userId,
      p_note: body.note ?? null,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('INSUFFICIENT_INVENTORY')) throw Errors.conflict('库存不足');
      if (msg.includes('INVALID_INVENTORY_TYPE')) throw Errors.badRequest('非法的库存变更类型');
      throw error;
    }

    const result = Array.isArray(data) && data.length ? data[0] : null;
    await writeAudit(ctx, req, 'adjust_inventory', 'inventory', body.product_id, null, { ...body, result });
    return res.status(200).json({ ok: true, data: result });
  } catch (e) {
    return handleError(res, e);
  }
}
