import type { VercelRequest } from '@vercel/node';
import { getAdminClient } from './db';
import { clientIp } from './ip';
import type { AuthContext } from './auth';

// 服务端生成审计日志。审计失败不阻塞主业务。
// IP 统一走 clientIp(req) 规范化取值（优先 Vercel 可信头，x-forwarded-for 仅取合法可信段，
// 无效回退 unknown），不再直接落原始 x-forwarded-for 整串（可能含多跳代理 IP）。
async function insertAuditRecord(
  req: VercelRequest,
  actor: { userId?: string | null; email?: string | null },
  payload: { action: string; resourceType: string; resourceId?: string; beforeData?: unknown; afterData?: unknown },
  opts?: { cleanClient?: boolean },
) {
  try {
    const supabase = opts?.cleanClient ? getAdminClient(true) : getAdminClient();
    await supabase.from('audit_logs').insert({
      user_id: actor.userId || null,
      user_email: actor.email || null,
      action: payload.action,
      resource_type: payload.resourceType,
      resource_id: payload.resourceId ?? null,
      before_data: payload.beforeData ?? null,
      after_data: payload.afterData ?? null,
      ip: clientIp(req),
      user_agent: (req.headers['user-agent'] as string) ?? null,
    });
  } catch (e) {
    console.error('[audit] write failed:', e);
  }
}

export async function writeAudit(
  ctx: AuthContext,
  req: VercelRequest,
  action: string,
  resourceType: string,
  resourceId?: string,
  beforeData?: unknown,
  afterData?: unknown,
) {
  await insertAuditRecord(req, { userId: ctx.userId, email: ctx.email }, { action, resourceType, resourceId, beforeData, afterData });
}

// 登录成功审计（action=login / resource_type=auth）：
// 登录 handler 没有 AuthContext，且 signInWithPassword 会向共享 client 内存写入用户 session，
// 复用该 client 会以 authenticated 身份被 RLS 拦截导致写不进去，故强制新建干净 service_role client。
export async function writeLoginAudit(req: VercelRequest, userId: string | null, email: string) {
  await insertAuditRecord(req, { userId, email }, { action: 'login', resourceType: 'auth' }, { cleanClient: true });
}
