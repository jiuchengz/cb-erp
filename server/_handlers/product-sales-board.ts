import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requirePermission, bindProductWarehouseFilter, hasUnrestrictedWarehouse } from './_lib/rbac';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';
import { getAdminClient } from './_lib/db';

/**
 * 商品销量看板（一货一行聚合）
 * GET /api/product-sales-board?days=30&keyword=&only_slow=1          列表
 * GET /api/product-sales-board?product_id=<uuid>&days=30             单品明细（逐日走势）
 *
 * 数据来源：
 * - 商品主档 products（商品管理）：编码 / SKU / 名称 / 图片(image_text) / 可用库存(overseas_stock)
 * - 销售统计导入 daily_sales（销售统计）：逐日销量、退款、可用库存快照
 * - 库存管理 inventory + warehouses(wh_type)：国内仓 / 海外仓账面库存
 * - 物流发货 shipment_items + shipments(source=transfer)：调拨在途
 *
 * 口径：
 * - 可用库存（海外）：以 products.overseas_stock（销售统计导入写入的可用库存快照）为准，
 *   缺失时依次回退 daily_sales 最新快照、inventory 海外仓账面合计
 * - 净销量 = quantity - refund_qty；走势与环比均按所选窗口（7/15/30 天）
 * - 滞销：可用库存 > 0 且连续未出单天数 > SLOW_DAYS(3)
 * - 补货建议：ceil(日均 × 30 − 可用库存 − 在途)，滞销商品不补货
 */

const DAY_MS = 86400000;
const IN_CHUNK_SIZE = 500;
const SALES_PAGE = 1000;
const SLOW_DAYS = 3;
const TARGET_COVER_DAYS = 30;
const URGENT_COVER_DAYS = 7;
const REPLENISH_COVER_DAYS = 15;
const LOOKBACK_MIN_DAYS = 90;

function todayCST(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function shiftDate(date: string, deltaDays: number): string {
  return new Date(new Date(date + 'T00:00:00Z').getTime() + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / DAY_MS);
}

function normLink(v: any): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/^MLM/, '');
}

function addTo(map: Map<string, number>, key: string, val: number) {
  map.set(key, (map.get(key) || 0) + val);
}

const STATE_LABEL: Record<string, string> = {
  urgent: '需立即补货',
  slow: '滞销待调整',
  replenish: '建议补货',
  ok: '正常',
};

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

/** 国内 / 海外仓库账面库存（受可见仓约束） */
async function loadWarehouseStock(supabase: any, ctx: any, productIds: string[]) {
  const domMap = new Map<string, number>();
  const ovsMap = new Map<string, number>();
  if (!productIds.length) return { domMap, ovsMap };
  const { data, error } = await queryInChunks(
    supabase,
    'inventory',
    'product_id',
    productIds,
    'product_id, quantity, warehouses!inner(wh_type, warehouse_kind)',
    (q: any) => (!hasUnrestrictedWarehouse(ctx) && (ctx.warehouseIds || []).length ? q.in('warehouse_id', ctx.warehouseIds) : q)
  );
  if (error) throw error;
  for (const r of (data || []) as any[]) {
    const pid = r.product_id as string;
    const qty = Number(r.quantity || 0);
    const wh = (r.warehouses as any) || {};
    const isOverseas = wh.wh_type === 'overseas' || wh.warehouse_kind === 'overseas';
    if (isOverseas) addTo(ovsMap, pid, qty);
    else addTo(domMap, pid, qty);
  }
  return { domMap, ovsMap };
}

/** 调拨在途：source=transfer 且货件状态非「已入仓」 */
async function loadTransit(supabase: any, productIds: string[]) {
  const transitMap = new Map<string, number>();
  if (!productIds.length) return transitMap;
  const { data, error } = await queryInChunks(
    supabase,
    'shipment_items',
    'product_id',
    productIds,
    'product_id, quantity, shipments!inner(source, cargo_status, deleted_at)'
  );
  if (error) throw error;
  for (const r of (data || []) as any[]) {
    const sh = r.shipments as any;
    if (!sh || sh.source !== 'transfer' || sh.deleted_at) continue;
    if (sh.cargo_status && sh.cargo_status === '已入仓') continue;
    addTo(transitMap, r.product_id as string, Number(r.quantity || 0));
  }
  return transitMap;
}

/** 销货行的 link_id 候选值（导入侧去 MLM 前缀，主档可能保留，两个口径都查） */
function linkCandidates(raw: any): string[] {
  const v = String(raw ?? '').trim();
  if (!v) return [];
  const n = normLink(v);
  return Array.from(new Set([v, n, `MLM${n}`].filter(Boolean)));
}

function computeState(overseasStock: number, inTransit: number, dailyAvg: number, daysCover: number | null, daysSinceSale: number) {
  const slow = overseasStock > 0 && daysSinceSale > SLOW_DAYS;
  if (slow) return 'slow';
  if (dailyAvg > 0 && (overseasStock + inTransit <= 0 || (daysCover !== null && daysCover < URGENT_COVER_DAYS))) return 'urgent';
  if (dailyAvg > 0 && daysCover !== null && daysCover < REPLENISH_COVER_DAYS) return 'replenish';
  return 'ok';
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
    const detailId = typeof req.query.product_id === 'string' ? req.query.product_id.trim() : '';

    const today = todayCST();
    const periodStart = shiftDate(today, -(windowDays - 1));
    const prevEnd = shiftDate(periodStart, -1);
    const prevStart = shiftDate(prevEnd, -(windowDays - 1));
    const trendFrom = periodStart; // 走势与所选窗口完全联动
    const trendDates = Array.from({ length: windowDays }, (_, i) => shiftDate(trendFrom, i));
    const trendIdx = (d: string) => diffDays(d, trendFrom);
    const lookbackFrom = shiftDate(today, -Math.max(LOOKBACK_MIN_DAYS, windowDays * 2 + 30));

    const bindFilter = bindProductWarehouseFilter(ctx);

    // ================= 单品明细模式 =================
    if (detailId) {
      let dq: any = supabase
        .from('products')
        .select(
          `id, code, sku, name, unit, link_id, image_text, overseas_stock, safety_stock, unit_price, currency, deleted_at, ${bindFilter.selectBind}`
        )
        .eq('id', detailId)
        .is('deleted_at', null);
      dq = bindFilter.filter(dq);
      const { data: found, error: fErr } = await dq;
      if (fErr) throw fErr;
      const product = (found || [])[0];
      if (!product) throw Errors.notFound('商品不存在或不在可见范围内');

      const pid = product.id as string;
      const { domMap, ovsMap } = await loadWarehouseStock(supabase, ctx, [pid]);
      const transitMap = await loadTransit(supabase, [pid]);

      const candidates = linkCandidates(product.link_id);
      const dailyRows: any[] = [];
      if (candidates.length) {
        for (let page = 0; ; page++) {
          const { data, error } = await supabase
            .from('daily_sales')
            .select('sale_date, platform, link_id, quantity, refund_qty, refund_amount, unit_price, overseas_stock')
            .in('link_id', candidates)
            .gte('sale_date', lookbackFrom)
            .lte('sale_date', today)
            .order('sale_date', { ascending: true })
            .order('created_at', { ascending: true })
            .range(page * SALES_PAGE, (page + 1) * SALES_PAGE - 1);
          if (error) throw error;
          const rows = (data || []) as any[];
          dailyRows.push(...rows);
          if (rows.length < SALES_PAGE) break;
        }
      }

      const target = normLink(product.link_id);
      const byDate = new Map<string, any>();
      let snapshotStock = 0;
      let snapshotDate = '';
      let qtyPeriod = 0;
      let qtyPrev = 0;
      let lastSaleDate: string | null = null;
      for (const r of dailyRows) {
        if (normLink(r.link_id) !== target) continue;
        const d = String(r.sale_date || '');
        if (!d) continue;
        const q = Number(r.quantity || 0);
        const rq = Number(r.refund_qty || 0);
        const net = q - rq;
        // 明细聚合（同日多平台合并）
        const cur =
          byDate.get(d) || { date: d, quantity: 0, refund_qty: 0, net_qty: 0, unit_price: 0, refund_amount: 0, overseas_stock: 0, platforms: [] as string[] };
        cur.quantity += q;
        cur.refund_qty += rq;
        cur.net_qty += net;
        cur.refund_amount += Number(r.refund_amount || 0);
        if (Number(r.unit_price || 0) > 0) cur.unit_price = Number(r.unit_price);
        if (r.platform && !cur.platforms.includes(r.platform)) cur.platforms.push(r.platform);
        if (Number(r.overseas_stock || 0) > 0 || !cur.overseas_stock) cur.overseas_stock = Number(r.overseas_stock || 0);
        byDate.set(d, cur);

        if (d >= periodStart && d <= today) qtyPeriod += net;
        if (d >= prevStart && d <= prevEnd) qtyPrev += net;
        if (net > 0 && (!lastSaleDate || d > lastSaleDate)) lastSaleDate = d;
        if (d >= snapshotDate) {
          snapshotDate = d;
          snapshotStock = Number(r.overseas_stock || 0);
        }
      }

      const daily = trendDates.map((d) => {
        const row = byDate.get(d);
        return {
          date: d,
          quantity: row ? row.quantity : 0,
          refund_qty: row ? row.refund_qty : 0,
          net_qty: row ? row.net_qty : 0,
          unit_price: row ? row.unit_price : 0,
          refund_amount: row ? row.refund_amount : 0,
          overseas_stock: row ? row.overseas_stock : 0,
          platforms: row ? row.platforms : [],
        };
      });

      const masterOvs = Number(product.overseas_stock || 0);
      const whOvs = ovsMap.get(pid) || 0;
      const overseasStock = masterOvs > 0 ? masterOvs : snapshotStock > 0 ? snapshotStock : whOvs;
      const domesticStock = domMap.get(pid) || 0;
      const inTransit = transitMap.get(pid) || 0;
      const dailyAvg = Number((qtyPeriod / windowDays).toFixed(2));
      const daysCover = dailyAvg > 0 ? Number((overseasStock / dailyAvg).toFixed(1)) : null;
      const daysSinceSale = lastSaleDate ? diffDays(today, lastSaleDate) : diffDays(today, lookbackFrom);
      const state = computeState(overseasStock, inTransit, dailyAvg, daysCover, daysSinceSale);
      const suggestQty =
        state === 'slow' || dailyAvg <= 0 ? 0 : Math.max(0, Math.ceil(dailyAvg * TARGET_COVER_DAYS - overseasStock - inTransit));

      return res.status(200).json({
        product: {
          id: pid,
          code: product.code ?? '',
          sku: product.sku ?? '',
          name: product.name ?? '',
          unit: product.unit ?? '套',
          link_id: String(product.link_id ?? '').trim(),
          image_url: typeof product.image_text === 'string' && product.image_text.trim() ? product.image_text.trim() : null,
          currency: product.currency || 'MXN',
          sale_price: Number(product.unit_price || 0),
        },
        stock: {
          overseas_stock: overseasStock,
          master_overseas_stock: masterOvs,
          snapshot_overseas_stock: snapshotStock,
          snapshot_date: snapshotDate || null,
          warehouse_overseas_stock: whOvs,
          domestic_stock: domesticStock,
          in_transit_qty: inTransit,
          safety_stock: Number(product.safety_stock || 0),
        },
        summary: {
          days: windowDays,
          from: periodStart,
          to: today,
          qty_period: qtyPeriod,
          qty_prev: qtyPrev,
          growth_pct: qtyPrev > 0 ? Number((((qtyPeriod - qtyPrev) / qtyPrev) * 100).toFixed(1)) : qtyPeriod > 0 ? null : 0,
          daily_avg: dailyAvg,
          days_cover: daysCover,
          last_sale_date: lastSaleDate,
          days_since_sale: daysSinceSale,
          never_sold: !lastSaleDate,
          suggest_qty: suggestQty,
          state,
          state_label: STATE_LABEL[state],
        },
        daily,
      });
    }

    // ================= 列表模式 =================
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
    const linkToPids = new Map<string, string[]>();
    for (const p of products) {
      const k = normLink(p.link_id);
      if (!k) continue;
      const arr = linkToPids.get(k) || [];
      arr.push(p.id);
      linkToPids.set(k, arr);
    }

    const { domMap, ovsMap } = await loadWarehouseStock(supabase, ctx, productIds);
    const transitMap = await loadTransit(supabase, productIds);

    const qtyPeriod = new Map<string, number>();
    const qtyPrev = new Map<string, number>();
    const qty7 = new Map<string, number>();
    const qty15 = new Map<string, number>();
    const lastSaleMap = new Map<string, string>();
    const trendMap = new Map<string, number[]>();
    const snapshotStockMap = new Map<string, number>();
    const snapshotDateMap = new Map<string, string>();

    if (linkToPids.size) {
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from('daily_sales')
          .select('sale_date, link_id, quantity, refund_qty, overseas_stock')
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
          const snapStock = Number(r.overseas_stock || 0);
          for (const pid of pids) {
            if (d >= periodStart && d <= today) addTo(qtyPeriod, pid, net);
            if (d >= prevStart && d <= prevEnd) addTo(qtyPrev, pid, net);
            if (d >= shiftDate(today, -6)) addTo(qty7, pid, net);
            if (d >= shiftDate(today, -14)) addTo(qty15, pid, net);
            if (net > 0) {
              const cur = lastSaleMap.get(pid);
              if (!cur || d > cur) lastSaleMap.set(pid, d);
            }
            const prevSnapDate = snapshotDateMap.get(pid);
            if (!prevSnapDate || d >= prevSnapDate) {
              if (snapStock > 0 || !prevSnapDate) {
                snapshotDateMap.set(pid, d);
                snapshotStockMap.set(pid, snapStock);
              }
            }
            if (d >= trendFrom) {
              let arr = trendMap.get(pid);
              if (!arr) {
                arr = new Array(windowDays).fill(0);
                trendMap.set(pid, arr);
              }
              const idx = trendIdx(d);
              if (idx >= 0 && idx < windowDays) arr[idx] += net;
            }
          }
        }
        if (rows.length < SALES_PAGE) break;
      }
    }

    const stateOrder: Record<string, number> = { urgent: 0, slow: 1, replenish: 2, ok: 3 };

    const rows = products.map((p) => {
      const masterOvs = p.master_overseas_stock;
      const snapOvs = snapshotStockMap.get(p.id) || 0;
      const whOvs = ovsMap.get(p.id) || 0;
      // 可用库存（海外）以商品主档（销售统计导入写入）为准，缺失时回退快照 / 仓库账面
      const overseasStock = masterOvs > 0 ? masterOvs : snapOvs > 0 ? snapOvs : whOvs;
      const domesticStock = domMap.get(p.id) || 0;
      const inTransit = transitMap.get(p.id) || 0;

      const qPeriod = qtyPeriod.get(p.id) || 0;
      const qPrev = qtyPrev.get(p.id) || 0;
      const dailyAvg = Number((qPeriod / windowDays).toFixed(2));
      const daysCover = dailyAvg > 0 ? Number((overseasStock / dailyAvg).toFixed(1)) : null;
      const lastSaleDate = lastSaleMap.get(p.id) || null;
      const daysSinceSale = lastSaleDate ? diffDays(today, lastSaleDate) : diffDays(today, lookbackFrom);
      const state = computeState(overseasStock, inTransit, dailyAvg, daysCover, daysSinceSale);
      const suggestQty =
        state === 'slow' || dailyAvg <= 0 ? 0 : Math.max(0, Math.ceil(dailyAvg * TARGET_COVER_DAYS - overseasStock - inTransit));

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
        overseas_source: masterOvs > 0 ? 'master' : snapOvs > 0 ? 'snapshot' : whOvs > 0 ? 'warehouse' : 'none',
        snapshot_overseas_stock: snapOvs,
        warehouse_overseas_stock: whOvs,
        domestic_stock: domesticStock,
        in_transit_qty: inTransit,
        safety_stock: p.safety_stock,
        qty_period: qPeriod,
        qty_prev: qPrev,
        qty_7: qty7.get(p.id) || 0,
        qty_15: qty15.get(p.id) || 0,
        growth_pct: qPrev > 0 ? Number((((qPeriod - qPrev) / qPrev) * 100).toFixed(1)) : qPeriod > 0 ? null : 0,
        daily_avg: dailyAvg,
        days_cover: daysCover,
        last_sale_date: lastSaleDate,
        days_since_sale: daysSinceSale,
        never_sold: !lastSaleDate,
        trend: trendMap.get(p.id) || new Array(windowDays).fill(0),
        suggest_qty: suggestQty,
        state,
        state_label: STATE_LABEL[state],
      };
    });

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

    let out = rows;
    if (keyword) {
      out = out.filter((r) =>
        [r.code, r.sku, r.name, r.link_id].some((v) => String(v || '').toLowerCase().includes(keyword))
      );
    }
    if (onlySlow) out = out.filter((r) => r.state === 'slow');
    out = out.sort(
      (a, b) =>
        stateOrder[a.state] - stateOrder[b.state] ||
        b.qty_period - a.qty_period ||
        String(a.code).localeCompare(String(b.code))
    );

    return res.status(200).json({
      generated_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19),
      window: { days: windowDays, from: periodStart, to: today },
      prev_window: { from: prevStart, to: prevEnd },
      trend_dates: trendDates,
      slow_days: SLOW_DAYS,
      target_cover_days: TARGET_COVER_DAYS,
      kpi,
      rows: out,
    });
  } catch (e) {
    return handleError(res, e);
  }
}
