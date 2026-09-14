import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';
import { clientIp } from './_lib/ip';
import {
  MAX_DISABLE_MS,
  readLoginCaptchaState,
  writeLoginCaptchaState,
} from './_lib/login-captcha';

// /api/login-captcha
//   GET —— 登录页用的公开只读状态接口（无需鉴权）：{ enabled, disabledUntil }
//          登录页据此决定是否渲染并校验 Turnstile；读取失败时前端兜底为「渲染并校验」。
//   PUT —— 设置接口（需鉴权，且仅 super_admin）：body { enabled: boolean }
//          enabled=false → 进入授权窗口（最长 24 小时后自动恢复开启）；
//          enabled=true  → 立即恢复人机验证。
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(clientIp(req) + ':' + (req.url || ''));

    // ---- 公开只读：登录页状态查询 ----
    if (req.method === 'GET') {
      const supabase = getAdminClient();
      const state = await readLoginCaptchaState(supabase);
      return res.status(200).json({
        data: { enabled: state.enabled, disabledUntil: state.disabledUntil },
      });
    }

    // ---- 需鉴权的设置接口：仅超级管理员 ----
    if (req.method === 'PUT') {
      const ctx = await requireAuth(req);
      // 服务端角色校验：非 super_admin 一律拒绝（权限码仅作为二次校验）
      if (!ctx.roles.includes('super_admin')) {
        throw Errors.forbidden('仅超级管理员可操作');
      }
      requirePermission(ctx, 'system.login_captcha');

      const body = parse(z.object({ enabled: z.boolean() }), req.body || {});
      const supabase = getAdminClient();
      const before = await readLoginCaptchaState(supabase);

      // 关闭即开始 24 小时授权窗口；恢复开启时清空到期时间
      const disabledUntil = body.enabled
        ? null
        : new Date(Date.now() + MAX_DISABLE_MS).toISOString();
      const state = await writeLoginCaptchaState(supabase, body.enabled, disabledUntil, ctx.userId);

      await writeAudit(ctx, req, 'update', 'login_captcha_toggle', '1', before, state);

      return res.status(200).json({
        data: { enabled: state.enabled, disabledUntil: state.disabledUntil },
      });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
