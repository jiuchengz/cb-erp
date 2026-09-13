// IP 归属地解析（服务端专用）
// 采用公开免费 IP 库 ip-api.com（无需 key，lang=zh-CN 直接返回中文国家/省市区/运营商）。
// 设计原则：
//   1) 纯降级：任何失败（超时 / 限流 / 网络异常 / 返回非 success）一律返回 null，
//      调用方留空即可（前端显示「未知」），绝不阻塞访问记录写入；
//   2) 进程内缓存 6 小时：同一 IP 反复访问不再重复外呼，同时规避公开接口的频次限制；
//   3) 内网 / 保留地址不解析，直接标记为「内网」，避免无意义外呼。

export interface IpLocation {
  country: string;
  region: string;
  city: string;
  isp: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2500;

const cache = new Map<string, { expireAt: number; value: IpLocation | null }>();

const PRIVATE_V4_RE = /^(10\.|127\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[0-2]\d)\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isPrivateIp(ip: string): boolean {
  const s = (ip || '').trim().toLowerCase();
  if (!s) return true;
  if (s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80:')) return true;
  if (s.includes(':')) return false;
  return PRIVATE_V4_RE.test(s);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// 解析单个 IP 的归属地；失败返回 null（调用方按「未知」处理）。
export async function resolveIpLocation(ip: string): Promise<IpLocation | null> {
  const key = (ip || '').trim();
  if (!key || key === 'unknown') return null;

  if (isPrivateIp(key)) {
    return { country: '内网', region: '', city: '', isp: '' };
  }

  const hit = cache.get(key);
  if (hit && hit.expireAt > Date.now()) return hit.value;

  let value: IpLocation | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(key)}?lang=zh-CN&fields=status,country,regionName,city,isp`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      if (data && data.status === 'success') {
        value = {
          country: text(data.country),
          region: text(data.regionName),
          city: text(data.city),
          isp: text(data.isp),
        };
      }
    }
  } catch (e) {
    // 归属地解析失败不影响主流程：留空（前端显示「未知」）
    console.warn('[geo] resolve failed:', key, (e as Error)?.message || e);
    value = null;
  }

  // 仅缓存成功结果，失败不缓存（下次访问可重试）
  if (value) cache.set(key, { expireAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
