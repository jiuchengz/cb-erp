// "每日未到货"统计采集（精确口径）
//
// 未到货定义：
//   1) 补货单未删除、status ∈ {DRAFT, SUBMITTED, APPROVED, PROCESSING}（即"采购中"，排除 COMPLETED / CANCELLED）；
//   2) 且未通过到货匹配（见 _lib/replenishment-match.ts，精确口径）。
// 时间维度：按"匹配基准日"分组（补货时间；为空时回落该单创建日期，按系统默认时区取日期部分）。
// 数量维度：按明细数量逐条累计；同一（基准日，仓库，商品）合并为一条 cell。
// 说明：本函数只读，不做任何写库动作。
import { getSystemTimezone } from './datetime';
import {
  isArrivalMatched,
  loadPurchaseRecordsByProduct,
  matchBaseDate,
  type PurchaseByProduct,
} from './replenishment-match';

// 候选单状态白名单 == "采购中"全集（与 GET /replenishment 的 PROCESSING 分支一致）
export const UNARRIVED_CANDIDATE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PROCESSING'];

export interface UnarrivedCell {
  group_date: string;
  warehouse_id: string;
  product_id: string;
  sku: string | null;
  code: string | null;
  name: string | null;
  quantity: number;
  item_count: number;
}

export interface UnarrivedResult {
  timezone: string;
  cells: UnarrivedCell[];
  unarrived_order_ids: string[];
  orders_by_date: Record<string, string[]>;
  scanned_orders: number;
  unarrived_orders: number;
  orders_without_items: number;
}

const PAGE = 500;

export async function collectUnarrived(
  supabase: any,
  opts?: { warehouseIds?: string[] | null },
): Promise<UnarrivedResult> {
  const tz = await getSystemTimezone(supabase);
  const whFilter = opts?.warehouseIds;

  // 1) 分页拉取候选单（采购中、未删除），受仓库行级隔离约束
  const orders: any[] = [];
  for (let page = 0; ; page++) {
    let q: any = supabase
      .from('replenishment_orders')
      .select(
        'id, order_no, warehouse_id, status, replenishment_time, created_at, replenish_qty, replenishment_order_items(product_id, quantity, products(sku, code, name))',
      )
      .is('deleted_at', null)
      .in('status', UNARRIVED_CANDIDATE_STATUSES)
      .order('id', { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (Array.isArray(whFilter)) q = q.in('warehouse_id', whFilter);
    const { data, error } = await q;
    if (error) throw error;
    const rows: any[] = data || [];
    orders.push(...rows);
    if (rows.length < PAGE) break;
  }

  // 2) 一次性加载涉及商品的采购拿货记录
  const productIds = Array.from(
    new Set(
      orders.flatMap((o: any) =>
        (o.replenishment_order_items || []).map((it: any) => it.product_id),
      ),
    ),
  ) as string[];
  const purchaseByProduct: PurchaseByProduct = await loadPurchaseRecordsByProduct(supabase, productIds);

  // 3) 逐单判定"未到货"并归集
  const cellMap = new Map<string, UnarrivedCell>();
  const ordersByDate: Record<string, string[]> = {};
  const unarrivedOrderIds: string[] = [];
  let withoutItems = 0;

  for (const o of orders) {
    const items: any[] = o.replenishment_order_items || [];
    if (!items.length) {
      // 存量异常单（无明细）：数量无法归集，仅计数
      withoutItems += 1;
      continue;
    }
    const base = matchBaseDate(o, tz);
    if (!base) {
      withoutItems += 1;
      continue;
    }
    if (isArrivalMatched(items, purchaseByProduct, base)) continue;

    unarrivedOrderIds.push(o.id);
    (ordersByDate[base] = ordersByDate[base] || []).push(o.id);
    for (const it of items) {
      const p: any = it.products || {};
      const key = `${base}|${o.warehouse_id}|${it.product_id}`;
      const cell: UnarrivedCell =
        cellMap.get(key) ||
        {
          group_date: base,
          warehouse_id: o.warehouse_id,
          product_id: it.product_id,
          sku: p.sku ?? null,
          code: p.code ?? null,
          name: p.name ?? null,
          quantity: 0,
          item_count: 0,
        };
      cell.quantity += Number(it.quantity) || 0;
      cell.item_count += 1;
      cellMap.set(key, cell);
    }
  }

  return {
    timezone: tz,
    cells: Array.from(cellMap.values()),
    unarrived_order_ids: unarrivedOrderIds,
    orders_by_date: ordersByDate,
    scanned_orders: orders.length,
    unarrived_orders: unarrivedOrderIds.length,
    orders_without_items: withoutItems,
  };
}

export interface UnarrivedDateGroup {
  date: string;
  order_count: number;
  total_qty: number;
  sku_count: number;
  items: Array<{
    product_id: string;
    sku: string | null;
    code: string | null;
    name: string | null;
    quantity: number;
    item_count: number;
    warehouse_ids: string[];
  }>;
  warehouses: Array<{ warehouse_id: string; total_qty: number; sku_count: number }>;
}

// 全量（跨全部统计日）未到货汇总
export interface UnarrivedAllSummary {
  // 全部统计日的未到货数量合计
  total_qty: number;
  // 跨统计日去重后的涉及商品数
  sku_count: number;
  // 跨统计日去重后的涉及补货单数
  order_count: number;
  // 明细条数合计（未去重）
  item_count: number;
  // 涉及统计日数量
  date_count: number;
}

// 跨全部统计日汇总未到货（SKU 与补货单按跨日去重）
export function summarizeAll(
  cells: UnarrivedCell[],
  ordersByDate: Record<string, string[]>,
): UnarrivedAllSummary {
  const productIds = new Set<string>();
  const orderIds = new Set<string>();
  let totalQty = 0;
  let itemCount = 0;

  for (const c of cells) {
    totalQty += c.quantity;
    itemCount += c.item_count;
    productIds.add(c.product_id);
  }

  const dateSet = new Set<string>(cells.map((c) => c.group_date));
  for (const [date, ids] of Object.entries(ordersByDate)) {
    dateSet.add(date);
    for (const id of ids) orderIds.add(id);
  }

  return {
    total_qty: totalQty,
    sku_count: productIds.size,
    order_count: orderIds.size,
    item_count: itemCount,
    date_count: dateSet.size,
  };
}

// 把 cell 列表按基准日分组、并按商品去重汇总（供统计接口与快照接口复用）
export function groupByDate(cells: UnarrivedCell[], ordersByDate: Record<string, string[]>): UnarrivedDateGroup[] {
  const dates = new Set<string>([...cells.map((c) => c.group_date), ...Object.keys(ordersByDate)]);
  const out: UnarrivedDateGroup[] = [];
  for (const date of dates) {
    const cellsOfDate = cells.filter((c) => c.group_date === date);
    const byProduct = new Map<string, UnarrivedDateGroup['items'][number]>();
    const byWarehouse = new Map<string, { total_qty: number; products: Set<string> }>();
    let totalQty = 0;
    for (const c of cellsOfDate) {
      totalQty += c.quantity;
      const p = byProduct.get(c.product_id);
      if (p) {
        p.quantity += c.quantity;
        p.item_count += c.item_count;
        if (!p.warehouse_ids.includes(c.warehouse_id)) p.warehouse_ids.push(c.warehouse_id);
      } else {
        byProduct.set(c.product_id, {
          product_id: c.product_id,
          sku: c.sku,
          code: c.code,
          name: c.name,
          quantity: c.quantity,
          item_count: c.item_count,
          warehouse_ids: [c.warehouse_id],
        });
      }
      const wh = byWarehouse.get(c.warehouse_id) || { total_qty: 0, products: new Set<string>() };
      wh.total_qty += c.quantity;
      wh.products.add(c.product_id);
      byWarehouse.set(c.warehouse_id, wh);
    }
    out.push({
      date,
      order_count: (ordersByDate[date] || []).length,
      total_qty: totalQty,
      sku_count: byProduct.size,
      items: Array.from(byProduct.values()).sort((a, b) => b.quantity - a.quantity),
      warehouses: Array.from(byWarehouse.entries())
        .map(([warehouse_id, v]) => ({
          warehouse_id,
          total_qty: v.total_qty,
          sku_count: v.products.size,
        }))
        .sort((a, b) => b.total_qty - a.total_qty),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
