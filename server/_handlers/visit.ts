import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getAdminClient } from './_lib/db';
import { clientIp } from './_lib/ip';
import { rateLimit } from './_lib/rate-limit';
import { resolveIpLocation } from './_lib/geo';

// POST /api/visit —— 采集一次页面访问（公开接口，登录页也会调用）。
// 硬性约束：本接口的任何失败都不得影响主流程（前端 fire-and-forget，不等待、不提示），
// 因此除 405 外，无论内部发生什么，统一返回 200 { ok: true|false }。

const visitSchema = z.object({
  // 只记录路径（前端已剥离查询串），服务端再兜底剥离一次，避免把 token 等敏感参数写进日志
  path: z.string().min(1).max(300),
  referer: z.string().max(500).optional().default(''),
  // 匿名访客标识：前端 localStorage 持久化的随机 UUID（不含任何个人信息，可随时清除）。
  // 仅用于「同访客 + 同路径」去重与列表展示，缺失/非法时归一为空串，回退按 IP 去重。
  visitor_id: z.preprocess(
    (v) => (typeof v === 'string' && /^[0-9a-zA-Z-]{6,64}$/.test(v.trim()) ? v.trim() : ''),
    z.string().max(64),
  ),
});

// 同一访客（无访客 ID 时回退同一 IP）对同一路径的重复访问去重窗口
const DEDUP_WINDOW_MS = 60_000;
// 单 IP 采集频次上限（每分钟），防刷
const RATE_LIMIT_PER_MIN = 60;

// UA -> 设备摘要（浏览器 + 操作系统），仅用于列表展示
function parseDevice(ua: string): string {
  const s = ua || '';
  if (!s) return '未知';

  let os = '未知系统';
  if (/Windows NT 10\.0/i.test(s)) os = 'Windows 10/11';
  else if (/Windows NT 6\.1/i.test(s)) os = 'Windows 7';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';

  let browser = '未知浏览器';
  const m = (re: RegExp) => re.exec(s);
  if (/Edg\//i.test(s)) {
    const v = m(/Edg\/(\d+)/);
    browser = 'Edge' + (v ? ' ' + v[1] : '');
  } else if (/OPR\/|Opera/i.test(s)) {
    browser = 'Opera';
  } else if (/MicroMessenger/i.test(s)) {
    const v = m(/MicroMessenger\/([\d.]+)/);
    browser = '微信' + (v ? ' ' + v[1] : '');
  } else if (/Chrome\//i.test(s)) {
    const v = m(/Chrome\/(\d+)/);
    browser = 'Chrome' + (v ? ' ' + v[1] : '');
  } else if (/Firefox\//i.test(s)) {
    const v = m(/Firefox\/(\d+)/);
    browser = 'Firefox' + (v ? ' ' + v[1] : '');
  } else if (/Safari\//i.test(s)) {
    const v = m(/Version\/(\d+)/);
    browser = 'Safari' + (v ? ' ' + v[1] : '');
  } else if (/curl|python|node|bot|spider|crawler/i.test(s)) {
    browser = '非浏览器';
  }

  return os + ' / ' + browser;
}

// 已登录时解析账号（校验 token，失败按访客处理，绝不抛错）
async function resolveAccount(req: VercelRequest, supabase: any): Promise<{ id: string | null; email: string }> {
  const h = req.headers.authorization;
  const token = typeof h === 'string' ? (/^Bearer\s+(.+)$/i.exec(h)?.[1] || '') : '';
  if (!token) return { id: null, email: '' };
  try {
    const probe = supabase.auth.getUser(token);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 1500));
    const result = (await Promise.race([probe, timeout])) as any;
    const user = result?.data?.user;
    if (user?.id) return { id: user.id, email: String(user.email || '') };
  } catch (e) {
    console.warn('[visit] resolve account failed:', (e as Error)?.message || e);
  }
  return { id: null, email: '' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    const ip = clientIp(req);

    // 限流：超限直接丢弃本次采集（前端不感知）
    try {
      rateLimit('visit:' + ip, RATE_LIMIT_PER_MIN, 60_000);
    } catch {
      return res.status(200).json({ ok: false, reason: 'rate_limited' });
    }

    const parsed = visitSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(200).json({ ok: false, reason: 'bad_request' });

    const path = parsed.data.path.split('?')[0].split('#')[0].trim() || '/';
    const ua = String(req.headers['user-agent'] || '');
    const visitorId = String(parsed.data.visitor_id || '');
    // 强制新建干净 service_role client：登录 handler 的 signInWithPassword 会污染共享 client
    // （写入用户 session），若复用会被 RLS 按 authenticated 身份过滤导致写入失败。
    const supabase = getAdminClient(true);

    // 去重：同一访客 ID 对同一路径 60s 内已有记录则直接跳过（无 visitor_id 时回退按 IP 去重）
    const sinceIso = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const dedupBy = async (column: 'visitor_id' | 'ip', value: string) =>
      supabase.from('visit_logs').select('id').eq(column, value).eq('path', path).gte('created_at', sinceIso).limit(1);
    let dedupRes: any = visitorId ? await dedupBy('visitor_id', visitorId) : await dedupBy('ip', ip);
    // 兼容尚未执行 064 迁移（visit_logs 缺 visitor_id 列）的环境：回退按 IP 去重，避免直接抛错
    if (dedupRes?.error && visitorId && /visitor_id/i.test(String(dedupRes.error.message || ''))) {
      dedupRes = await dedupBy('ip', ip);
    }
    if (dedupRes?.error) throw dedupRes.error;
    if (dedupRes?.data && dedupRes.data.length > 0) return res.status(200).json({ ok: true, deduped: true });

    const [account, location] = await Promise.all([resolveAccount(req, supabase), resolveIpLocation(ip)]);

    const record: Record<string, unknown> = {
      ip,
      visitor_id: visitorId || null,
      country: location?.country || null,
      region: location?.region || null,
      city: location?.city || null,
      isp: location?.isp || null,
      path,
      user_id: account.id,
      user_email: account.email || null,
      is_guest: !account.id,
      user_agent: ua.slice(0, 500),
      device: parseDevice(ua),
      referer: String(parsed.data.referer || '').slice(0, 500) || null,
    };
    let insRes: any = await supabase.from('visit_logs').insert(record);
    // 兼容尚未执行 064 迁移（visit_logs 缺 visitor_id 列）的环境：剔除该列重试，保证访问记录仍能落库
    if (insRes?.error && /visitor_id/i.test(String(insRes.error.message || ''))) {
      const fallback: Record<string, unknown> = { ...record };
      delete fallback.visitor_id;
      insRes = await supabase.from('visit_logs').insert(fallback);
    }
    if (insRes?.error) throw insRes.error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    // 采集失败绝不影响主流程：只记录、不抛出
    console.warn('[visit] record failed:', (e as Error)?.message || e);
    return res.status(200).json({ ok: false });
  }
}
