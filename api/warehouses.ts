import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const createSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  address: z.string().max(300).nullable().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'inventory.read');
      const supabase = getAdminClient();
      const { data, error } = await supabase.from('warehouses').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ data: data || [] });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'inventory.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();
      const { data, error } = await supabase.from('warehouses').insert(body).select().single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`仓库编码已存在：${body.code}`);
        throw error;
      }
      await writeAudit(ctx, req, 'create', 'warehouse', data.id, null, data);
      return res.status(201).json({ data });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
