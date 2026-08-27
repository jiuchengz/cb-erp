import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const LOGO_KEY = 'site_logo';
const MAX_RAW_BYTES = 1024 * 1024; // 1MB
const ALLOWED_PREFIX = /^data:image\/(png|jpeg|jpg|webp|svg\+xml|ico|x-icon|vnd\.microsoft\.icon);base64,/i;

// GET /system/logo 读取当前网站图标（公开）；POST /system/logo 上传/清除（body: { logo: dataURL | '' }）
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));

    if (req.method === 'GET') {
      const supabase = getAdminClient();
      const { data, error } = await supabase.from('system_settings').select('value').eq('key', LOGO_KEY).maybeSingle();
      if (error) throw error;
      const logo: string | null = data?.value?.logo || null;
      return res.status(200).json({ ok: true, data: { logo } });
    }

    if (req.method === 'POST') {
      const ctx = await requireAuth(req);
      requirePermission(ctx, 'system.manage');
      const supabase = getAdminClient();
      const schema = z.object({ logo: z.string().max(2_500_000) });
      const { logo } = parse(schema, req.body || {});

      if (logo && logo !== '') {
        if (!ALLOWED_PREFIX.test(logo)) {
          return res.status(400).json({ error: { code: 'INVALID_LOGO', message: '仅支持 PNG/JPG/WebP/SVG/ICO 格式图片' } });
        }
        const rawLen = Math.floor((logo.length - logo.indexOf(',') - 1) * 3 / 4);
        if (rawLen > MAX_RAW_BYTES) {
          return res.status(400).json({ error: { code: 'LOGO_TOO_LARGE', message: '图片不能超过 1MB' } });
        }
      }

      const now = new Date().toISOString();
      const { error: upErr } = await supabase.from('system_settings').upsert(
        { key: LOGO_KEY, value: { logo: logo || null }, updated_at: now, updated_by: ctx.userId },
        { onConflict: 'key' }
      );
      if (upErr) throw upErr;
      await writeAudit(ctx, req, 'update_site_logo', 'system_setting', undefined, undefined, { logo: logo || null });
      return res.status(200).json({ ok: true, data: { logo: logo || null } });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
