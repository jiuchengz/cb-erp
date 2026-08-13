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
  unit_price: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
});

const createSchema = z.object({
  order_no: z.string().min(1).max(64),
  customer_id: z.string().uuid().nullable().optional(),
  currency: z.string().max(8).optional(),
  items: z.array(itemSchema).min(1).max(200),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'sales.read');
      const q = parse(paginationSchema, req.query);
      const supabase = getAdminClient();
      let query: any = supabase.from('sales_orders').select('*', { count: 'exact' });
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const orderNo = typeof req.query.order_no === 'string' ? req.query.order_no.trim() : '';
      if (status) query = query.eq('status', status);
      if (orderNo) query = query.ilike('order_no', `%${orderNo}%`);
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'sales.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      const prodIds = [...new Set(body.items.map((it) => it.product_id))];
      const { data: prods, error: prodErr } = await supabase.from('products').select('id, sku').in('id', prodIds);
      if (prodErr) throw prodErr;
      const skuMap: Record<string, string> = {};
      (prods || []).forEach((p: any) => { skuMap[p.id] = p.sku; });
      if (prodIds.some((id) => !skuMap[id])) throw Errors.badRequest('存在无效商品 ID');

      let total = 0;
      const items = body.items.map((it) => {
        const qty = it.quantity;
        const price = it.unit_price ?? 0;
        const disc = it.discount ?? 0;
        const subtotal = Math.max(0, qty * price - disc);
        total += subtotal;
        return { product_id: it.product_id, sku: skuMap[it.product_id], quantity: qty, unit_price: price, discount: disc, subtotal };
      });

      const { data: order, error } = await supabase.from('sales_orders').insert({
        order_no: body.order_no,
        customer_id: body.customer_id ?? null,
        currency: body.currency ?? 'CNY',
        total_amount: total,
        created_by: ctx.userId,
      }).select().single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`订单号已存在：${body.order_no}`);
        throw error;
      }

      const { error: itemErr } = await supabase.from('sales_order_items').insert(
        items.map((it) => ({ order_id: order.id, ...it }))
      );
      if (itemErr) {
        await supabase.from('sales_orders').delete().eq('id', order.id);
        throw itemErr;
      }

      await writeAudit(ctx, req, 'create', 'sales_order', order.id, null, { order_no: order.order_no, total_amount: total, items: items.length });
      return res.status(201).json({ data: order });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
