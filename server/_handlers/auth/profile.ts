import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const MAX_RAW_BYTES = 1024 * 1024; // 头像与网站图标一致：不超过 1MB
const ALLOWED_PREFIX = /^data:image\/(png|jpeg|jpg|webp);base64,/i;

// PATCH /auth/profile 当前用户更新自己的资料（邮箱/角色不可自改，仅允许姓名与头像）
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method !== 'PATCH') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      avatar: z.string().max(2_500_000).optional(), // 空字符串表示清除头像
    });
    const body = parse(schema, req.body || {});
    if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');

    // 头像校验：与系统设置-网站图标一致（dataURL、格式白名单、1MB）
    if (body.avatar !== undefined) {
      const avatar = body.avatar || '';
      if (avatar !== '') {
        if (!ALLOWED_PREFIX.test(avatar)) {
          return res.status(400).json({ error: { code: 'INVALID_AVATAR', message: '仅支持 PNG/JPG/WebP 格式图片' } });
        }
        const rawLen = Math.floor((avatar.length - avatar.indexOf(',') - 1) * 3 / 4);
        if (rawLen > MAX_RAW_BYTES) {
          return res.status(400).json({ error: { code: 'AVATAR_TOO_LARGE', message: '头像不能超过 1MB' } });
        }
      }
    }

    const supabase = getAdminClient();
    const profilePatch: Record<string, unknown> = {};
    if (body.name !== undefined) profilePatch.display_name = body.name;
    if (body.avatar !== undefined) profilePatch.avatar_url = body.avatar || null;
    if (Object.keys(profilePatch).length === 0) throw Errors.badRequest('无更新字段');

    const { error: upErr } = await supabase.from('profiles').update(profilePatch).eq('id', ctx.userId);
    if (upErr) throw upErr;

    const { data: after } = await supabase
      .from('profiles')
      .select('id, email, display_name, avatar_url, warehouse_id, is_active, created_at')
      .eq('id', ctx.userId)
      .maybeSingle();

    await writeAudit(ctx, req, 'update_profile', 'user', ctx.userId, null, {
      display_name: after?.display_name ?? null,
      has_avatar: !!after?.avatar_url,
    });

    return res.status(200).json({
      ok: true,
      profile: {
        id: after?.id || ctx.userId,
        email: after?.email || ctx.email,
        display_name: after?.display_name ?? body.name ?? ctx.displayName,
        avatar_url: after?.avatar_url ?? null,
        warehouse_id: after?.warehouse_id ?? null,
        is_active: after?.is_active ?? true,
        created_at: after?.created_at ?? null,
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
