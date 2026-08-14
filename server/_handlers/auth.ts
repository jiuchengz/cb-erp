import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      return res.status(200).json({
        user: { id: ctx.userId, email: ctx.email, name: ctx.displayName },
        roles: ctx.roles,
        permissions: ctx.permissions,
      });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
