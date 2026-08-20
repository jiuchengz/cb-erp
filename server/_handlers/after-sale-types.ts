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
  value: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_]+$/, '类型标识仅支持英文/数字/下划线'),
  name: z.string().min(1).max(50),
  need_stock_in: z.boolean().default(false),
  sort_order: z.number().int().default(0),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'after_sales.read');
      const { data, error } = await supabase
        .from('after_sale_types')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ data: data || [] });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'after_sales.write');
      const body = parse(createSchema, req.body || {});
      const { data, error } = await supabase
        .from('after_sale_types')
        .insert({ value: body.value, name: body.name, need_stock_in: body.need_stock_in, sort_order: body.sort_order })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`售后类型标识已存在：${body.value}`);
        throw error;
      }
      await writeAudit(ctx, req, 'create', 'after_sale_type', data.id, null, { value: data.value, name: data.name });
      return res.status(201).json({ data });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}