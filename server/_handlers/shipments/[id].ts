import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const SHIPMENT_FLOW: Record<string, string[]> = {
  PENDING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

const CARGO_STATUSES = ['in_warehouse', 'transporting', 'arrived_port', 'cleared'] as const;
const BILL_CHECK_STATUSES = ['pending', 'confirmed', 'difference_confirmed', 'difference_pending'] as const;

const updateSchema = z.object({
  status: z.enum(['PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']).optional(),
  forwarder_id: z.string().uuid().nullable().optional(),
  cargo_status: z.enum(CARGO_STATUSES).optional(),
  warehouse_status: z.string().max(100).nullable().optional(),
  actual_warehouse_qty: z.coerce.number().nonnegative().nullable().optional(),
  abnormal_penalty: z.string().max(500).nullable().optional(),
  bill_check_status: z.enum(BILL_CHECK_STATUSES).optional(),
  bill_check_time: z.string().datetime().nullable().optional(),
  appointment_time: z.string().datetime().nullable().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'shipment.read');
      const { data, error } = await supabase.from('shipments').select('*, forwarders(name), shipment_items(*)').eq('id', id).single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw error;
      }
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      requirePermission(ctx, 'shipment.write');
      const body = parse(updateSchema, req.body || {});
      if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');
      const { data: before, error: getErr } = await supabase.from('shipments').select('*, forwarders(name), shipment_items(*)').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw getErr;
      }

      const update: Record<string, unknown> = {};
      if (body.status !== undefined) {
        const allowed = SHIPMENT_FLOW[before.status] || [];
        if (!allowed.includes(body.status)) {
          throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
        }
        update.status = body.status;
      }
      if (body.forwarder_id !== undefined) update.forwarder_id = body.forwarder_id;
      if (body.cargo_status !== undefined) update.cargo_status = body.cargo_status;
      if (body.warehouse_status !== undefined) update.warehouse_status = body.warehouse_status;
      if (body.actual_warehouse_qty !== undefined) update.actual_warehouse_qty = body.actual_warehouse_qty;
      if (body.abnormal_penalty !== undefined) update.abnormal_penalty = body.abnormal_penalty;
      if (body.appointment_time !== undefined) update.appointment_time = body.appointment_time;
      if (body.bill_check_time !== undefined) {
        update.bill_check_time = body.bill_check_time;
      } else if (body.bill_check_status !== undefined && body.bill_check_status !== before.bill_check_status) {
        // 账单核对状态变更时自动记录核对时间
        update.bill_check_time = new Date().toISOString();
      }
      if (body.bill_check_status !== undefined) update.bill_check_status = body.bill_check_status;

      const { data, error } = await supabase.from('shipments').update(update).eq('id', id).select().single();
      if (error) {
        if (error.code === '23503') throw Errors.conflict('关联的货代不存在');
        if (error.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw error;
      }

      await writeAudit(ctx, req, 'update', 'shipment', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'shipment.write');
      const { data: before, error: getErr } = await supabase.from('shipments').select('*').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw getErr;
      }
      const { error } = await supabase.from('shipments').delete().eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'shipment', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
