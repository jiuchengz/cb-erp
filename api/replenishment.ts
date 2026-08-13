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
});

const createSchema = z.object({
  order_no: z.string().min(1).max(64),
  warehouse_id: z.string().uuid(),
  items: z.array(itemSchema).min(1).max(200),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'replenishment.read');
      const q = parse(paginationSchema, req.query);
      const supabase = getAdminClient();
      let query: any = supabase.from('replenishment_orders').select('*', { count: 'exact' });
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      if (status) query = query.eq('status', status);
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'replenishment.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      const { data: order, error } = await supabase
        .from('replenishment_orders')
        .insert({
          order_no: body.order_no,
          warehouse_id: body.warehouse_id,
          created_by: ctx.userId,
        })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`补货单号已存在：${body.order_no}`);
        throw error;
      }

      const { error: itemErr } = await supabase
        .from('replenishment_order_items')
        .insert(body.items.map((it) => ({ replenishment_id: order.id, product_id: it.product_id, quantity: it.quantity })));
      if (itemErr) {
        await supabase.from('replenishment_orders').delete().eq('id', order.id);
        throw itemErr;
      }

      await writeAudit(ctx, req, 'create', 'replenishment_order', order.id, null, { order_no: order.order_no, items: body.items.length });
      return res.status(201).json({ data: order });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
