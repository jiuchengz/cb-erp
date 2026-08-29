import type { VercelRequest } from '@vercel/node';

// 简化版合法 IP 校验：
// - IPv4：完整四段 0-255
// - IPv6：仅做字符集与长度白名单（避免误拒主流格式），不展开全量 RFC 校验
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]{3,45}$/;

function isValidIp(v: string): boolean {
  const s = (v || '').trim();
  if (!s) return false;
  // IPv6 可能带方括号（如 [::1]）
  if (s.startsWith('[') && s.endsWith(']')) return isValidIp(s.slice(1, -1));
  return IPV4_RE.test(s) || IPV6_RE.test(s);
}

// 可信客户端 IP 提取（登录 IP 可信化）：
// 1) 优先 x-vercel-forwarded-for：Vercel 边缘填充的可信客户端 IP（格式校验通过才采信）
// 2) 其次 x-real-ip：常见反代设置的客户端 IP（同样需格式校验）
// 3) x-forwarded-for：攻击者可伪造任意首段（客户端原始 IP 在最左侧），
//    因此仅接受「全部为合法 IP」的列表并取最后一个合法跳数（最接近源站/代理追加的地址），
//    不再直接信任首段。
// 4) 全部无效或缺失时回退 'unknown'，保证限流 key 不因空值碰撞。
export function clientIp(req: VercelRequest): string {
  const vff = req.headers['x-vercel-forwarded-for'];
  if (typeof vff === 'string' && isValidIp(vff)) return vff.trim();

  const rip = req.headers['x-real-ip'];
  if (typeof rip === 'string' && isValidIp(rip)) return rip.trim();

  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) {
    const parts = fwd
      .split(',')
      .map((p) => p.trim())
      .filter(isValidIp);
    if (parts.length) return parts[parts.length - 1];
  }

  return 'unknown';
}
