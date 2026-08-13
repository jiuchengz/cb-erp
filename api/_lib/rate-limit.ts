import { Errors } from './error';

// 简单内存限流（serverless 冷启动会重置，作为基础防护；
// 生产高强度限流可换 Upstash/Redis 等外部存储）。
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit = 120, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    throw Errors.rateLimited();
  }
}

// 登录接口专用：更严格，防暴力破解（结合 IP + username）
export function loginRateLimit(key: string, limit = 10, windowMs = 5 * 60_000) {
  return rateLimit(key, limit, windowMs);
}
