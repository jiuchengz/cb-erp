import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    const ctx = await requireAuth(req);
    return res.status(200).json({
      data: {
        id: ctx.userId,
        email: ctx.email,
        displayName: ctx.displayName,
        roles: ctx.roles,
        permissions: ctx.permissions,
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
