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
  unit_price: z.coerce.number().min(0),
});

const createSchema = z.object({
  order_no: z.string().min(1).max(64),
  supplier: z.string().max(128).optional().default(''),
  warehouse_id: z.string().uuid(),
  receive_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items: z.array(itemSchema).min(1).max(200),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'procurement.read');
      const q = parse(paginationSchema, req.query);
      const supabase = getAdminClient();
      let query: any = supabase.from('purchase_orders').select('*', { count: 'exact' });
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      if (status) query = query.eq('status', status);
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'procurement.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      const items = body.items.map((it) => ({
        product_id: it.product_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        received_quantity: 0,
        subtotal: Number((Number(it.quantity) * Number(it.unit_price)).toFixed(2)),
      }));
      const totalAmount = items.reduce((s, it) => s + Number(it.subtotal), 0);

      const { data: order, error } = await supabase
        .from('purchase_orders')
        .insert({
          order_no: body.order_no,
          supplier: body.supplier || null,
          warehouse_id: body.warehouse_id,
          receive_date: body.receive_date || null,
          total_amount: totalAmount,
          created_by: ctx.userId,
        })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`采购单号已存在：${body.order_no}`);
        throw error;
      }

      const { error: itemErr } = await supabase
        .from('purchase_order_items')
        .insert(items.map((it) => ({ order_id: order.id, ...it })));
      if (itemErr) {
        await supabase.from('purchase_orders').delete().eq('id', order.id);
        throw itemErr;
      }

      await writeAudit(ctx, req, 'create', 'purchase_order', order.id, null, { order_no: order.order_no, items: items.length });
      return res.status(201).json({ data: order });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
