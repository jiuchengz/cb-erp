import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getAdminClient } from '../_lib/db';
import { handleError, Errors } from '../_lib/error';
import { rateLimit, loginRateLimit } from '../_lib/rate-limit';
import {
  getLockRemainMs,
  recordLoginFail,
  clearLoginFails,
  MAX_FAILS,
} from '../_lib/captcha';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  captchaToken: z.string().min(1),
});

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.headers['x-real-ip'] as string) || 'unknown';
}

// 服务端自验 Cloudflare Turnstile token。
// 说明：Supabase Attack Protection 的 CAPTCHA 校验对 service_role（admin）凭据的请求会直接跳过，
// 代理登录用的是 service_role key，因此必须在这里自行调用 siteverify，否则 Turnstile 形同虚设。
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('Missing TURNSTILE_SECRET_KEY');
    return false;
  }
  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = (await resp.json()) as { success?: boolean; 'error-codes'?: string[] };
    return data.success === true;
  } catch (e) {
    console.error('Turnstile siteverify error', e);
    return false;
  }
}

async function loadUserAccess(supabase: any, userId: string): Promise<{ roles: string[]; permissions: string[] }> {
  const roles: string[] = [];
  const permissionsSet = new Set<string>();
  // 查询失败必须显性报错，禁止静默当成"无角色"（否则登录响应权限为空）
  // 空结果抖动防护：Supabase 偶发在冷启动/连接建立初期返回空数组（非报错），
  // 若直接当"无角色"会导致登录后权限为空误报 403；此处空结果短暂重试一次。
  let { data: userRoles, error: userRolesErr } = await supabase.from('user_roles').select('role_id').eq('user_id', userId);
  if (userRolesErr) throw new Error('加载用户角色失败: ' + userRolesErr.message);
  if (!userRoles || userRoles.length === 0) {
    await new Promise((r) => setTimeout(r, 800));
    const retry = await supabase.from('user_roles').select('role_id').eq('user_id', userId);
    if (retry.error) throw new Error('加载用户角色失败: ' + retry.error.message);
    userRoles = retry.data || [];
  }
  const roleIds = (userRoles || []).map((r: any) => r.role_id);
  if (roleIds.length) {
    const { data: roleData, error: roleErr } = await supabase.from('roles').select('name').in('id', roleIds);
    if (roleErr) throw new Error('加载角色定义失败: ' + roleErr.message);
    for (const r of roleData || []) if (r.name) roles.push(r.name);
    const { data: rpData, error: rpErr } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .in('role_id', roleIds);
    if (rpErr) throw new Error('加载角色权限失败: ' + rpErr.message);
    const permIds = (rpData || []).map((r: any) => r.permission_id);
    if (permIds.length) {
      const { data: permData, error: permErr } = await supabase.from('permissions').select('code').in('id', permIds);
      if (permErr) throw new Error('加载权限定义失败: ' + permErr.message);
      for (const p of permData || []) if (p.code) permissionsSet.add(p.code);
    }
  }
  return { roles, permissions: Array.from(permissionsSet) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(clientIp(req) + ':' + (req.url || ''));
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    const ip = clientIp(req);
    // IP 维度限流：20 次 / 5 分钟，防分布式爆破
    loginRateLimit('ip:' + ip, 20, 5 * 60 * 1000);

    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) throw Errors.badRequest('请求参数错误');
    const { email, password, captchaToken } = parsed.data;
    const emailNorm = email.trim().toLowerCase();

    // 账号维度限流：10 次 / 5 分钟
    loginRateLimit('email:' + emailNorm, 10, 5 * 60 * 1000);

    // 锁定检查
    const lockRemain = getLockRemainMs(emailNorm);
    if (lockRemain > 0) {
      return res.status(429).json({
        error: {
          code: 'ACCOUNT_LOCKED',
          message: '密码错误 ' + MAX_FAILS + ' 次，账号已锁定，请 ' + Math.ceil(lockRemain / 60000) + ' 分钟后再试',
        },
      });
    }

    // Cloudflare Turnstile 服务端强制校验（代理层自验，Supabase 对 service_role 请求会跳过其 CAPTCHA）
    const captchaOk = await verifyTurnstile(captchaToken, ip);
    if (!captchaOk) {
      return res.status(400).json({
        error: { code: 'CAPTCHA_INVALID', message: '人机验证失败，请刷新页面后重试' },
      });
    }

    // 代理登录 Supabase Auth（服务端凭据，不再由前端直连绕过）
    const supabase = getAdminClient();
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password,
      options: {
        captchaToken,
      },
    });

    if (authErr) {
      const msg = String(authErr.message || '');
      if (/invalid login credentials|invalid email|password/i.test(msg)) {
        const r = recordLoginFail(emailNorm);
        if (r.locked) {
          return res.status(429).json({
            error: { code: 'ACCOUNT_LOCKED', message: '密码错误 ' + MAX_FAILS + ' 次，账号已锁定 15 分钟' },
          });
        }
        return res.status(401).json({
          error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误，' + r.fails + '/' + MAX_FAILS },
        });
      }
      throw authErr;
    }

    clearLoginFails(emailNorm);

    const session = authData.session;
    const userId = authData.user?.id;
    const { roles, permissions } = await loadUserAccess(supabase, userId);
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();

    return res.status(200).json({
      session,
      user: {
        id: userId,
        email: authData.user?.email || emailNorm,
        name: (profile as any)?.display_name || '',
      },
      roles,
      permissions,
    });
  } catch (e) {
    return handleError(res, e);
  }
}
