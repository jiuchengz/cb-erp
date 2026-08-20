import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const AFTER_SALES_FLOW: Record<string, string[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'PLATFORM_INTERVENED'],
  APPROVED: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['COMPLETED', 'PLATFORM_INTERVENED'],
  COMPLETED: ['PLATFORM_INTERVENED'],
  REJECTED: [],
  PLATFORM_INTERVENED: ['COMPLETED', 'REJECTED'],
};

const updateSchema = z
  .object({
    status: z
      .enum(['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'PLATFORM_INTERVENED'])
      .optional(),
    result: z.string().max(512).optional(),
  })
  .refine((v) => v.status !== undefined || v.result !== undefined, { message: '至少提供一个更新字段' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'after_sales.read');
      const { data, error } = await supabase
        .from('after_sales')
        .select('*, after_sale_items(*, products(id, name, link_id, image_text))')
        .eq('id', id)
        .single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('售后单不存在');
        throw error;
      }
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      const body = parse(updateSchema, req.body || {});
      const { data: before, error: getErr } = await supabase
        .from('after_sales')
        .select('*, after_sale_items(*, products(id, name, link_id, image_text))')
        .eq('id', id)
        .single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('售后单不存在');
        throw getErr;
      }
      requirePermission(ctx, 'after_sales.write');

      const updatePayload: any = {};
      if (body.result !== undefined) updatePayload.result = body.result;

      const items = before.after_sale_items || [];
      const isStatusUpdate = body.status !== undefined;
      const allowed = AFTER_SALES_FLOW[before.status] || [];
      if (isStatusUpdate && !allowed.includes(body.status!)) {
        throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
      }

      // 售后退货入库：COMPLETED 且类型标记为退货入库(need_stock_in)时入库
      let needStockIn = false;
      if (isStatusUpdate && body.status === 'COMPLETED' && before.status !== 'COMPLETED' && before.warehouse_id) {
        const { data: typeMeta } = await supabase
          .from('after_sale_types')
          .select('need_stock_in')
          .eq('value', before.type)
          .maybeSingle();
        needStockIn = typeMeta?.need_stock_in === true;
        if (needStockIn) {
          for (const it of items) {
            const { error: invErr } = await supabase.rpc('adjust_inventory', {
              p_product_id: it.product_id,
              p_warehouse_id: before.warehouse_id,
              p_quantity: Number(it.quantity),
              p_type: 'after_sales_in',
              p_reference_type: 'after_sale',
              p_reference_id: id,
              p_created_by: ctx.userId,
              p_note: `售后退货入库 ${before.order_no}`,
            });
            if (invErr) throw invErr;
          }
        }
      }

      if (isStatusUpdate) updatePayload.status = body.status;
      const { data, error } = await supabase.from('after_sales').update(updatePayload).eq('id', id).select().single();
      if (error) throw error;

      const action = isStatusUpdate ? (body.status === 'REJECTED' ? 'reject' : body.status!) : 'update';
      await writeAudit(ctx, req, action, 'after_sale', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'after_sales.write');
      const { data: before, error: getErr } = await supabase.from('after_sales').select('*').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('售后单不存在');
        throw getErr;
      }
      const { error } = await supabase.from('after_sales').delete().eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'after_sale', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
