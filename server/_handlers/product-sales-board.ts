import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requirePermission, bindProductWarehouseFilter, hasUnrestrictedWarehouse } from './_lib/rbac';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';
import { getAdminClient } from './_lib/db';

/**
 * 商品销量看板（聚合接口，一货一行）
 * GET /api/product-sales-board?days=30&keyword=&only_slow=1
 *
 * 聚合口径：
 * - 商品：products，可见性由 bindProductWarehouseFilter(ctx) 控制（受限账号仅可见绑定仓商品）
 * - 图片：products.image_text（Supabase Storage 公开 URL）→ image_url
 * - 库存：inventory join warehouses(wh_type)；domestic=国内仓合计，overseas=海外仓合计
 *        （受限账号仅统计可见仓库；海外库存缺失时仅全量账号回退商品主档 overseas_stock，防越权泄露）
 * - 在途：shipment_items join shipments，source=transfer 且货件状态非「已入仓」
 * - 销量：daily_sales 按 link_id 归一化（去空格、大写、去 MLM 前缀）关联商品，
 *        净销量 = quantity - refund_qty；当前窗口与前一等长窗口做环比
 * - 滞销：海外仓库存 > 0 且连续未出单天数 > SLOW_DAYS(3)
 * - 补货建议：ceil(日均 × TARGET_COVER_DAYS(30) − 海外库存 − 在途)，滞销商品不补货
 */

const DAY_MS = 86400000;
const IN_CHUNK_SIZE = 500;
const SALES_PAGE = 1000;
const SLOW_DAYS = 3; // 连续未出单天数阈值：超过即判定滞销，需要调整
const TARGET_COVER_DAYS = 30; // 补货目标覆盖天数
const URGENT_COVER_DAYS = 7; // 可售天数低于该值 → 需立即补货
const REPLENISH_COVER_DAYS = 15; // 可售天数低于该值 → 建议补货
const TREND_DAYS = 14; // 走势窗口

/** 中国时区当天日期（YYYY-MM-DD） */
function todayCST(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function shiftDate(date: string, deltaDays: number): string {
  const t = new Date(date + 'T00:00:00Z').getTime() + deltaDays * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / DAY_MS);
}

/** link_id 归一化：与导入侧入库口径保持一致（去空格、转大写、去 MLM 前缀） */
function normLink(v: any): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/^MLM/, '');
}

function addTo(map: Map<string, number>, key: string, val: number) {
  map.set(key, (map.get(key) || 0) + val);
}

// 分批执行 in() 查询：Supabase 网关对 URL 长度有限制（与 products.ts / product-total.ts 同策略）
async function queryInChunks(
  supabase: any,
  table: string,
  column: string,
  ids: string[],
  selectStr: string,
  extra?: (q: any) => any
): Promise<{ data: any[] | null; error: any }> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    let q: any = supabase.from(table).select(selectStr).in(column, chunk);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'sales.read');

    const supabase = getAdminClient();
    const daysRaw = Number((req.query as any).days ?? 30);
    const windowDays = [7, 15, 30].includes(daysRaw) ? daysRaw : 30;
    const onlySlow = String((req.query as any).only_slow ?? '') === '1';
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim().toLowerCase() : '';

    const today = todayCST();
    const periodStart = shiftDate(today, -(windowDays - 1));
    const prevEnd = shiftDate(periodStart, -1);
    const prevStart = shiftDate(prevEnd, -(windowDays - 1));
    const sevenFrom = shiftDate(today, -6);
    const fifteenFrom = shiftDate(today, -14);
    const trendFrom = shiftDate(today, -(TREND_DAYS - 1));
    // 滞销天数判定回溯窗口：至少 90 天，避免「长期未出单」被误判为 0 天
    const lookbackFrom = shiftDate(today, -Math.max(90, windowDays * 2 + 30));

    // ===== 1) 商品主档（含图片、可见性过滤）=====
    const bindFilter = bindProductWarehouseFilter(ctx);
    let pq: any = supabase
      .from('products')
      .select(
        `id, code, sku, name, unit, link_id, image_text, overseas_stock, safety_stock, unit_price, currency, ${bindFilter.selectBind}`
      )
      .is('deleted_at', null);
    pq = bindFilter.filter(pq);
    const { data: prodData, error: prodErr } = await pq;
    if (prodErr) throw prodErr;

    const products = (prodData || []).map((r: any) => {
      const binds = Array.isArray(r.product_warehouses) ? r.product_warehouses : [];
      const bindPrices = binds.map((b: any) => Number(b.sale_price ?? 0)).filter((n: number) => n > 0);
      return {
        id: r.id as string,
        code: r.code ?? '',
        sku: r.sku ?? '',
        name: r.name ?? '',
        unit: r.unit ?? '套',
        link_id: String(r.link_id ?? '').trim(),
        image_url: typeof r.image_text === 'string' && r.image_text.trim() ? r.image_text.trim() : null,
        master_overseas_stock: Number(r.overseas_stock ?? 0),
        safety_stock: Number(r.safety_stock ?? 0),
        sale_price: bindPrices.length ? bindPrices[0] : Number(r.unit_price ?? 0),
        currency: r.currency || 'MXN',
      };
    });

    const productIds = products.map((p) => p.id);

    // link_id 归一化 → 商品 id（同一 link 可能被多条商品档案引用）
    const linkToPids = new Map<string, string[]>();
    for (const p of products) {
      const k = normLink(p.link_id);
      if (!k) continue;
      const arr = linkToPids.get(k) || [];
      arr.push(p.id);
      linkToPids.set(k, arr);
    }

    // ===== 2) 库存聚合（国内 / 海外，受可见仓约束）=====
    const domMap = new Map<string, number>();
    const ovsMap = new Map<string, number>();
    const transitMap = new Map<string, number>();

    if (productIds.length) {
      const invExtra = (q: any) => {
        if (!hasUnrestrictedWarehouse(ctx) && (ctx.warehouseIds || []).length) {
          return q.in('warehouse_id', ctx.warehouseIds || []);
        }
        return q;
      };
      const { data: invRows, error: invErr } = await queryInChunks(
        supabase,
        'inventory',
        'product_id',
        productIds,
        'product_id, quantity, warehouses!inner(wh_type)',
        invExtra
      );
      if (invErr) throw invErr;
      for (const r of invRows || []) {
        const pid = r.product_id as string;
        const qty = Number(r.quantity || 0);
        const whType = (r.warehouses as any)?.wh_type;
        if (whType === 'domestic') addTo(domMap, pid, qty);
        else if (whType === 'overseas') addTo(ovsMap, pid, qty);
      }

      // 在途：仅调拨发货（source=transfer）且未「已入仓」的货件数量
      const { data: transitRows, error: transitErr } = await queryInChunks(
        supabase,
        'shipment_items',
        'product_id',
        productIds,
        'product_id, quantity, shipments!inner(source, cargo_status, deleted_at)'
      );
      if (transitErr) throw transitErr;
      for (const r of transitRows || []) {
        const sh = r.shipments as any;
        if (!sh || sh.source !== 'transfer' || sh.deleted_at) continue;
        if (sh.cargo_status && sh.cargo_status === '已入仓') continue;
        addTo(transitMap, r.product_id as string, Number(r.quantity || 0));
      }
    }

    // ===== 3) 销量聚合（daily_sales 按归一化 link_id 关联）=====
    const qtyPeriod = new Map<string, number>(); // 当前窗口净销量
    const qtyPrev = new Map<string, number>(); // 前一窗口净销量
    const qty7 = new Map<string, number>();
    const qty15 = new Map<string, number>();
    const lastSaleMap = new Map<string, string>(); // 最后一次净销量 > 0 的日期
    const trendMap = new Map<string, number[]>();
    const trendIdx = (d: string) => diffDays(d, trendFrom);

    if (linkToPids.size) {
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from('daily_sales')
          .select('sale_date, link_id, quantity, refund_qty')
          .gte('sale_date', lookbackFrom)
          .lte('sale_date', today)
          .order('sale_date', { ascending: true })
          .order('created_at', { ascending: true })
          .range(page * SALES_PAGE, (page + 1) * SALES_PAGE - 1);
        if (error) throw error;
        const rows = (data || []) as any[];
        for (const r of rows) {
          const pids = linkToPids.get(normLink(r.link_id));
          if (!pids || !pids.length) continue;
          const d = String(r.sale_date || '');
          if (!d) continue;
          const net = Number(r.quantity || 0) - Number(r.refund_qty || 0);
          for (const pid of pids) {
            if (d >= periodStart && d <= today) addTo(qtyPeriod, pid, net);
            if (d >= prevStart && d <= prevEnd) addTo(qtyPrev, pid, net);
            if (d >= sevenFrom) addTo(qty7, pid, net);
            if (d >= fifteenFrom) addTo(qty15, pid, net);
            if (net > 0) {
              const cur = lastSaleMap.get(pid);
              if (!cur || d > cur) lastSaleMap.set(pid, d);
            }
            if (d >= trendFrom) {
              let arr = trendMap.get(pid);
              if (!arr) {
                arr = new Array(TREND_DAYS).fill(0);
                trendMap.set(pid, arr);
              }
              const idx = trendIdx(d);
              if (idx >= 0 && idx < TREND_DAYS) arr[idx] += net;
            }
          }
        }
        if (rows.length < SALES_PAGE) break;
      }
    }

    // ===== 4) 组装行 + 状态判定 + 补货建议 =====
    const unrestricted = hasUnrestrictedWarehouse(ctx);
    const stateOrder: Record<string, number> = { urgent: 0, slow: 1, replenish: 2, ok: 3 };
    const stateLabel: Record<string, string> = {
      urgent: '需立即补货',
      slow: '滞销待调整',
      replenish: '建议补货',
      ok: '正常',
    };

    const rows = products.map((p) => {
      const aggOvs = ovsMap.get(p.id);
      // 海外库存：优先库存表聚合；无记录时仅全量账号回退商品主档，受限账号不回退（防越权）
      const overseasStock = aggOvs !== undefined ? Number(aggOvs) : unrestricted ? p.master_overseas_stock : 0;
      const domesticStock = domMap.get(p.id) || 0;
      const inTransit = transitMap.get(p.id) || 0;

      const qPeriod = qtyPeriod.get(p.id) || 0;
      const qPrev = qtyPrev.get(p.id) || 0;
      const dailyAvg = Number((qPeriod / windowDays).toFixed(2));
      const daysCover = dailyAvg > 0 ? Number((overseasStock / dailyAvg).toFixed(1)) : null;
      const lastSaleDate = lastSaleMap.get(p.id) || null;
      const daysSinceSale = lastSaleDate ? diffDays(today, lastSaleDate) : diffDays(today, lookbackFrom);
      const slow = overseasStock > 0 && daysSinceSale > SLOW_DAYS;

      let state = 'ok';
      if (slow) state = 'slow';
      else if (dailyAvg > 0 && (overseasStock + inTransit <= 0 || (daysCover !== null && daysCover < URGENT_COVER_DAYS))) state = 'urgent';
      else if (dailyAvg > 0 && daysCover !== null && daysCover < REPLENISH_COVER_DAYS) state = 'replenish';

      // 补货建议量：目标覆盖 TARGET_COVER_DAYS 天，扣除海外库存与在途；滞销商品不补货
      let suggestQty = 0;
      if (!slow && dailyAvg > 0) {
        suggestQty = Math.max(0, Math.ceil(dailyAvg * TARGET_COVER_DAYS - overseasStock - inTransit));
      }

      const growth =
        qPrev > 0 ? Number((((qPeriod - qPrev) / qPrev) * 100).toFixed(1)) : qPeriod > 0 ? null : 0;

      return {
        id: p.id,
        code: p.code,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        link_id: p.link_id,
        image_url: p.image_url,
        currency: p.currency,
        sale_price: p.sale_price,
        overseas_stock: overseasStock,
        domestic_stock: domesticStock,
        in_transit_qty: inTransit,
        safety_stock: p.safety_stock,
        qty_period: qPeriod,
        qty_prev: qPrev,
        qty_7: qty7.get(p.id) || 0,
        qty_15: qty15.get(p.id) || 0,
        growth_pct: growth,
        daily_avg: dailyAvg,
        days_cover: daysCover,
        last_sale_date: lastSaleDate,
        days_since_sale: daysSinceSale,
        never_sold: !lastSaleDate,
        trend: trendMap.get(p.id) || new Array(TREND_DAYS).fill(0),
        suggest_qty: suggestQty,
        state,
        state_label: stateLabel[state],
      };
    });

    // ===== 5) KPI（筛选前全量口径）=====
    const sum = (fn: (r: any) => number) => rows.reduce((acc, r) => acc + fn(r), 0);
    const kpiQtyPeriod = sum((r) => r.qty_period);
    const kpiQtyPrev = sum((r) => r.qty_prev);
    const kpi = {
      total: rows.length,
      urgent: rows.filter((r) => r.state === 'urgent').length,
      slow: rows.filter((r) => r.state === 'slow').length,
      replenish: rows.filter((r) => r.state === 'replenish').length,
      ok: rows.filter((r) => r.state === 'ok').length,
      overseas_stock: sum((r) => r.overseas_stock),
      domestic_stock: sum((r) => r.domestic_stock),
      in_transit_qty: sum((r) => r.in_transit_qty),
      qty_period: kpiQtyPeriod,
      qty_prev: kpiQtyPrev,
      growth_pct: kpiQtyPrev > 0 ? Number((((kpiQtyPeriod - kpiQtyPrev) / kpiQtyPrev) * 100).toFixed(1)) : null,
      suggest_qty: sum((r) => r.suggest_qty),
      suggest_sku: rows.filter((r) => r.suggest_qty > 0).length,
    };

    // ===== 6) 过滤 + 排序（异常优先，其次窗口销量降序）=====
    let out = rows;
    if (keyword) {
      out = out.filter((r) =>
        [r.code, r.sku, r.name, r.link_id].some((v) => String(v || '').toLowerCase().includes(keyword))
      );
    }
    if (onlySlow) out = out.filter((r) => r.state === 'slow');
    out = out.sort(
      (a, b) => (stateOrder[a.state] - stateOrder[b.state]) || b.qty_period - a.qty_period || String(a.code).localeCompare(String(b.code))
    );

    return res.status(200).json({
      generated_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19),
      window: { days: windowDays, from: periodStart, to: today },
      prev_window: { from: prevStart, to: prevEnd },
      trend_dates: Array.from({ length: TREND_DAYS }, (_, i) => shiftDate(trendFrom, i)),
      slow_days: SLOW_DAYS,
      target_cover_days: TARGET_COVER_DAYS,
      kpi,
      rows: out,
    });
  } catch (e) {
    return handleError(res, e);
  }
}
