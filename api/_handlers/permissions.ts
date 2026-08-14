import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'user.read');
      const supabase = getAdminClient();
      const { data, error } = await supabase
        .from('permissions')
        .select('*')
        .order('code', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ data: data || [] });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
