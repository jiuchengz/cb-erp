import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requireAnyPermission } from './_lib/rbac';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

// 统计口径说明：
// - 新版无仓库类型字段（国内/海外仓），国内库存按全部库存合计口径；
// - 无在途库存字段（in_transit），海外/在途返回 0；
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

    const supabase = getAdminClient();

    const countAll = async (table: string) => {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    };

    const [productsCount, inventoryRows, shipmentsCount, salesCount, afterSalesCount, recentShipments] =
      await Promise.all([
        countAll('products'),
        supabase.from('inventory').select('quantity'),
        countAll('shipments'),
        countAll('sales_orders'),
        countAll('after_sales'),
        supabase
          .from('shipments')
          .select('id, tracking_no, status, carrier, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

    if (inventoryRows.error) throw inventoryRows.error;
    if (recentShipments.error) throw recentShipments.error;

    const totalStock = (inventoryRows.data || []).reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0);

    return res.status(200).json({
      data: {
        products_count: productsCount,
        domestic_stock: totalStock,
        overseas_stock: 0,
        in_transit_stock: 0,
        shipments_count: shipmentsCount,
        sales_count: salesCount,
        after_sales_count: afterSalesCount,
        recent_shipments: recentShipments.data || [],
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
