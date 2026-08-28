import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      // 拉取完整 profile 供个人中心展示（邮箱/姓名/头像/仓库/状态/创建时间）
      const supabase = getAdminClient();
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, display_name, avatar_url, warehouse_id, is_active, created_at')
        .eq('id', ctx.userId)
        .maybeSingle();

      return res.status(200).json({
        user: { id: ctx.userId, email: ctx.email, name: ctx.displayName, avatar: ctx.avatarUrl },
        profile: {
          id: profile?.id || ctx.userId,
          email: profile?.email || ctx.email,
          display_name: profile?.display_name || ctx.displayName,
          avatar_url: profile?.avatar_url || null,
          warehouse_id: profile?.warehouse_id || null,
          is_active: profile?.is_active ?? true,
          created_at: profile?.created_at || null,
        },
        roles: ctx.roles,
        permissions: ctx.permissions,
      });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
