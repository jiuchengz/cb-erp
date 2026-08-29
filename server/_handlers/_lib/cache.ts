// 短期内存结果缓存（Serverless 场景说明）
// ------------------------------------------------------------
// Vercel Serverless 函数实例不持久：进程内存缓存仅在「热实例」内生效，
// 冷启动 / 多实例下会回源查询。本缓存仅用于降低热实例内重复全量聚合
// （dashboard / analysis 等大查询）的开销，不作为强一致 / 跨实例共享缓存，
// 该取舍可接受；后续如需跨实例共享，应迁移到 Upstash Redis 等外部存储。
// ------------------------------------------------------------

interface CacheEntry {
  v: unknown;
  expire: number;
}

const store = new Map<string, CacheEntry>();
// 默认缓存 90 秒，配合 60-120 秒区间
const DEFAULT_TTL_MS = 90_000;
// 简单上限：防止异常 key 爆炸导致内存增长（Serverless 实例本身内存受限）
const MAX_KEYS = 50;

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expire) {
    store.delete(key);
    return undefined;
  }
  return e.v as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
  if (store.size >= MAX_KEYS) {
    const now = Date.now();
    // 先清过期项
    for (const [k, e] of store) {
      if (now > e.expire) store.delete(k);
    }
    // 仍满则淘汰最早写入的 key（Map 按插入序迭代）
    if (store.size >= MAX_KEYS) {
      const first = store.keys().next().value;
      if (first !== undefined) store.delete(first);
    }
  }
  store.set(key, { v: value, expire: Date.now() + ttlMs });
}
