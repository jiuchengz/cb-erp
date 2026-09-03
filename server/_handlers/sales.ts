import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, applyWarehouseFilter, assertWarehouseVisible, hasUnrestrictedWarehouse, loadProductBindings } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const itemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  sku: z.string().max(100).nullable().optional(),
  product_name: z.string().max(200).nullable().optional(),
  quantity: z.coerce.number().positive(),
  unit_price: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
});

const createSchema = z.object({
  order_no: z.string().min(1).max(64),
  customer_id: z.string().uuid().nullable().optional(),
  currency: z.string().max(8).optional(),
  platform: z.string().max(50).nullable().optional(),
  sale_date: z.string().max(20).nullable().optional(),
  // 仓库归属：不传时由明细商品仓库推导；全手工明细必须显式传
  warehouse_id: z.string().uuid().optional(),
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
      let query: any = supabase
        .from('sales_orders')
        .select(
          '*, sales_order_items(product_id, sku, product_name, quantity, unit_price, discount, subtotal, products(id, sku, code, name, link_id, image_text, purchase_cost))',
          { count: 'exact' }
        )
        .is('deleted_at', null);
      // 仓库级隔离：普通账号仅能看到其角色绑定仓库的销售单；super_admin 看全部
      query = applyWarehouseFilter(query, ctx, 'warehouse_id');
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const orderNo = typeof req.query.order_no === 'string' ? req.query.order_no.trim() : '';
      const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
      if (status) query = query.eq('status', status);
      if (orderNo) query = query.ilike('order_no', `%${orderNo}%`);
      if (keyword) {
        const { data: matchedProducts } = await supabase
          .from('products')
          .select('id')
          .or(`link_id.ilike.%${keyword}%,name.ilike.%${keyword}%`)
          .is('deleted_at', null)
          .limit(500);
        const productIds = (matchedProducts || []).map((p: any) => p.id);
        let orderIds: string[] = [];
        if (productIds.length) {
          const { data: matchedItems } = await supabase
            .from('sales_order_items')
            .select('order_id')
            .in('product_id', productIds)
            .limit(1000);
          orderIds = (matchedItems || []).map((it: any) => it.order_id);
        }
        if (orderIds.length) {
          query = query.or(`order_no.ilike.%${keyword}%,id.in.(${orderIds.join(',')})`);
        } else {
          query = query.ilike('order_no', `%${keyword}%`);
        }
      }
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'sales.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      const prodIds = [...new Set(body.items.map((it) => it.product_id).filter((x): x is string => !!x))];
      const { data: prods, error: prodErr } = await supabase.from('products').select('id, sku, name').in('id', prodIds).is('deleted_at', null);
      if (prodErr) throw prodErr;
      const prodMap: Record<string, { sku: string; name: string }> = {};
      (prods || []).forEach((p: any) => { prodMap[p.id] = { sku: p.sku, name: p.name }; });
      if (prodIds.some((id) => !prodMap[id as string])) throw Errors.badRequest('存在无效商品 ID');

      // 一货多仓（054）：商品为公司级主档，明细商品按 product_warehouses 绑定校验。
      // 单据仓库 = 显式 warehouse_id，或明细可见绑定仓交集唯一时自动推导。
      const bindMap = await loadProductBindings(supabase, prodIds);
      const visWh = new Set(ctx.warehouseIds || []);
      const visibleBindsOf = (pid: string) => {
        const all = bindMap.get(pid) || [];
        return hasUnrestrictedWarehouse(ctx) ? all : all.filter((b) => visWh.has(b.warehouse_id));
      };
      for (const id of prodIds) {
        if (visibleBindsOf(id as string).length === 0) {
          throw Errors.forbidden('销售明细商品未绑定当前账号可见仓库');
        }
      }

      let orderWarehouseId = body.warehouse_id ?? null;
      if (!orderWarehouseId) {
        // 无显式仓：取所有明细商品可见绑定仓的交集，交集唯一才可自动归属
        let commonSet: Set<string> | null = null;
        for (const id of prodIds) {
          const ws = new Set(visibleBindsOf(id as string).map((b) => b.warehouse_id));
          if (ws.size === 0) {
            commonSet = new Set<string>();
            break;
          }
          const next = new Set<string>();
          for (const wh of ws) {
            if (commonSet === null || commonSet.has(wh)) next.add(wh);
          }
          commonSet = next;
          if (commonSet.size === 0) break;
        }
        if (commonSet && commonSet.size === 1) orderWarehouseId = [...commonSet][0];
        else if (commonSet && commonSet.size > 1) {
          throw Errors.badRequest('明细商品可归属多个共同仓库，请显式指定销售单仓库');
        }
      }
      if (!orderWarehouseId) throw Errors.badRequest('销售单缺少仓库归属，请指定仓库');
      assertWarehouseVisible(ctx, orderWarehouseId, '该仓库');
      // 单据仓库确定后，所有明细商品必须绑定该仓（多仓模型下单仓销售单）
      for (const id of prodIds) {
        const all = bindMap.get(id as string) || [];
        if (!all.some((b) => b.warehouse_id === orderWarehouseId)) {
          throw Errors.badRequest('销售单仓库与明细商品仓库不一致');
        }
      }

      // 售价按仓存于绑定行 sale_price：明细未显式传价时兜底取单据仓绑定价
      const salePriceMap: Record<string, number> = {};
      for (const [pid, binds] of bindMap) {
        const b = binds.find((x) => x.warehouse_id === orderWarehouseId);
        if (b) salePriceMap[pid] = b.sale_price;
      }

      let total = 0;
      const items = body.items.map((it) => {
        const qty = it.quantity;
        const price = it.unit_price ?? salePriceMap[it.product_id as string] ?? 0;
        const disc = it.discount ?? 0;
        const subtotal = Math.max(0, qty * price - disc);
        total += subtotal;
        const matched = it.product_id ? prodMap[it.product_id] : undefined;
        return {
          product_id: it.product_id ?? null,
          sku: matched?.sku ?? it.sku ?? '',
          product_name: matched?.name ?? it.product_name ?? '',
          quantity: qty,
          unit_price: price,
          discount: disc,
          subtotal,
        };
      });

      const { data: order, error } = await supabase.from('sales_orders').insert({
        order_no: body.order_no,
        customer_id: body.customer_id ?? null,
        currency: body.currency ?? 'CNY',
        platform: body.platform ?? null,
        sale_date: body.sale_date ?? null,
        warehouse_id: orderWarehouseId,
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
