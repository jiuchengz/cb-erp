import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getAdminClient } from '../_lib/db';
import { handleError, Errors } from '../_lib/error';
import { rateLimit, loginRateLimit } from '../_lib/rate-limit';
import {
  verifyCaptcha,
  getLockRemainMs,
  recordLoginFail,
  clearLoginFails,
  MAX_FAILS,
} from '../_lib/captcha';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  captchaId: z.string().min(1),
  captchaAnswer: z.coerce.number(),
});

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.headers['x-real-ip'] as string) || 'unknown';
}

async function loadUserAccess(supabase: any, userId: string): Promise<{ roles: string[]; permissions: string[] }> {
  const roles: string[] = [];
  const permissionsSet = new Set<string>();
  const { data: userRoles } = await supabase.from('user_roles').select('role_id').eq('user_id', userId);
  const roleIds = (userRoles || []).map((r: any) => r.role_id);
  if (roleIds.length) {
    const { data: roleData } = await supabase.from('roles').select('name').in('id', roleIds);
    for (const r of roleData || []) if (r.name) roles.push(r.name);
    const { data: rpData } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .in('role_id', roleIds);
    const permIds = (rpData || []).map((r: any) => r.permission_id);
    if (permIds.length) {
      const { data: permData } = await supabase.from('permissions').select('code').in('id', permIds);
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
    const { email, password, captchaId, captchaAnswer } = parsed.data;
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

    // 服务端验证码校验（一次性）
    if (!verifyCaptcha(captchaId, captchaAnswer)) {
      return res.status(400).json({ error: { code: 'CAPTCHA_INVALID', message: '验证码错误或已过期，请刷新重试' } });
    }

    // 代理登录 Supabase Auth（服务端凭据，不再由前端直连绕过）
    const supabase = getAdminClient();
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password,
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
