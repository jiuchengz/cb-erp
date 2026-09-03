import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, applyWarehouseFilter, assertWarehouseVisible, hasUnrestrictedWarehouse } from './_lib/rbac';
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
  sales_order_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  type: z.string().min(1),
  reason: z.string().max(256).optional().default(''),
  result: z.string().max(512).optional().default(''),
  items: z.array(itemSchema).min(1).max(200),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'after_sales.read');
      const q = parse(paginationSchema, req.query);
      const supabase = getAdminClient();
      let query: any = supabase
        .from('after_sales')
        .select('*, after_sale_items(*, products(id, name, link_id, image_text))', { count: 'exact' })
        .is('deleted_at', null);
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      if (status) query = query.eq('status', status);
      query = applyWarehouseFilter(query, ctx, 'warehouse_id');
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'after_sales.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      // 校验类型存在于自定义字典
      const { data: typeMeta } = await supabase.from('after_sale_types').select('value').eq('value', body.type).maybeSingle();
      if (!typeMeta) throw Errors.badRequest(`未知售后类型：${body.type}`);

      // 仓库级隔离：明细商品必须属于账号可见仓库；指定退货入库仓时亦须可见。
      // 超管不受限；商品暂无仓库归属（存量未归仓）时仅放行超管。
      const prodIds = body.items.map((it) => it.product_id);
      const { data: prods } = await supabase.from('products').select('id, warehouse_id').in('id', prodIds).is('deleted_at', null);
      const prodMap: Record<string, string | null | undefined> = {};
      (prods || []).forEach((p: any) => { prodMap[p.id] = p.warehouse_id ?? null; });
      for (const pid of prodIds) {
        const wh = prodMap[pid];
        if (wh === undefined) throw Errors.badRequest('售后明细存在无效商品');
        if (wh) assertWarehouseVisible(ctx, wh, '该仓库的商品');
        else if (!hasUnrestrictedWarehouse(ctx)) throw Errors.forbidden('售后明细商品缺少仓库归属');
      }
      if (body.warehouse_id) assertWarehouseVisible(ctx, body.warehouse_id, '该仓库');

      const { data: order, error } = await supabase
        .from('after_sales')
        .insert({
          order_no: body.order_no,
          sales_order_id: body.sales_order_id || null,
          warehouse_id: body.warehouse_id || null,
          type: body.type,
          reason: body.reason || null,
          result: body.result || null,
          created_by: ctx.userId,
        })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`售后单号已存在：${body.order_no}`);
        throw error;
      }

      const { error: itemErr } = await supabase
        .from('after_sale_items')
        .insert(body.items.map((it) => ({ after_sale_id: order.id, product_id: it.product_id, quantity: it.quantity })));
      if (itemErr) {
        await supabase.from('after_sales').delete().eq('id', order.id);
        throw itemErr;
      }

      await writeAudit(ctx, req, 'create', 'after_sale', order.id, null, { order_no: order.order_no, items: body.items.length });
      return res.status(201).json({ data: order });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
