import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { requirePermission, loadVisibleLinkIds } from '../_lib/rbac';
import { handleError } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';
import { getAdminClient } from '../_lib/db';

/**
 * 销售统计聚合接口：按链接聚合 daily_sales，避免前端全量翻页拉明细再本地聚合。
 * GET /daily-sales/summary?sale_from=&sale_to=&keyword=
 * 返回：
 * {
 *   aggRows: [{ link_id, product_name, platform, quantity, refund_qty, refund_amount,
 *               netQty, netAmount, avg_price, days, latest_date, overseas_stock }],
 *   totals: { sellQty, refundQty, refundAmount, netQty, netAmount, days },
 *   dateSet: string[],
 *   dailyTotals: [{ sale_date, sell_qty, refund_qty, net_qty }]
 * }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    requirePermission(ctx, 'sales.read');
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    const supabase = getAdminClient();
    const saleFrom = typeof req.query.sale_from === 'string' ? req.query.sale_from.trim() : '';
    const saleTo = typeof req.query.sale_to === 'string' ? req.query.sale_to.trim() : '';
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
    const platform = typeof req.query.platform === 'string' ? req.query.platform.trim() : '';
    const adGroup = typeof req.query.ad_group === 'string' ? req.query.ad_group.trim() : '';

    // 仓库级隔离：daily_sales 无 warehouse_id，通过 products.link_id 推导当前账号
    // 可见链接集（super_admin 为 null = 不限制）；受限账号只统计可见仓库的链接。
    const visibleLinks = await loadVisibleLinkIds(supabase, ctx);

    // 循环翻页取全量（服务端取回，网络仅一次 HTTP 往返）
    const PAGE = 1000;
    const all: any[] = [];
    for (let page = 0; ; page++) {
      let query: any = supabase
        .from('daily_sales')
        .select('sale_date, link_id, product_name, platform, quantity, refund_qty, refund_amount, unit_price, overseas_stock');
      if (saleFrom) query = query.gte('sale_date', saleFrom);
      if (saleTo) query = query.lte('sale_date', saleTo);
      if (platform) query = query.eq('platform', platform);
      if (adGroup) query = query.eq('ad_group', adGroup);
      if (keyword) {
        query = query.or(`link_id.ilike.%${keyword}%,product_name.ilike.%${keyword}%`);
      }
      const { data, error } = await query
        .order('sale_date', { ascending: true })
        .order('created_at', { ascending: true })
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      const rows = (data || []).filter((r: any) => !visibleLinks || visibleLinks.has(String(r.link_id || '')));
      all.push(...rows);
      if ((data || []).length < PAGE) break;
    }

    // 与前端一致：按 link_id 聚合
    const map = new Map<string, any>();
    const dateSet = new Set<string>();
    const dailyMap = new Map<string, any>();
    let totalSellQty = 0;
    let totalRefundQty = 0;
    let totalRefundAmount = 0;
    for (const r of all) {
      const key = String(r.link_id || '');
      const d = String(r.sale_date || '');
      if (d) dateSet.add(d);
      const sellQty = Number(r.quantity || 0);
      const refundQty = Number(r.refund_qty || 0);
      const refundAmount = Number(r.refund_amount || 0);
      totalSellQty += sellQty;
      totalRefundQty += refundQty;
      totalRefundAmount += refundAmount;
      // 按日期聚合每日实际销量（日历面板展示用）
      if (d) {
        const dd = dailyMap.get(d) || { sale_date: d, sell_qty: 0, refund_qty: 0, refund_amount: 0 };
        dd.sell_qty += sellQty;
        dd.refund_qty += refundQty;
        dd.refund_amount += refundAmount;
        dailyMap.set(d, dd);
      }
      const cur = map.get(key) || {
        link_id: key,
        product_name: r.product_name || '',
        platform: r.platform || '',
        quantity: 0,
        refund_qty: 0,
        refund_amount: 0,
        unit_price: 0,
        days: new Set<string>(),
        latest_date: '',
        overseas_stock: null as any,
      };
      cur.quantity += sellQty;
      cur.refund_qty += refundQty;
      cur.refund_amount += refundAmount;
      if (Number(r.unit_price || 0) > 0) cur.unit_price = Number(r.unit_price);
      cur.days.add(d);
      if (!cur.latest_date || d > cur.latest_date) {
        cur.latest_date = d;
        cur.overseas_stock = r.overseas_stock != null ? Number(r.overseas_stock) : null;
        if (r.product_name) cur.product_name = r.product_name;
        if (r.platform) cur.platform = r.platform;
      }
      map.set(key, cur);
    }

    const aggRows: any[] = [];
    let totalNetAmount = 0;
    for (const v of map.values()) {
      v.netQty = v.quantity - v.refund_qty;
      // 实际销售额只按实际销量 × 单价计算
      v.netAmount = v.netQty * v.unit_price;
      totalNetAmount += v.netAmount;
      aggRows.push({
        ...v,
        days: v.days.size,
        avg_price: v.netQty > 0 ? Number((v.netAmount / v.netQty).toFixed(2)) : null,
      });
      delete v.days;
    }

    const dailyTotals = Array.from(dailyMap.values())
      .map((d: any) => ({
        sale_date: d.sale_date,
        sell_qty: d.sell_qty,
        refund_qty: d.refund_qty,
        net_qty: d.sell_qty - d.refund_qty,
      }))
      .sort((a: any, b: any) => (a.sale_date < b.sale_date ? -1 : 1));

    return res.status(200).json({
      aggRows,
      totals: {
        sellQty: totalSellQty,
        refundQty: totalRefundQty,
        refundAmount: totalRefundAmount,
        netQty: totalSellQty - totalRefundQty,
        netAmount: totalNetAmount,
        days: dateSet.size,
      },
      dateSet: Array.from(dateSet),
      dailyTotals,
    });
  } catch (e) {
    return handleError(res, e);
  }
}
