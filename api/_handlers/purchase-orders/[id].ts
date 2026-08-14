import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const PURCHASE_FLOW: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PURCHASING', 'CANCELLED'],
  PURCHASING: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
  PARTIAL: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

const updateSchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'PURCHASING', 'PARTIAL', 'RECEIVED', 'CANCELLED']),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'procurement.read');
      const { data, error } = await supabase.from('purchase_orders').select('*, purchase_order_items(*)').eq('id', id).single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('采购单不存在');
        throw error;
      }
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      const body = parse(updateSchema, req.body || {});
      const { data: before, error: getErr } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(*)')
        .eq('id', id)
        .single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('采购单不存在');
        throw getErr;
      }

      const allowed = PURCHASE_FLOW[before.status] || [];
      if (!allowed.includes(body.status)) {
        throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
      }
      requirePermission(ctx, 'procurement.write');

      const items = before.purchase_order_items || [];

      // 采购入库：RECEIVED 时按明细数量入库
      if (body.status === 'RECEIVED' && before.status !== 'RECEIVED') {
        for (const it of items) {
          const { error: invErr } = await supabase.rpc('adjust_inventory', {
            p_product_id: it.product_id,
            p_warehouse_id: before.warehouse_id,
            p_quantity: Number(it.quantity),
            p_type: 'purchase_in',
            p_reference_type: 'purchase_order',
            p_reference_id: id,
            p_created_by: ctx.userId,
            p_note: `采购入库 ${before.order_no}`,
          });
          if (invErr) throw invErr;
        }
        for (const it of items) {
          await supabase.from('purchase_order_items').update({ received_quantity: it.quantity }).eq('id', it.id);
        }
      }

      const { data, error } = await supabase.from('purchase_orders').update({ status: body.status }).eq('id', id).select().single();
      if (error) throw error;

      await writeAudit(ctx, req, body.status === 'CANCELLED' ? 'cancel' : body.status, 'purchase_order', id, before, data);
      return res.status(200).json({ data });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
