import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, applyWarehouseFilter, assertWarehouseVisible, hasUnrestrictedWarehouse, loadProductBindings } from './_lib/rbac';
import { getSystemTimezone } from './_lib/datetime';
import { isArrivalMatched, loadPurchaseRecordsByProduct, matchBaseDate } from './_lib/replenishment-match';
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
  order_no: z.string().min(1).max(64).optional().nullable(),
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
        .select('*, replenishment_order_items(product_id, quantity, products(sku, code, name, image_text))', { count: 'exact' })
        .is('deleted_at', null);
      query = applyWarehouseFilter(query, ctx, 'warehouse_id');
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

      // 采购拿货联动：拿货时间晚于"匹配基准日"（补货时间；补货时间为空时回落该单创建日期）、
      // 且拿货数量能对应上补货数量 -> 自动置为已完成
      const rows = data || [];
      const productIds = Array.from(
        new Set(
          rows.flatMap((r: any) => (r.replenishment_order_items || []).map((it: any) => it.product_id))
        )
      ) as string[];
      // 仅采购来货（source_type='purchase'，历史 NULL 兼容视为采购来货）参与补货联动；
      // 调拨拿货 / 补货来货 / 自定义来货不触发补货单自动完成
      const purchaseByProduct = await loadPurchaseRecordsByProduct(supabase, productIds);

      // 匹配基准日按系统默认时区折算（补货时间为空时回落创建日期）
      const tz = await getSystemTimezone(supabase);
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
        } else {
          row.arrival_date = null;
        }
        const matchBase = matchBaseDate(row, tz);
        const allMatched = isArrivalMatched(items, purchaseByProduct, matchBase);
        // 精确到货标记：供前端与统计助手判定"未到货"（未完成/未取消 且 arrival_matched=false 即未到货）
        row.arrival_matched = allMatched;
        // 自动完成：补货时间为空时不再整段跳过（判定基准回落到 created_at 的日期部分）；
        // 已取消（CANCELLED）/ 已完成（COMPLETED）不改写（COMPLETED 不可逆，避免已取消单被改写）
        if (allMatched && row.status !== 'COMPLETED' && row.status !== 'CANCELLED') {
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

      // 仓库级隔离：只能为本账号可见仓库创建补货单
      assertWarehouseVisible(ctx, body.warehouse_id, '该仓库');
      // 明细商品须可见（一货多仓 054：经 product_warehouses 绑定推导，至少绑定任一可见仓）
      if (!hasUnrestrictedWarehouse(ctx)) {
        const itemIds = [...new Set(body.items.map((it: any) => it.product_id))];
        const bindMap = await loadProductBindings(supabase, itemIds);
        const visible = new Set(ctx.warehouseIds || []);
        for (const pid of itemIds) {
          const binds = bindMap.get(pid) || [];
          const ok = binds.some((b) => visible.has(b.warehouse_id));
          if (!ok) throw Errors.forbidden('补货明细包含无权访问的仓库商品');
        }
      }

      const totalQty = body.items.reduce((s: number, it: any) => s + Number(it.quantity), 0);
      const { data: order, error } = await supabase
        .from('replenishment_orders')
        .insert({
          order_no: body.order_no ?? null,
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
