import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const REPLENISHMENT_FLOW: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const updateSchema = z
  .object({
    status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'CANCELLED']).optional(),
    replenish_qty: z.coerce.number().min(0).optional(),
    replenishment_time: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.replenish_qty !== undefined || v.replenishment_time !== undefined, {
    message: '至少提供一个更新字段',
  });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'replenishment.read');
      const { data, error } = await supabase
        .from('replenishment_orders')
        .select('*, replenishment_order_items(product_id, quantity, products(sku, name))')
        .eq('id', id)
        .single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('补货单不存在');
        throw error;
      }
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      const body = parse(updateSchema, req.body || {});
      const { data: before, error: getErr } = await supabase
        .from('replenishment_orders')
        .select('*, replenishment_order_items(*)')
        .eq('id', id)
        .single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('补货单不存在');
        throw getErr;
      }
      requirePermission(ctx, 'replenishment.write');

      const updatePayload: any = {};
      if (body.replenish_qty !== undefined) updatePayload.replenish_qty = body.replenish_qty;
      if (body.replenishment_time !== undefined) updatePayload.replenishment_time = body.replenishment_time;

      const items = before.replenishment_order_items || [];
      const isStatusUpdate = body.status !== undefined;
      const allowed = REPLENISHMENT_FLOW[before.status] || [];
      if (isStatusUpdate && !allowed.includes(body.status!)) {
        throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
      }

      // 补货入库：COMPLETED 时按明细数量入库（内部调整）
      if (isStatusUpdate && body.status === 'COMPLETED' && before.status !== 'COMPLETED') {
        for (const it of items) {
          const { error: invErr } = await supabase.rpc('adjust_inventory', {
            p_product_id: it.product_id,
            p_warehouse_id: before.warehouse_id,
            p_quantity: Number(it.quantity),
            p_type: 'adjustment',
            p_reference_type: 'replenishment_order',
            p_reference_id: id,
            p_created_by: ctx.userId,
            p_note: `补货入库 ${before.order_no}`,
          });
          if (invErr) throw invErr;
        }
      }

      if (isStatusUpdate) updatePayload.status = body.status;
      const { data, error } = await supabase.from('replenishment_orders').update(updatePayload).eq('id', id).select().single();
      if (error) throw error;

      const action = isStatusUpdate ? (body.status === 'CANCELLED' ? 'cancel' : body.status!) : 'update';
      await writeAudit(ctx, req, action, 'replenishment_order', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'replenishment.write');
      const { data: before, error: getErr } = await supabase.from('replenishment_orders').select('*').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('补货单不存在');
        throw getErr;
      }
      const { error } = await supabase.from('replenishment_orders').delete().eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'replenishment_order', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
