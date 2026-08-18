import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createCaptcha } from '../_lib/captcha';
import { rateLimit } from '../_lib/rate-limit';
import { handleError } from '../_lib/error';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':captcha', 60, 60_000);
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    return res.status(200).json(createCaptcha());
  } catch (e) {
    return handleError(res, e);
  }
}
