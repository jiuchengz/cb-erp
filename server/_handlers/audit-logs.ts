import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requireAnyPermission } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requireAnyPermission(ctx, ['system.audit', 'system.logs']);
      const q = parse(paginationSchema, req.query);
      // 强制新建干净 client，避免被登录 session 污染后按 authenticated 身份被 RLS 过滤（列表恒空）
      const supabase = getAdminClient(true);
      let query: any = supabase.from('audit_logs').select('*', { count: 'exact' });
      const resourceType = typeof req.query.resource_type === 'string' ? req.query.resource_type.trim() : '';
      if (resourceType) query = query.eq('resource_type', resourceType);
      const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
      if (action) query = query.eq('action', action);
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
