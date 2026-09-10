// 补货"到货匹配"判定（精确口径，全站唯一实现）
//
// 一张补货单被视为"已到货"的唯一条件：其**每个明细**都存在一条采购拿货记录，满足
//   1) 来货类型为采购来货（purchase_orders.source_type = 'purchase'；历史 NULL 兼容视为采购来货）；
//   2) 该采购单 status ∈ {ARRIVED, RECEIVED}、未软删、receive_date 非空；
//   3) receive_date 晚于"匹配基准日"（= 补货时间 replenishment_time；补货时间为空时回落该单创建日期）；
//   4) 单条记录数量 ≥ 该明细的补货数量（沿用现状口径：单条匹配，不做跨单累计）。
// 只要存在任一明细未匹配，整单即视为"未到货"。
// 日期以 YYYY-MM-DD 字符串比较（字典序 == 时间序），与库中 date 字段口径一致。
import { datePartInTz } from './datetime';

export interface PurchaseRecord {
  receive_date: string;
  quantity: number;
}

export type PurchaseByProduct = Record<string, PurchaseRecord[]>;

// 匹配基准日：补货时间优先；为空时回落该单创建日期（按系统默认时区取日期部分）
export function matchBaseDate(row: any, tz: string): string | null {
  const t = row?.replenishment_time;
  if (typeof t === 'string' && t) return t.slice(0, 10);
  return datePartInTz(row?.created_at, tz);
}

export function isArrivalMatched(
  items: any[],
  purchaseByProduct: PurchaseByProduct,
  baseDate: string | null,
): boolean {
  if (!items.length || !baseDate) return false;
  return items.every((it: any) => {
    const records = purchaseByProduct[it.product_id] || [];
    return records.some(
      (rec) => rec.receive_date > baseDate && rec.quantity >= Number(it.quantity),
    );
  });
}

// 批量加载"商品 -> 采购拿货记录"映射（采购来货、已到货/已收货、未删除、有拿货日期）
export async function loadPurchaseRecordsByProduct(
  supabase: any,
  productIds: string[],
): Promise<PurchaseByProduct> {
  const out: PurchaseByProduct = {};
  if (!productIds.length) return out;
  const { data: purchaseRows, error } = await supabase
    .from('purchase_orders')
    .select('receive_date, source_type, purchase_order_items(product_id, quantity)')
    .in('status', ['ARRIVED', 'RECEIVED'])
    .is('deleted_at', null)
    .not('receive_date', 'is', null);
  if (error) throw error;
  for (const po of purchaseRows || []) {
    // 仅采购来货参与补货联动；调拨拿货 / 补货来货 / 自定义来货不参与
    const poSourceType = po.source_type ?? 'purchase';
    if (poSourceType !== 'purchase') continue;
    for (const it of po.purchase_order_items || []) {
      if (productIds.includes(it.product_id)) {
        (out[it.product_id] = out[it.product_id] || []).push({
          receive_date: po.receive_date,
          quantity: Number(it.quantity),
        });
      }
    }
  }
  return out;
}
