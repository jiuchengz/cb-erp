import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse, applyWarehouseFilter } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

// 拿货记录版创建：只填产品编码 + 数量（+ 可选拿货日期 / 入库仓库）
const createSchema = z.object({
  product_code: z.string().min(1).max(64),
  quantity: z.coerce.number().positive(),
  receive_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  warehouse_id: z.string().uuid().optional(),
  remark: z.string().max(500).optional(),
  source_type: z.string().max(50).optional(),
});

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function genOrderNo(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `CG-${y}${m}${day}-${rand}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'procurement.read');
      const q = parse(paginationSchema, req.query);
      const supabase = getAdminClient();
      let query: any = supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(*, products(sku, code, name, image_text))', { count: 'exact' })
        .is('deleted_at', null);
      query = applyWarehouseFilter(query, ctx); // 受限账号仅可见其绑定仓库的拿货单
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

      // 按产品编码匹配商品
      const { data: product, error: prodErr } = await supabase
        .from('products')
        .select('id, sku, code, name')
        .eq('code', body.product_code.trim())
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (prodErr) throw prodErr;
      if (!product) throw Errors.conflict(`产品编码不存在：${body.product_code.trim()}`);

      // 仓库：指定时校验必须是国内仓；未指定取第一个国内仓
      // 受限账号：必须显式选择自己有可见权限的仓库（不可回退到系统默认国内仓）
      if (!hasUnrestrictedWarehouse(ctx)) {
        const visSet = new Set(ctx.warehouseIds || []);
        if (!body.warehouse_id || !visSet.has(body.warehouse_id)) {
          throw Errors.forbidden('您没有该仓库的拿货权限，请选择可见仓库');
        }
      }
      let warehouseId: string;
      if (body.warehouse_id) {
        const { data: wh, error: whErr } = await supabase
          .from('warehouses')
          .select('id, wh_type')
          .eq('id', body.warehouse_id)
          .maybeSingle();
        if (whErr) throw whErr;
        if (!wh) throw Errors.conflict('仓库不存在');
        if (wh.wh_type !== 'domestic') throw Errors.conflict('拿货只能选择国内仓库入库');
        warehouseId = wh.id;
      } else {
        const { data: warehouse, error: whErr } = await supabase
          .from('warehouses')
          .select('id')
          .eq('wh_type', 'domestic')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (whErr) throw whErr;
        if (!warehouse) throw Errors.conflict('暂无国内仓库，请先创建国内仓库');
        warehouseId = warehouse.id;
      }

      const receiveDate = body.receive_date || todayStr();
      const orderNo = genOrderNo();

      const { data: order, error: orderErr } = await supabase
        .from('purchase_orders')
        .insert({
          order_no: orderNo,
          supplier: null,
          warehouse_id: warehouseId,
          receive_date: receiveDate,
          remark: body.remark || null,
          status: 'ARRIVED', // 新增拿货默认待入库；入库由流转/批量入库置 RECEIVED 时执行
          source_type: body.source_type || 'purchase',
          total_amount: 0,
          created_by: ctx.userId,
        })
        .select()
        .single();
      if (orderErr) {
        if (orderErr.code === '23505') {
          // 单号碰撞，重试一次
          const retryNo = genOrderNo();
          const { data: retryOrder, error: retryErr } = await supabase
            .from('purchase_orders')
            .insert({
              order_no: retryNo,
              supplier: null,
              warehouse_id: warehouseId,
              receive_date: receiveDate,
              remark: body.remark || null,
              status: 'ARRIVED', // 新增拿货默认待入库
              source_type: body.source_type || 'purchase',
              total_amount: 0,
              created_by: ctx.userId,
            })
            .select()
            .single();
          if (retryErr) throw retryErr;
          const { error: itemErr2 } = await supabase.from('purchase_order_items').insert({
            order_id: retryOrder.id,
            product_id: product.id,
            quantity: body.quantity,
            received_quantity: 0,
            unit_price: 0,
            subtotal: 0,
          });
          if (itemErr2) {
            await supabase.from('purchase_orders').delete().eq('id', retryOrder.id);
            throw itemErr2;
          }
          // 新增拿货默认待入库，不自动入库；入库由流转/批量入库入口执行
          await writeAudit(ctx, req, 'create', 'purchase_order', retryOrder.id, null, {
            order_no: retryOrder.order_no,
            product_code: body.product_code.trim(),
            quantity: body.quantity,
          });
          return res.status(201).json({ data: retryOrder });
        }
        throw orderErr;
      }

      const { error: itemErr } = await supabase.from('purchase_order_items').insert({
        order_id: order.id,
        product_id: product.id,
        quantity: body.quantity,
        received_quantity: 0,
        unit_price: 0,
        subtotal: 0,
      });
      if (itemErr) {
        await supabase.from('purchase_orders').delete().eq('id', order.id);
        throw itemErr;
      }

      // 此处不再自动入库：新增拿货默认待入库（ARRIVED），
      // 库存入库由流转（ARRIVED->RECEIVED）或批量入库入口统一执行。

      await writeAudit(ctx, req, 'create', 'purchase_order', order.id, null, {
        order_no: order.order_no,
        product_code: body.product_code.trim(),
        quantity: body.quantity,
      });
      return res.status(201).json({ data: order });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
