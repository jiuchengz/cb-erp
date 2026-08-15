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
  name: z.string().min(1).max(100),
  contact: z.string().max(100).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'shipment.read');
      const q = parse(paginationSchema, req.query);
      let query: any = supabase.from('forwarders').select('*', { count: 'exact' });
      const isActive = req.query.is_active;
      if (isActive === 'true') query = query.eq('is_active', true);
      else if (isActive === 'false') query = query.eq('is_active', false);
      query = query.order('created_at', { ascending: true }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'shipment.write');
      const body = parse(createSchema, req.body || {});
      const { data, error } = await supabase
        .from('forwarders')
        .insert({
          name: body.name,
          contact: body.contact || null,
          phone: body.phone || null,
          remark: body.remark || null,
        })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`货代名称已存在：${body.name}`);
        throw error;
      }
      await writeAudit(ctx, req, 'create', 'forwarder', data.id, null, { name: data.name });
      return res.status(201).json({ data });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
