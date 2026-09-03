import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, assertWarehouseVisible, hasUnrestrictedWarehouse } from '../_lib/rbac';
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

const itemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
});

// 抓取售后单并做仓库可见性校验（不可见按不存在处理，防越权枚举）
async function fetchAfterVisible(supabase: any, ctx: any, id: string) {
  const { data, error } = await supabase
    .from('after_sales')
    .select('*, after_sale_items(*, products(id, name, link_id, image_text))')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (error) {
    if (error.code === 'PGRST116') throw Errors.notFound('售后单不存在');
    throw error;
  }
  if (!hasUnrestrictedWarehouse(ctx) && !(ctx.warehouseIds || []).includes(data.warehouse_id)) {
    throw Errors.notFound('售后单不存在');
  }
  return data;
}

// 明细商品仓库归属校验（超管放行存量无仓商品）
async function assertItemsWarehouseVisible(supabase: any, ctx: any, items: { product_id: string }[]) {
  const prodIds = [...new Set(items.map((it) => it.product_id))];
  const { data: prods } = await supabase.from('products').select('id, warehouse_id').in('id', prodIds).is('deleted_at', null);
  const prodMap: Record<string, string | null | undefined> = {};
  (prods || []).forEach((p: any) => { prodMap[p.id] = p.warehouse_id ?? null; });
  for (const pid of prodIds) {
    const wh = prodMap[pid];
    if (wh === undefined) throw Errors.badRequest('售后明细存在无效商品');
    if (wh) assertWarehouseVisible(ctx, wh, '该仓库的商品');
    else if (!hasUnrestrictedWarehouse(ctx)) throw Errors.forbidden('售后明细商品缺少仓库归属');
  }
}

const updateSchema = z
  .object({
    status: z
      .enum(['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'PLATFORM_INTERVENED'])
      .optional(),
    order_no: z.string().min(1).max(64).optional(),
    type: z.string().min(1).optional(),
    sales_order_id: z.string().uuid().nullable().optional(),
    warehouse_id: z.string().uuid().nullable().optional(),
    reason: z.string().max(256).nullable().optional(),
    result: z.string().max(512).optional(),
    items: z.array(itemSchema).min(1).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少提供一个更新字段' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'after_sales.read');
      const data = await fetchAfterVisible(supabase, ctx, id);
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      const body = parse(updateSchema, req.body || {});
      const before = await fetchAfterVisible(supabase, ctx, id);
      requirePermission(ctx, 'after_sales.write');

      // 类型字典校验（若更新 type）
      if (body.type !== undefined) {
        const { data: typeMeta } = await supabase
          .from('after_sale_types')
          .select('value')
          .eq('value', body.type)
          .maybeSingle();
        if (!typeMeta) throw Errors.badRequest(`未知售后类型：${body.type}`);
      }

      // 仓库级隔离：改退货入库仓须在当前账号可见范围；普通账号不允许将单据改为无仓库归属
      if (body.warehouse_id !== undefined && body.warehouse_id) {
        assertWarehouseVisible(ctx, body.warehouse_id, '该仓库');
      } else if (body.warehouse_id === null && !hasUnrestrictedWarehouse(ctx)) {
        throw Errors.forbidden('无权将售后单改为无仓库归属');
      }

      const updatePayload: any = {};
      if (body.order_no !== undefined) updatePayload.order_no = body.order_no;
      if (body.type !== undefined) updatePayload.type = body.type;
      if (body.sales_order_id !== undefined) updatePayload.sales_order_id = body.sales_order_id;
      if (body.warehouse_id !== undefined) updatePayload.warehouse_id = body.warehouse_id;
      if (body.reason !== undefined) updatePayload.reason = body.reason;
      if (body.result !== undefined) updatePayload.result = body.result;

      // 明细整体替换：先删旧明细，再插入新明细
      if (body.items !== undefined) {
        await assertItemsWarehouseVisible(supabase, ctx, body.items);
        const { error: delItemsErr } = await supabase
          .from('after_sale_items')
          .delete()
          .eq('after_sale_id', id);
        if (delItemsErr) throw delItemsErr;
        const { error: insItemsErr } = await supabase.from('after_sale_items').insert(
          body.items.map((it) => ({ after_sale_id: id, product_id: it.product_id, quantity: it.quantity }))
        );
        if (insItemsErr) throw insItemsErr;
      }

      const items = body.items !== undefined ? body.items : before.after_sale_items || [];
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
      const before = await fetchAfterVisible(supabase, ctx, id);
      // 软删除：置 deleted_at，数据进入回收站
      const { error } = await supabase.from('after_sales').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'after_sale', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
