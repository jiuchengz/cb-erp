import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requireAnyPermission } from './_lib/rbac';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';
import { cacheGet, cacheSet } from './_lib/cache';

// 统计口径说明：
// - 国内库存：inventory join warehouses(wh_type='domestic') 的数量合计 + 有库存产品种类数；
// - 国外库存：products.overseas_stock（海外库存快照）+ inventory join warehouses(wh_type='overseas') 的数量合计，产品种类数取两者并集；
// - 在途库存：shipment_items join shipments(source='transfer' 且未入仓、未删除) 的数量合计；
// - 发货动态取 shipments 最近 5 条。
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    requireAnyPermission(ctx, [
      'products.read',
      'inventory.read',
      'sales.read',
      'shipment.read',
      'procurement.read',
      'transfer.read',
      'after_sales.read',
    ]);

    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    // P2 参数化：days(7|30|60|0=今天，默认30) 或 from/to(自定义 YYYY-MM-DD)
    // 时间范围作用于销售/售后/发货计数（created_at）；库存概览无时间维度不受影响。
    const daysRaw = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : 30;
    const days = isFinite(daysRaw) && daysRaw >= 0 ? daysRaw : 30;
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const today = new Date();
    const fmtD = (d: Date) => {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${dd}`;
    };
    const start = from || (() => {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1));
      return fmtD(d);
    })();
    const end = to || fmtD(today);
    const createdAtFrom = `${start}T00:00:00`;
    const createdAtTo = `${end}T23:59:59`;

    // 全量聚合结果短期缓存（key 含时间参数，避免不同口径串缓存）。
    // 内存缓存仅加速热实例，冷启动/多实例会回源，详见 _lib/cache.ts 说明。
    const CACHE_KEY = `dashboard:v1:${start}:${end}`;
    const cached = cacheGet<object>(CACHE_KEY);
    if (cached) {
      return res.status(200).json({ data: cached, fromCache: true });
    }

    const supabase = getAdminClient();

    const countAll = async (table: string) => {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).is('deleted_at', null);
      if (error) throw error;
      return count ?? 0;
    };
    const countSince = async (table: string) => {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .is('deleted_at', null)
        .gte('created_at', createdAtFrom)
        .lte('created_at', createdAtTo);
      if (error) throw error;
      return count ?? 0;
    };

    const [productsCount, inventoryRows, productsRows, inTransitItems, shipmentsCount, salesCount, afterSalesCount, recentShipments] =
      await Promise.all([
        countAll('products'),
        // 全部库存（含仓库类型，区分国内/海外仓）
        supabase.from('inventory').select('product_id, quantity, warehouses!inner(wh_type)'),
        // 产品海外库存快照（用于国外库存统计）
        supabase.from('products').select('id, overseas_stock').is('deleted_at', null),
        // 在途库存：调拨发货（国内→海外）且未入仓的明细数量
        supabase
          .from('shipment_items')
          .select('product_id, quantity, shipments!inner(source, cargo_status, deleted_at)'),
        countSince('shipments'),
        countSince('sales_orders'),
        countSince('after_sales'),
        supabase
          .from('shipments')
          .select('id, tracking_no, status, cargo_status, created_at, forwarder_id, shipping_mode, warehouse_no, shipping_qty, forwarders(name)')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

    if (inventoryRows.error) throw inventoryRows.error;
    if (productsRows.error) throw productsRows.error;
    if (inTransitItems.error) throw inTransitItems.error;
    if (recentShipments.error) throw recentShipments.error;

    // 国内 / 国外库存（总数量 + 产品种类数）
    let domesticStock = 0;
    let overseasInvStock = 0;
    const domesticProducts = new Set<string>();
    const overseasInvProducts = new Set<string>();
    for (const r of inventoryRows.data || []) {
      const qty = Number(r.quantity || 0);
      if (qty <= 0) continue;
      const whType = (r.warehouses as any)?.wh_type;
      if (whType === 'domestic') {
        domesticStock += qty;
        domesticProducts.add(r.product_id);
      } else if (whType === 'overseas') {
        overseasInvStock += qty;
        overseasInvProducts.add(r.product_id);
      }
    }

    // 国外库存快照（products.overseas_stock）
    let overseasSnapshotStock = 0;
    const overseasSnapshotProducts = new Set<string>();
    for (const p of productsRows.data || []) {
      const ovs = Number(p.overseas_stock ?? 0);
      if (ovs > 0) {
        overseasSnapshotStock += ovs;
        overseasSnapshotProducts.add(p.id);
      }
    }

    // 在途库存：仅统计调拨在途（source=transfer）且货物状态非「已入仓」、未删除
    let inTransitStock = 0;
    for (const r of inTransitItems.data || []) {
      const sh = r.shipments as any;
      if (!sh || sh.source !== 'transfer' || sh.deleted_at) continue;
      if (sh.cargo_status && sh.cargo_status === '已入仓') continue;
      inTransitStock += Number(r.quantity || 0);
    }

    const result = {
      period: { start, end },
      products_count: productsCount,
      domestic_stock: Math.round(domesticStock),
      domestic_product_count: domesticProducts.size,
      overseas_stock: Math.round(overseasSnapshotStock + overseasInvStock),
      overseas_product_count: new Set([...overseasSnapshotProducts, ...overseasInvProducts]).size,
      in_transit_stock: Math.round(inTransitStock),
      shipments_count: shipmentsCount,
      sales_count: salesCount,
      after_sales_count: afterSalesCount,
      recent_shipments: recentShipments.data || [],
    };
    cacheSet(CACHE_KEY, result);

    return res.status(200).json({ data: result });
  } catch (e) {
    return handleError(res, e);
  }
}
