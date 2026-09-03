import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse, applyWarehouseFilter } from '../_lib/rbac';
import { getAdminClient } from '../_lib/db';
import { handleError } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

// 自动库存预警：
// - 可售库存 = 国内仓实际库存合计 + 海外库存快照
// - out_of_stock：可售 <= 0（断货）
// - low_stock：设置了安全库存阈值且 0 < 可售 < 阈值（低库存）
// - 在途数量单独返回，供前端判断补货在途是否已覆盖缺口
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'inventory.read');
    const supabase = getAdminClient();

    const NULL_UUID = '00000000-0000-0000-0000-000000000000';
    const productsSelect = 'id, sku, name, code, category, safety_stock, overseas_stock, unit_price';
    let productsQ: any;
    if (hasUnrestrictedWarehouse(ctx)) {
      productsQ = supabase.from('products').select(productsSelect).is('deleted_at', null);
    } else {
      // 仓库级隔离（054 一货多仓）：仅对绑定任一当前可见仓库的商品做预警
      const ids = ctx.warehouseIds || [];
      productsQ = supabase
        .from('products')
        .select(productsSelect + ', product_warehouses!inner(warehouse_id)')
        .in('product_warehouses.warehouse_id', ids.length ? ids : [NULL_UUID])
        .is('deleted_at', null);
    }
    const [productsRes, invRes] = await Promise.all([
      productsQ,
      applyWarehouseFilter(supabase.from('inventory').select('product_id, warehouse_id, quantity'), ctx, 'warehouse_id'),
    ]);
    if (productsRes.error) throw productsRes.error;
    if (invRes.error) throw invRes.error;

    // 国内库存按商品聚合
    const domMap = new Map<string, number>();
    for (const r of invRes.data || []) {
      domMap.set(r.product_id, (domMap.get(r.product_id) || 0) + Number(r.quantity || 0));
    }

    // 在途数量（未取消发货单的明细，作为补货在途参考，不参与断货判定）
    let transitMap = new Map<string, number>();
    try {
      const { data: transitRows, error: transitErr } = await supabase
        .from('shipment_items')
        .select('product_id, quantity, shipments!inner(status, deleted_at)')
        .is('shipments.deleted_at', null)
        .neq('shipments.status', 'CANCELLED');
      if (!transitErr) {
        for (const r of transitRows || []) {
          if (!r.shipments) continue;
          transitMap.set(r.product_id, (transitMap.get(r.product_id) || 0) + Number(r.quantity || 0));
        }
      }
    } catch (e) {
      // 在途统计失败不阻塞预警主流程
      console.error('[inventory/alerts] transit query failed:', (e as any)?.message || e);
    }

    const items: any[] = [];
    let outCount = 0;
    let lowCount = 0;
    for (const p of productsRes.data || []) {
      const domestic = domMap.get(p.id) || 0;
      const overseas = Number(p.overseas_stock ?? 0);
      const sellable = domestic + overseas;
      const safety = Number(p.safety_stock ?? 0);
      const transit = transitMap.get(p.id) || 0;

      if (sellable <= 0) {
        outCount += 1;
        items.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          code: p.code,
          category: p.category,
          unit_price: p.unit_price,
          safety_stock: safety,
          domestic_stock: domestic,
          overseas_stock: overseas,
          sellable_stock: sellable,
          in_transit_qty: transit,
          alert_type: 'out_of_stock',
        });
      } else if (safety > 0 && sellable < safety) {
        lowCount += 1;
        items.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          code: p.code,
          category: p.category,
          unit_price: p.unit_price,
          safety_stock: safety,
          domestic_stock: domestic,
          overseas_stock: overseas,
          sellable_stock: sellable,
          in_transit_qty: transit,
          alert_type: 'low_stock',
        });
      }
    }

    // 断货优先，其次按缺口比例排序（缺口 = safety - sellable）
    items.sort((a: any, b: any) => {
      if (a.alert_type !== b.alert_type) return a.alert_type === 'out_of_stock' ? -1 : 1;
      const gapA = a.safety_stock > 0 ? a.safety_stock - a.sellable_stock : 1;
      const gapB = b.safety_stock > 0 ? b.safety_stock - b.sellable_stock : 1;
      return gapB - gapA;
    });

    return res.status(200).json({
      data: {
        summary: {
          total: (productsRes.data || []).length,
          out_of_stock: outCount,
          low_stock: lowCount,
          safe: (productsRes.data || []).length - outCount - lowCount,
        },
        items,
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
