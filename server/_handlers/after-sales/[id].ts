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
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
};

const updateSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED']),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'after_sales.read');
      const { data, error } = await supabase.from('after_sales').select('*, after_sale_items(*)').eq('id', id).single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('售后单不存在');
        throw error;
      }
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      const body = parse(updateSchema, req.body || {});
      const { data: before, error: getErr } = await supabase.from('after_sales').select('*, after_sale_items(*)').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('售后单不存在');
        throw getErr;
      }

      const allowed = AFTER_SALES_FLOW[before.status] || [];
      if (!allowed.includes(body.status)) {
        throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
      }
      requirePermission(ctx, 'after_sales.write');

      const items = before.after_sale_items || [];

      // 售后退货入库：COMPLETED 且 type=return 时入库
      if (body.status === 'COMPLETED' && before.status !== 'COMPLETED' && before.type === 'return' && before.warehouse_id) {
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

      const { data, error } = await supabase.from('after_sales').update({ status: body.status }).eq('id', id).select().single();
      if (error) throw error;

      await writeAudit(ctx, req, body.status === 'REJECTED' ? 'reject' : body.status, 'after_sale', id, before, data);
      return res.status(200).json({ data });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
