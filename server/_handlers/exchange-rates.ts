import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

/**
 * 实时汇率接口（USD 基准全表）
 * 主源 open.er-api.com（免费无 key，160+ 币种），失败时回退 exchangerate-api.com。
 * 服务端缓存 10 分钟，避免频繁请求第三方源。
 */
interface RateCache {
  rates: Record<string, number>;
  updatedAt: string;
  ts: number;
}

let cached: RateCache | null = null;
const CACHE_MS = 10 * 60 * 1000;

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    await requireAuth(req);

    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    const now = Date.now();
    if (cached && now - cached.ts < CACHE_MS) {
      return res.status(200).json({
        data: { base: 'USD', rates: cached.rates, updatedAt: cached.updatedAt },
      });
    }

    let rates = await fetchFromErApi();
    let source = 'open.er-api.com';
    if (!rates) {
      rates = await fetchFromExchangeRateApi();
      source = 'exchangerate-api.com';
    }

    if (!rates) {
      // 第三方源全部不可用：返回过期缓存（标注 stale），完全没有则报错
      if (cached) {
        return res.status(200).json({
          data: { base: 'USD', rates: cached.rates, updatedAt: cached.updatedAt, stale: true },
        });
      }
      return res.status(502).json({ error: { code: 'RATES_UNAVAILABLE', message: '汇率服务暂不可用，请稍后重试' } });
    }

    cached = { rates, updatedAt: new Date().toISOString(), ts: now };
    return res.status(200).json({
      data: { base: 'USD', rates, updatedAt: cached.updatedAt, source },
    });
  } catch (e) {
    handleError(e, req, res);
  }
}
