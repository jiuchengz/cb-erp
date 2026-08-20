import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const createSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().max(7).default('#FFFFFF'),
  sort_order: z.number().int().default(0),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'shipment.read');
      const { data, error } = await supabase
        .from('cargo_statuses')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ data: data || [] });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'shipment.write');
      const body = parse(createSchema, req.body || {});
      const { data, error } = await supabase
        .from('cargo_statuses')
        .insert({ name: body.name, color: body.color, sort_order: body.sort_order })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`货物状态名称已存在：${body.name}`);
        throw error;
      }
      await writeAudit(ctx, req, 'create', 'cargo_status', data.id, null, { name: data.name, color: data.color });
      return res.status(201).json({ data });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}