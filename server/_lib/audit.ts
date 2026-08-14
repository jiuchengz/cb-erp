import type { VercelRequest } from '@vercel/node';
import { getAdminClient } from './db';
import type { AuthContext } from './auth';

// 服务端生成审计日志。审计失败不阻塞主业务。
export async function writeAudit(
  ctx: AuthContext,
  req: VercelRequest,
  action: string,
  resourceType: string,
  resourceId?: string,
  beforeData?: unknown,
  afterData?: unknown,
) {
  try {
    const supabase = getAdminClient();
    await supabase.from('audit_logs').insert({
      user_id: ctx.userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId ?? null,
      before_data: beforeData ?? null,
      after_data: afterData ?? null,
      ip: (req.headers['x-forwarded-for'] as string) ?? null,
      user_agent: (req.headers['user-agent'] as string) ?? null,
    });
  } catch (e) {
    console.error('[audit] write failed:', e);
  }
}
