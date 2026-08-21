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

const updateSchema = z.object({
  status: z.enum(['PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']).optional(),
  forwarder_id: z.string().uuid().nullable().optional(),
  cargo_status: z.string().max(20).nullable().optional(),
  warehouse_status: z.string().max(100).nullable().optional(),
  actual_warehouse_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  abnormal_penalty: z.string().max(500).nullable().optional(),
  bill_check_status: z.string().max(20).nullable().optional(),
  bill_check_time: z.string().datetime().nullable().optional(),
  appointment_time: z.string().max(32).nullable().optional(),
  // 新表单字段
  warehouse_no: z.string().max(50).nullable().optional(),
  ship_date: z.string().max(32).nullable().optional(),
  shipping_cartons: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  shipping_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  shipping_mode: z.string().max(20).nullable().optional(),
  shipment_no: z.string().min(1).max(100).nullable().optional(),
  product_code: z.string().max(100).nullable().optional(),
  billable_weight_vol: z.string().max(50).nullable().optional(),
  volume_diff: z.string().max(50).nullable().optional(),
  billable_amount: z.union([z.null(), z.coerce.number()]).optional(),
  pull_declare_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  estimated_arrival: z.string().max(32).nullable().optional(),
  // 调拨发货管理字段
  cargo_code: z.string().max(100).nullable().optional(),
  items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.coerce.number().positive() })).min(1).max(200).optional(),
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
      // 新表单字段
      if (body.warehouse_no !== undefined) update.warehouse_no = body.warehouse_no;
      if (body.ship_date !== undefined) update.ship_date = body.ship_date;
      if (body.shipping_cartons !== undefined) update.shipping_cartons = body.shipping_cartons;
      if (body.shipping_qty !== undefined) update.shipping_qty = body.shipping_qty;
      if (body.shipping_mode !== undefined) update.shipping_mode = body.shipping_mode;
      if (body.shipment_no !== undefined) update.shipment_no = body.shipment_no;
      if (body.product_code !== undefined) update.product_code = body.product_code;
      if (body.billable_weight_vol !== undefined) update.billable_weight_vol = body.billable_weight_vol;
      if (body.volume_diff !== undefined) update.volume_diff = body.volume_diff;
      if (body.billable_amount !== undefined) update.billable_amount = body.billable_amount;
      if (body.pull_declare_qty !== undefined) update.pull_declare_qty = body.pull_declare_qty;
      if (body.estimated_arrival !== undefined) update.estimated_arrival = body.estimated_arrival;
      if (body.cargo_code !== undefined) update.cargo_code = body.cargo_code;

      const { data, error } = await supabase.from('shipments').update(update).eq('id', id).select().single();
      if (error) {
        if (error.code === '23503') throw Errors.conflict('关联的货代不存在');
        if (error.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw error;
      }

      // 明细整体替换：先删旧明细，再插入新明细
      if (body.items && body.items.length > 0) {
        const { error: delErr } = await supabase.from('shipment_items').delete().eq('shipment_id', id);
        if (delErr) throw delErr;
        const { error: insErr } = await supabase
          .from('shipment_items')
          .insert(
            body.items.map((it) => ({
              shipment_id: id,
              product_id: it.product_id,
              quantity: it.quantity,
            }))
          );
        if (insErr) throw insErr;
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
