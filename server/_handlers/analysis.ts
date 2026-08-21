import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requireAnyPermission } from './_lib/rbac';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

// ============================================================
// 经营分析接口 /analysis
// 数据源：
//   - daily_sales：销售统计（销售额/销量/退款/平台/热销/新品/趋势）
//   - shipments：发货量/在途/货代/发货量TOP（shipment_items 明细）
//   - inventory + warehouses(wh_type='domestic')：国内库存/在库时长
//   - products：安全库存/成本
//   - after_sales：售后率/售后原因分布
// 参数：days(7|30|60|0=今天，默认30) 或 from/to(自定义 YYYY-MM-DD)
// ============================================================

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmt(d);
}
function diffDays(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}
function num(v: any): number {
  const n = Number(v || 0);
  return isFinite(n) ? n : 0;
}
function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
function ceilN(v: number): number {
  return Math.ceil(v);
}

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

    const daysRaw = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : 30;
    const days = isFinite(daysRaw) && daysRaw >= 0 ? daysRaw : 30;
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const today = fmt(new Date());

    let start = from || addDays(today, -(days - 1));
    let end = to || today;
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }
    const n = diffDays(start, end) + 1;
    const prevEnd = addDays(start, -1);
    const prevStart = addDays(prevEnd, -(n - 1));

    // ---------- 1. daily_sales：本期 + 上期 ----------
    const salesSelect = 'sale_date, platform, link_id, product_name, quantity, refund_qty, refund_amount, unit_price';
    const [curSales, prevSales] = await Promise.all([
      supabase.from('daily_sales').select(salesSelect).gte('sale_date', start).lte('sale_date', end),
      supabase.from('daily_sales').select(salesSelect).gte('sale_date', prevStart).lte('sale_date', prevEnd),
    ]);
    if (curSales.error) throw curSales.error;
    if (prevSales.error) throw prevSales.error;
    const curRows = curSales.data || [];
    const prevRows = prevSales.data || [];

    const summarize = (rows: any[]) => {
      let qty = 0;
      let refundQty = 0;
      let refundAmount = 0;
      let amount = 0;
      for (const r of rows) {
        const q = num(r.quantity);
        const rq = num(r.refund_qty);
        const ra = num(r.refund_amount);
        qty += q;
        refundQty += rq;
        refundAmount += ra;
        amount += q * num(r.unit_price) - ra;
      }
      return { qty, refundQty, refundAmount, amount };
    };
    const curSum = summarize(curRows);
    const prevSum = summarize(prevRows);

    // 平台分布（净销量 = 销售 - 退款）
    const platformMap = new Map<string, number>();
    for (const r of curRows) {
      const k = r.platform || '未分类';
      platformMap.set(k, (platformMap.get(k) || 0) + num(r.quantity) - num(r.refund_qty));
    }
    const platforms = Array.from(platformMap.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);

    // 热销 TOP5 / 潜力新品榜（按 link_id 聚合）
    const linkMap = new Map<string, { name: string; qty: number; refundQty: number }>();
    for (const r of curRows) {
      const k = r.link_id || 'unknown';
      const cur = linkMap.get(k) || { name: r.product_name || '', qty: 0, refundQty: 0 };
      cur.qty += num(r.quantity);
      cur.refundQty += num(r.refund_qty);
      if (!cur.name && r.product_name) cur.name = r.product_name;
      linkMap.set(k, cur);
    }
    const prevLinkMap = new Map<string, number>();
    for (const r of prevRows) {
      const k = r.link_id || 'unknown';
      prevLinkMap.set(k, (prevLinkMap.get(k) || 0) + num(r.quantity) - num(r.refund_qty));
    }

    const hotTop = Array.from(linkMap.entries())
      .map(([linkId, v]) => ({
        link_id: linkId,
        name: v.name || linkId,
        qty: Math.round(v.qty - v.refundQty),
      }))
      .filter((x) => x.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    const newRise = Array.from(linkMap.entries())
      .map(([linkId, v]) => {
        const curQty = Math.round(v.qty - v.refundQty);
        const prevQty = Math.round(prevLinkMap.get(linkId) || 0);
        let rise = 0;
        if (prevQty > 0) rise = ((curQty - prevQty) / prevQty) * 100;
        else if (curQty > 0) rise = 100; // 上期无销量视为新品
        return { link_id: linkId, name: v.name || linkId, qty: curQty, prevQty, rise: Math.round(rise) };
      })
      .filter((x) => x.qty > 0)
      .sort((a, b) => b.rise - a.rise)
      .slice(0, 4);

    // ---------- 2. shipments：发货量 / 发货趋势 / 在途 / 发货量TOP ----------
    const shipSelect = 'ship_date, shipping_qty, cargo_status, source, shipment_no, product_code, shipment_items(product_id, quantity), forwarders(name)';
    const [curShipments, prevShipments, inTransitRows, domShipItems] = await Promise.all([
      supabase.from('shipments').select('ship_date, shipping_qty').gte('ship_date', start).lte('ship_date', end),
      supabase.from('shipments').select('ship_date, shipping_qty').gte('ship_date', prevStart).lte('ship_date', prevEnd),
      supabase
        .from('shipments')
        .select(shipSelect)
        .eq('source', 'transfer')
        .neq('cargo_status', '已入仓')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('shipment_items')
        .select('product_id, quantity, shipments!inner(ship_date)')
        .gte('shipments.ship_date', start)
        .lte('shipments.ship_date', end),
    ]);
    if (curShipments.error) throw curShipments.error;
    if (prevShipments.error) throw prevShipments.error;
    if (inTransitRows.error) throw inTransitRows.error;
    if (domShipItems.error) throw domShipItems.error;

    let shipQty = 0;
    let prevShipQty = 0;
    for (const r of curShipments.data || []) shipQty += num(r.shipping_qty);
    for (const r of prevShipments.data || []) prevShipQty += num(r.shipping_qty);

    // 在途货件：按货件号去重 + 产品名称
    const inTransitList: any[] = [];
    const seenTrack = new Set<string>();
    for (const s of inTransitRows.data || []) {
      const key = s.shipment_no || s.tracking_no || s.id;
      if (seenTrack.has(key)) continue;
      seenTrack.add(key);
      inTransitList.push({
        shipment_no: s.shipment_no || s.product_code || '',
        product_code: s.product_code || '',
        cargo_status: s.cargo_status || '转运中',
        shipping_qty: Math.round(num(s.shipping_qty)),
        forwarder: s.forwarders?.name || '',
      });
    }

    // 发货量TOP（按产品聚合 shipment_items.quantity）
    const domShipMap = new Map<string, number>();
    for (const it of domShipItems.data || []) {
      const pid = it.product_id;
      if (!pid) continue;
      domShipMap.set(pid, (domShipMap.get(pid) || 0) + num(it.quantity));
    }
    const domShipTopRaw = Array.from(domShipMap.entries())
      .map(([pid, q]) => ({ product_id: pid, qty: Math.round(q) }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // ---------- 3. products + 国内库存 ----------
    const [productsRows, domInvRows] = await Promise.all([
      supabase.from('products').select('id, sku, name, link_id, safety_stock, overseas_stock, purchase_cost'),
      supabase
        .from('inventory')
        .select('product_id, quantity, created_at, warehouses!inner(wh_type)')
        .eq('warehouses.wh_type', 'domestic')
        .gt('quantity', 0),
    ]);
    if (productsRows.error) throw productsRows.error;
    if (domInvRows.error) throw domInvRows.error;

    const productById = new Map<string, any>();
    for (const p of productsRows.data || []) productById.set(p.id, p);

    const domStockMap = new Map<string, number>();
    const domAgeMap = new Map<string, string>(); // product_id -> 最早入库时间
    for (const inv of domInvRows.data || []) {
      const pid = inv.product_id;
      if (!pid) continue;
      domStockMap.set(pid, (domStockMap.get(pid) || 0) + num(inv.quantity));
      const t = inv.created_at;
      if (t) {
        const cur = domAgeMap.get(pid);
        if (!cur || t < cur) domAgeMap.set(pid, t);
      }
    }

    // 库存预警：低库存（安全库存>0 且 国内库存 < 安全库存）
    const lowStock: any[] = [];
    let safetyTotal = 0;
    let safetyPass = 0;
    for (const p of productsRows.data || []) {
      const safety = num(p.safety_stock);
      if (safety <= 0) continue;
      safetyTotal += 1;
      const dom = domStockMap.get(p.id) || 0;
      if (dom >= safety) safetyPass += 1;
      if (dom < safety) {
        lowStock.push({
          product_id: p.id,
          name: p.name,
          sku: p.sku,
          stock: Math.round(dom),
          safety_stock: Math.round(safety),
          gap: Math.round(safety - dom),
        });
      }
    }
    lowStock.sort((a, b) => b.gap - a.gap);

    // 补货建议：按日均销 + 安全库存，补至 2 倍安全库存
    const linkToProduct = new Map<string, any>();
    for (const p of productsRows.data || []) {
      if (p.link_id) linkToProduct.set(p.link_id, p);
    }
    const replenish: any[] = [];
    for (const p of productsRows.data || []) {
      const safety = num(p.safety_stock);
      if (safety <= 0) continue;
      const dom = domStockMap.get(p.id) || 0;
      if (dom >= safety * 2) continue;
      const daily = p.link_id ? (linkMap.get(p.link_id)?.qty || 0) / n : 0;
      const suggest = ceilN(Math.max(0, safety * 2 - dom));
      const daysLeft = daily > 0 ? Math.floor(dom / daily) : null;
      replenish.push({
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        stock: Math.round(dom),
        safety_stock: Math.round(safety),
        daily: Math.round(daily * 100) / 100,
        suggest,
        daysLeft,
      });
    }
    replenish.sort((a, b) => (b.daily - a.daily) || (b.suggest - a.suggest));

    // 国内库存分析：在库时长 TOP（最早入库）
    const domAgeTop = Array.from(domAgeMap.entries())
      .filter(([pid]) => (domStockMap.get(pid) || 0) > 0)
      .map(([pid, t]) => {
        const days = Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000));
        return { product_id: pid, name: productById.get(pid)?.name || '', stock: Math.round(domStockMap.get(pid) || 0), days };
      })
      .sort((a, b) => b.days - a.days)
      .slice(0, 3);

    const domShipTop = domShipTopRaw.map((x) => ({
      product_id: x.product_id,
      name: productById.get(x.product_id)?.name || '',
      qty: x.qty,
    }));

    // ---------- 4. after_sales：售后数 / 原因分布 / 趋势 ----------
    const afterFrom = start + 'T00:00:00';
    const afterTo = end + 'T23:59:59';
    const prevAfterFrom = prevStart + 'T00:00:00';
    const prevAfterTo = prevEnd + 'T23:59:59';
    const [afterRows, afterTrendRows, prevAfterRows] = await Promise.all([
      supabase.from('after_sales').select('created_at, reason').gte('created_at', afterFrom).lte('created_at', afterTo),
      supabase.from('after_sales').select('created_at').gte('created_at', afterFrom).lte('created_at', afterTo),
      supabase.from('after_sales').select('created_at').gte('created_at', prevAfterFrom).lte('created_at', prevAfterTo),
    ]);
    if (afterRows.error) throw afterRows.error;
    if (afterTrendRows.error) throw afterTrendRows.error;
    if (prevAfterRows.error) throw prevAfterRows.error;
    const afterCount = (afterTrendRows.data || []).length;
    const prevAfterCount = (prevAfterRows.data || []).length;

    const reasonMap = new Map<string, number>();
    for (const a of afterRows.data || []) {
      const reason = (a.reason || '其他').trim() || '其他';
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    }
    const afterReason = Array.from(reasonMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // ---------- 5. 趋势（每日销售/发货/售后） ----------
    const saleTrendMap = new Map<string, number>();
    const amountTrendMap = new Map<string, number>();
    for (const r of curRows) {
      const d = r.sale_date;
      saleTrendMap.set(d, (saleTrendMap.get(d) || 0) + num(r.quantity));
      amountTrendMap.set(d, (amountTrendMap.get(d) || 0) + num(r.quantity) * num(r.unit_price) - num(r.refund_amount));
    }
    const shipTrendMap = new Map<string, number>();
    for (const r of curShipments.data || []) {
      const d = r.ship_date;
      if (!d) continue;
      shipTrendMap.set(d, (shipTrendMap.get(d) || 0) + num(r.shipping_qty));
    }
    const afterTrendMap = new Map<string, number>();
    for (const a of afterTrendRows.data || []) {
      const d = (a.created_at || '').slice(0, 10);
      afterTrendMap.set(d, (afterTrendMap.get(d) || 0) + 1);
    }
    const trend: any[] = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(start, i);
      trend.push({
        date: d,
        sale: Math.round(saleTrendMap.get(d) || 0),
        amount: Math.round(amountTrendMap.get(d) || 0),
        ship: Math.round(shipTrendMap.get(d) || 0),
        after: afterTrendMap.get(d) || 0,
      });
    }

    // 在途分组（发货建议）
    const transitByStatus = new Map<string, number>();
    for (const s of inTransitRows.data || []) {
      const k = s.cargo_status || '转运中';
      transitByStatus.set(k, (transitByStatus.get(k) || 0) + 1);
    }
    const forwarderMap = new Map<string, number>();
    for (const s of inTransitRows.data || []) {
      const k = s.forwarders?.name || '未指定货代';
      forwarderMap.set(k, (forwarderMap.get(k) || 0) + 1);
    }

    // 资金周转概览
    const domesticStockValue = Math.round(
      Array.from(domStockMap.entries()).reduce((sum, [pid, q]) => sum + q * num(productById.get(pid)?.purchase_cost || 0), 0)
    );

    return res.status(200).json({
      data: {
        period: { start, end, days: n, prevStart, prevEnd },
        summary: {
          sale_qty: Math.round(curSum.qty),
          refund_qty: Math.round(curSum.refundQty),
          refund_amount: Math.round(curSum.refundAmount),
          sale_amount: Math.round(curSum.amount),
          ship_qty: Math.round(shipQty),
          after_count: afterCount,
          link_count: linkMap.size,
          prev_sale_qty: Math.round(prevSum.qty),
          prev_sale_amount: Math.round(prevSum.amount),
          prev_ship_qty: Math.round(prevShipQty),
          prev_after_count: prevAfterCount,
        },
        platforms,
        hot_top: hotTop,
        new_rise: newRise,
        trend,
        warn: {
          low_stock: lowStock.slice(0, 5),
          in_transit: inTransitList.slice(0, 5),
        },
        safety_rate: {
          total: safetyTotal,
          pass: safetyPass,
          rate: safetyTotal > 0 ? Math.round((safetyPass / safetyTotal) * 100) : null,
        },
        replenish: replenish.slice(0, 5),
        ship_advice: {
          by_status: Array.from(transitByStatus.entries()).map(([name, value]) => ({ name, value })),
          by_forwarder: Array.from(forwarderMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
        },
        domestic: {
          ship_top: domShipTop.slice(0, 3),
          age_top: domAgeTop,
          total_stock: Math.round(Array.from(domStockMap.values()).reduce((s, q) => s + q, 0)),
        },
        after_reason: afterReason,
        capital: {
          sale_amount: Math.round(curSum.amount),
          refund_amount: Math.round(curSum.refundAmount),
          net_amount: Math.round(curSum.amount - curSum.refundAmount),
          stock_value: domesticStockValue,
        },
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
