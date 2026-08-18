import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const QUOTA_BYTES = 500 * 1024 * 1024; // Supabase 免费版 500MB

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    requirePermission(ctx, 'system.manage');

    if (req.method === 'GET') {
      const supabase = getAdminClient();
      const { data, error } = await supabase.rpc('get_db_size');
      if (error) {
        // 函数未创建（019 迁移未执行）
        return res.status(200).json({
          ok: false,
          reason: 'function_not_created',
          message: '数据库用量统计函数未创建，请先在 Supabase SQL Editor 执行 019 迁移 SQL',
        });
      }
      const usedBytes = Number(data ?? 0);
      const usedMB = Math.round((usedBytes / (1024 * 1024)) * 10) / 10;
      const freeMB = Math.round(((QUOTA_BYTES - usedBytes) / (1024 * 1024)) * 10) / 10;
      const percent = Math.round((usedBytes / QUOTA_BYTES) * 1000) / 10;
      return res.status(200).json({
        ok: true,
        usedBytes,
        usedMB,
        quotaMB: 500,
        freeMB,
        percent,
      });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
