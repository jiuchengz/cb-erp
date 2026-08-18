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
  // 拿货新版：仅 ARRIVED（已到货）-> RECEIVED（已入库）
  ARRIVED: ['RECEIVED'],
  // 旧流程兼容保留
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PURCHASING', 'CANCELLED'],
  PURCHASING: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
  PARTIAL: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

const updateSchema = z
  .object({
    status: z
      .enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'PURCHASING', 'PARTIAL', 'RECEIVED', 'CANCELLED', 'ARRIVED'])
      .optional(),
    receive_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    remark: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.receive_date !== undefined || v.remark !== undefined, {
    message: '至少提供一个更新字段',
  });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'procurement.read');
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(*, products(sku, code, name, image_text))')
        .eq('id', id)
        .single();
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
      requirePermission(ctx, 'procurement.write');

      const updatePayload: any = {};
      if (body.receive_date !== undefined) updatePayload.receive_date = body.receive_date;
      if (body.remark !== undefined) updatePayload.remark = body.remark;

      const items = before.purchase_order_items || [];
      const isStatusUpdate = body.status !== undefined;
      const allowed = PURCHASE_FLOW[before.status] || [];
      if (isStatusUpdate && !allowed.includes(body.status!)) {
        throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
      }

      // 采购入库：RECEIVED 时按明细数量入库
      if (isStatusUpdate && body.status === 'RECEIVED' && before.status !== 'RECEIVED') {
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

      if (isStatusUpdate) updatePayload.status = body.status;
      const { data, error } = await supabase.from('purchase_orders').update(updatePayload).eq('id', id).select().single();
      if (error) throw error;

      const action = isStatusUpdate ? (body.status === 'CANCELLED' ? 'cancel' : body.status!) : 'update';
      await writeAudit(ctx, req, action, 'purchase_order', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'procurement.write');
      const { data: before, error: getErr } = await supabase.from('purchase_orders').select('*').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('采购单不存在');
        throw getErr;
      }
      const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'purchase_order', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
