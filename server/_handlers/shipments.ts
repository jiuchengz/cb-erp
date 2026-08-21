import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const itemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  sales_order_id: z.string().uuid().optional(),
});

const createSchema = z.object({
  // 兼容旧调用：tracking_no / items 均可选；新表单走单行字段（旧文件发货模块 11 字段）
  tracking_no: z.string().min(1).max(64).optional(),
  carrier: z.string().max(128).nullable().optional(),
  forwarder_id: z.string().uuid().nullable().optional(),
  items: z.array(itemSchema).min(1).max(200).optional(),
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
  cargo_status: z.string().max(20).nullable().optional(),
  bill_check_status: z.string().max(20).nullable().optional(),
  warehouse_status: z.string().max(100).nullable().optional(),
  actual_warehouse_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  abnormal_penalty: z.string().max(500).nullable().optional(),
  appointment_time: z.string().max(32).nullable().optional(),
  // 调拨发货管理字段
  cargo_code: z.string().max(100).nullable().optional(),
  source: z.enum(['manual', 'transfer']).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'shipment.read');
      const q = parse(paginationSchema, req.query);
      const supabase = getAdminClient();
      const source = typeof req.query.source === 'string' ? req.query.source.trim() : '';
      let select = '*, forwarders(name)';
      if (source) select += ', shipment_items(quantity)';
      let query: any = supabase.from('shipments').select(select, { count: 'exact' });
      if (source) query = query.eq('source', source);
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      if (status) query = query.eq('status', status);
      const cargoStatus = typeof req.query.cargo_status === 'string' ? req.query.cargo_status.trim() : '';
      if (cargoStatus) query = query.eq('cargo_status', cargoStatus);
      const cargoStatusNot = typeof req.query.cargo_status_not === 'string' ? req.query.cargo_status_not.trim() : '';
      if (cargoStatusNot) query = query.neq('cargo_status', cargoStatusNot);
      const trackingNo = typeof req.query.tracking_no === 'string' ? req.query.tracking_no.trim() : '';
      if (trackingNo) query = query.ilike('tracking_no', `%${trackingNo}%`);
      const shippingMode = typeof req.query.shipping_mode === 'string' ? req.query.shipping_mode.trim() : '';
      if (shippingMode) query = query.eq('shipping_mode', shippingMode);
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'shipment.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      const { data: shipment, error } = await supabase
        .from('shipments')
        .insert({
          // 兼容新表单（无 tracking_no 走 shipment_no 兜底）
          tracking_no: body.tracking_no || body.shipment_no,
          carrier: body.carrier ?? null,
          forwarder_id: body.forwarder_id ?? null,
          warehouse_no: body.warehouse_no ?? null,
          ship_date: body.ship_date ?? null,
          shipping_cartons: body.shipping_cartons ?? null,
          shipping_qty: body.shipping_qty ?? null,
          shipping_mode: body.shipping_mode ?? null,
          shipment_no: body.shipment_no ?? null,
          product_code: body.product_code ?? null,
          billable_weight_vol: body.billable_weight_vol ?? null,
          volume_diff: body.volume_diff ?? null,
          billable_amount: body.billable_amount ?? null,
          pull_declare_qty: body.pull_declare_qty ?? null,
          estimated_arrival: body.estimated_arrival ?? null,
          cargo_status: body.cargo_status ?? undefined,
          bill_check_status: body.bill_check_status ?? undefined,
          warehouse_status: body.warehouse_status ?? null,
          actual_warehouse_qty: body.actual_warehouse_qty ?? null,
          abnormal_penalty: body.abnormal_penalty ?? null,
          appointment_time: body.appointment_time ?? null,
          cargo_code: body.cargo_code ?? null,
          source: body.source ?? 'manual',
          created_by: ctx.userId,
        })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`运单号已存在：${body.tracking_no || body.shipment_no}`);
        throw error;
      }

      // 旧调用带 items 则插入明细，新表单（单行字段）跳过
      if (body.items && body.items.length > 0) {
        const { error: itemErr } = await supabase
          .from('shipment_items')
          .insert(
            body.items.map((it) => ({
              shipment_id: shipment.id,
              product_id: it.product_id,
              quantity: it.quantity,
              sales_order_id: it.sales_order_id || null,
            }))
          );
        if (itemErr) {
          await supabase.from('shipments').delete().eq('id', shipment.id);
          throw itemErr;
        }
      }

      await writeAudit(ctx, req, 'create', 'shipment', shipment.id, null, { tracking_no: body.tracking_no || body.shipment_no, items: body.items?.length ?? 0 });
      return res.status(201).json({ data: shipment });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
