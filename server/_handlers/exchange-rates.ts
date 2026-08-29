import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';
import { getAdminClient } from './_lib/db';

/**
 * 汇率接口（USD 基准全表）
 * 数据来源优先级：
 *   1. 内存缓存（TTL 10 分钟）
 *   2. exchange_rate_history 表当日快照（有表数据优先用表）
 *   3. 实时拉取第三方源（open.er-api.com → exchangerate-api.com），成功后回填当日快照
 *   4. 第三方源不可用时回退表内最近一天快照（stale）
 * 支持查询参数：
 *   - date=YYYY-MM-DD  指定单日快照（优先表，缺失时实时拉取并回填当天）
 *   - from&to=YYYY-MM-DD  历史区间查询（仅查表，需先执行 scripts/sync-exchange-rates.mjs 同步）
 *   - currencies=USD,CNY,MXN  仅返回指定币种（可选，默认全量）
 */
interface RateCache {
  rates: Record<string, number>;
  updatedAt: string;
  source: string;
  ts: number;
}

let cached: RateCache | null = null;
const CACHE_MS = 10 * 60 * 1000;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function pickCurrencies(rates: Record<string, number>, currencies?: string): Record<string, number> {
  if (!currencies) return rates;
  const list = currencies.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (list.length === 0) return rates;
  const out: Record<string, number> = {};
  for (const c of list) {
    if (rates[c] !== undefined) out[c] = Number(rates[c]);
  }
  return out;
}

async function fetchRatesFrom(url: string): Promise<Record<string, number> | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    const rates = json?.rates;
    if (!rates || typeof rates !== 'object') return null;
    const out: Record<string, number> = {};
    Object.keys(rates).forEach((k) => {
      const v = Number(rates[k]);
      if (Number.isFinite(v) && v > 0) out[k.toUpperCase()] = v;
    });
    return out;
  } catch {
    return null;
  }
}

async function fetchFromErApi(): Promise<Record<string, number> | null> {
  return fetchRatesFrom('https://open.er-api.com/v6/latest/USD');
}

async function fetchFromExchangeRateApi(): Promise<Record<string, number> | null> {
  return fetchRatesFrom('https://api.exchangerate-api.com/v4/latest/USD');
}

/** 从汇率历史表读取指定日期的快照；无数据返回 null */
async function loadFromDb(dateStr: string): Promise<{ rates: Record<string, number>; source: string } | null> {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from('exchange_rate_history')
      .select('currency, rate, source')
      .eq('date', dateStr);
    if (error) return null;
    if (!data || data.length === 0) return null;
    const rates: Record<string, number> = {};
    let source = '';
    for (const row of data) {
      const v = Number(row?.rate);
      const c = (row?.currency || '').toUpperCase();
      if (c && Number.isFinite(v) && v > 0) {
        rates[c] = v;
        if (row?.source) source = row.source;
      }
    }
    if (Object.keys(rates).length === 0) return null;
    return { rates, source };
  } catch {
    return null;
  }
}

/** 将实时拉取的汇率回填当日快照（upsert 按 currency+date） */
async function saveToDb(dateStr: string, rates: Record<string, number>, source: string): Promise<void> {
  try {
    const supabase = getAdminClient();
    const rows = Object.entries(rates).map(([currency, rate]) => ({
      currency,
      rate,
      date: dateStr,
      source,
      updated_at: new Date().toISOString(),
    }));
    await supabase.from('exchange_rate_history').upsert(rows, { onConflict: 'currency,date' });
  } catch {
    // 回填失败不阻断接口返回（下次请求会再尝试回填）
  }
}

/** 从历史表读取区间快照（按日期升序） */
async function loadRangeFromDb(from: string, to: string): Promise<Array<{ date: string; rates: Record<string, number>; source: string }>> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('exchange_rate_history')
    .select('currency, rate, date, source')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });
  if (error) return [];
  const byDate = new Map<string, { rates: Record<string, number>; source: string }>();
  for (const row of data || []) {
    const d = String(row?.date || '').slice(0, 10);
    const c = (row?.currency || '').toUpperCase();
    const v = Number(row?.rate);
    if (!d || !c || !Number.isFinite(v) || v <= 0) continue;
    if (!byDate.has(d)) byDate.set(d, { rates: {}, source: row?.source || '' });
    byDate.get(d)!.rates[c] = v;
    if (row?.source) byDate.get(d)!.source = row.source;
  }
  return Array.from(byDate.entries())
    .map(([date, v]) => ({ date, rates: v.rates, source: v.source }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    await requireAuth(req);

    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const currencies = typeof req.query.currencies === 'string' ? req.query.currencies.trim() : '';

    // 历史区间查询：仅查表（需先同步历史数据）
    if (from && to) {
      const range = await loadRangeFromDb(from, to);
      return res.status(200).json({
        data: {
          base: 'USD',
          from,
          to,
          days: range.map((d) => ({
            date: d.date,
            rates: pickCurrencies(d.rates, currencies),
            source: d.source,
          })),
          total: range.length,
        },
      });
    }

    const targetDate = date || todayUTC();
    const now = Date.now();

    // 内存缓存（仅作用于"今天/无指定日期"的默认场景，指定 date 时跳过）
    if (!date && cached && now - cached.ts < CACHE_MS) {
      return res.status(200).json({
        data: {
          base: 'USD',
          rates: pickCurrencies(cached.rates, currencies),
          updatedAt: cached.updatedAt,
          source: cached.source,
        },
      });
    }

    // 优先用表：当日快照已落库则直接返回（不再请求第三方源）
    const dbHit = await loadFromDb(targetDate);
    if (dbHit) {
      return res.status(200).json({
        data: {
          base: 'USD',
          rates: pickCurrencies(dbHit.rates, currencies),
          updatedAt: `${targetDate}T00:00:00.000Z`,
          source: dbHit.source || 'exchange_rate_history',
          fromDb: true,
        },
      });
    }

    // 表缺失：实时拉取并回填
    let rates = await fetchFromErApi();
    let source = 'open.er-api.com';
    if (!rates) {
      rates = await fetchFromExchangeRateApi();
      source = 'exchangerate-api.com';
    }

    if (rates) {
      await saveToDb(targetDate, rates, source);
      if (!date) cached = { rates, updatedAt: new Date().toISOString(), source, ts: now };
      return res.status(200).json({
        data: {
          base: 'USD',
          rates: pickCurrencies(rates, currencies),
          updatedAt: new Date().toISOString(),
          source,
          fromDb: false,
        },
      });
    }

    // 第三方源全部不可用：回退表内最近一天快照（stale），再退内存缓存
    const staleDb = await loadFromDb(targetDate); // 兜底重查（含上次回填）
    if (staleDb) {
      return res.status(200).json({
        data: {
          base: 'USD',
          rates: pickCurrencies(staleDb.rates, currencies),
          updatedAt: `${targetDate}T00:00:00.000Z`,
          source: staleDb.source || 'exchange_rate_history',
          fromDb: true,
          stale: true,
        },
      });
    }
    if (cached) {
      return res.status(200).json({
        data: {
          base: 'USD',
          rates: pickCurrencies(cached.rates, currencies),
          updatedAt: cached.updatedAt,
          source: cached.source,
          stale: true,
        },
      });
    }
    return res.status(502).json({ error: { code: 'RATES_UNAVAILABLE', message: '汇率服务暂不可用，请稍后重试' } });
  } catch (e) {
    return handleError(res, e);
  }
}
