import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';
import { clientIp } from './_lib/ip';

// GET /api/visits —— 访问记录列表（仅 system.visit，即 super_admin）
// 支持分页 + 筛选：ip / path（模糊匹配）、date_from / date_to（ISO 时间字符串，按 created_at 区间）
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(clientIp(req) + ':' + (req.url || ''), 120, 60_000);
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'system.visit');

      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 100));

      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const ip = str(req.query.ip);
      const pathFilter = str(req.query.pathFilter);
      const dateFrom = str(req.query.date_from);
      const dateTo = str(req.query.date_to);

      // 强制新建干净 client：登录 / 改密 handler 的 signInWithPassword 会向共享 client 注入用户
    // session，复用会让本次查询以 authenticated 身份被 RLS 过滤，列表恒为空。
    const supabase = getAdminClient(true);
      let query: any = supabase.from('visit_logs').select('*', { count: 'exact' });
      if (ip) query = query.ilike('ip', `%${ip}%`);
      if (pathFilter) query = query.ilike('path', `%${pathFilter}%`);
      if (dateFrom && !Number.isNaN(Date.parse(dateFrom))) query = query.gte('created_at', new Date(dateFrom).toISOString());
      if (dateTo && !Number.isNaN(Date.parse(dateTo))) query = query.lte('created_at', new Date(dateTo).toISOString());

      query = query.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;

      return res.status(200).json({ data: data || [], total: count ?? 0, page, pageSize });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
