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
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  barcode: z.string().max(64).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  unit_price: z.coerce.number().min(0).optional().default(0),
  currency: z.string().max(8).optional().default('CNY'),
  status: z.enum(['active', 'inactive']).optional().default('active'),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'products.read');
      const q = parse(paginationSchema, req.query);
      const s = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

      const supabase = getAdminClient();
      let query: any = supabase.from('products').select('*', { count: 'exact' });
      if (s) query = query.or(`sku.ilike.%${s}%,name.ilike.%${s}%,barcode.ilike.%${s}%`);
      if (category) query = query.eq('category', category);
      if (status) query = query.eq('status', status);
      query = query.order('created_at', { ascending: false })
        .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'products.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();
      const { data, error } = await supabase.from('products').insert(body).select().single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`SKU 已存在：${body.sku}`);
        throw error;
      }
      await writeAudit(ctx, req, 'create', 'product', data.id, null, data);
      return res.status(201).json({ data });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
