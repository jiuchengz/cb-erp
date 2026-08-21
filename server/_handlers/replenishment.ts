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
  replenish_qty: z.coerce.number().min(0).optional(),
  replenishment_time: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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
      let query: any = supabase
        .from('replenishment_orders')
        .select('*, replenishment_order_items(product_id, quantity, products(sku, code, name, image_text))', { count: 'exact' });
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      if (status === 'PROCESSING') {
        // 采购中：兼容存量 DRAFT/SUBMITTED/APPROVED/PROCESSING 各状态
        query = query.in('status', ['DRAFT', 'SUBMITTED', 'APPROVED', 'PROCESSING']);
      } else if (status) {
        query = query.eq('status', status);
      }
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;

      // 采购拿货联动：拿货时间晚于补货时间、且拿货数量能对应上补货数量 -> 自动置为已完成
      const rows = data || [];
      const productIds = Array.from(
        new Set(
          rows.flatMap((r: any) => (r.replenishment_order_items || []).map((it: any) => it.product_id))
        )
      ) as string[];
      const purchaseByProduct: Record<string, { receive_date: string; quantity: number }[]> = {};
      if (productIds.length) {
        const { data: purchaseRows, error: purchaseErr } = await supabase
          .from('purchase_orders')
          .select('receive_date, purchase_order_items(product_id, quantity)')
          .in('status', ['ARRIVED', 'RECEIVED'])
          .not('receive_date', 'is', null);
        if (purchaseErr) throw purchaseErr;
        for (const po of purchaseRows || []) {
          for (const it of po.purchase_order_items || []) {
            if (productIds.includes(it.product_id)) {
              (purchaseByProduct[it.product_id] = purchaseByProduct[it.product_id] || []).push({
                receive_date: po.receive_date,
                quantity: Number(it.quantity),
              });
            }
          }
        }
      }

      const completedIds: string[] = [];
      for (const row of rows) {
        const items = row.replenishment_order_items || [];
        // 到货时间：取首个明细产品在采购拿货中最晚的拿货日期
        const firstItem = items[0];
        if (firstItem) {
          const records = purchaseByProduct[firstItem.product_id] || [];
          if (records.length) {
            row.arrival_date = records.map((r: any) => r.receive_date).sort().slice(-1)[0] || null;
          } else {
            row.arrival_date = null;
          }
        }
        const replenishTime = row.replenishment_time;
        if (!items.length || !replenishTime) continue;
        const allMatched = items.every((it: any) => {
          const records = purchaseByProduct[it.product_id] || [];
          return records.some(
            (rec) => rec.receive_date > replenishTime && rec.quantity >= Number(it.quantity)
          );
        });
        if (allMatched && row.status !== 'COMPLETED') {
          completedIds.push(row.id);
          row.status = 'COMPLETED';
        }
      }
      if (completedIds.length) {
        await supabase.from('replenishment_orders').update({ status: 'COMPLETED' }).in('id', completedIds);
      }

      return res.status(200).json({ data: rows, total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'replenishment.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      const totalQty = body.items.reduce((s: number, it: any) => s + Number(it.quantity), 0);
      const { data: order, error } = await supabase
        .from('replenishment_orders')
        .insert({
          order_no: body.order_no,
          warehouse_id: body.warehouse_id,
          created_by: ctx.userId,
          replenish_qty: body.replenish_qty ?? totalQty,
          replenishment_time: body.replenishment_time ?? null,
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
