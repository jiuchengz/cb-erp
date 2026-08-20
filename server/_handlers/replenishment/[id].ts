import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

// 补货单状态：采购中 / 取消采购 / 已完成（采购中兼容存量 DRAFT/SUBMITTED/APPROVED）
const REPLENISHMENT_FLOW: Record<string, string[]> = {
  DRAFT: ['CANCELLED', 'COMPLETED'],
  SUBMITTED: ['CANCELLED', 'COMPLETED'],
  APPROVED: ['CANCELLED', 'COMPLETED'],
  PROCESSING: ['CANCELLED', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

const itemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
});

const updateSchema = z
  .object({
    status: z.enum(['PROCESSING', 'CANCELLED', 'COMPLETED']).optional(),
    replenish_qty: z.coerce.number().min(0).optional(),
    replenishment_time: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    warehouse_id: z.string().uuid().optional(),
    items: z.array(itemSchema).min(1).max(200).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.replenish_qty !== undefined ||
      v.replenishment_time !== undefined ||
      v.warehouse_id !== undefined ||
      v.items !== undefined,
    {
      message: '至少提供一个更新字段',
    }
  );

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
        .select('*, replenishment_order_items(product_id, quantity, products(sku, code, name, image_text))')
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

      const isStatusUpdate = body.status !== undefined;
      if (isStatusUpdate) {
        const allowed = REPLENISHMENT_FLOW[before.status] || [];
        if (!allowed.includes(body.status!)) {
          throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
        }
      }

      const updatePayload: any = {};
      if (body.warehouse_id !== undefined) updatePayload.warehouse_id = body.warehouse_id;
      if (body.replenish_qty !== undefined) updatePayload.replenish_qty = body.replenish_qty;
      if (body.replenishment_time !== undefined) updatePayload.replenishment_time = body.replenishment_time;

      // 编辑字段（非显式状态更新）时，把单子重新置回采购中，由列表接口联动重新判定是否已完成
      const isFieldEdit = !isStatusUpdate && (body.warehouse_id !== undefined || body.replenish_qty !== undefined || body.replenishment_time !== undefined || body.items !== undefined);
      if (isFieldEdit && before.status !== 'PROCESSING' && before.status !== 'DRAFT' && before.status !== 'SUBMITTED' && before.status !== 'APPROVED') {
        updatePayload.status = 'PROCESSING';
      }

      // 明细替换：整单明细重建
      if (body.items !== undefined) {
        const { error: delErr } = await supabase
          .from('replenishment_order_items')
          .delete()
          .eq('replenishment_id', id);
        if (delErr) throw delErr;
        const { error: insErr } = await supabase.from('replenishment_order_items').insert(
          body.items.map((it) => ({ replenishment_id: id, product_id: it.product_id, quantity: it.quantity }))
        );
        if (insErr) throw insErr;
      }

      const items = before.replenishment_order_items || [];

      // 补货入库：仅显式流转到 COMPLETED 时按明细数量入库（自动联动完成不触发，避免与采购拿货重复入库）
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
