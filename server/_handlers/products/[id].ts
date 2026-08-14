import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  barcode: z.string().max(64).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  unit_price: z.coerce.number().min(0).optional(),
  currency: z.string().max(8).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'products.read');
      const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('商品不存在');
        throw error;
      }
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      requirePermission(ctx, 'products.write');
      const body = parse(updateSchema, req.body || {});
      if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');
      const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
      const { data, error } = await supabase.from('products').update(body).eq('id', id).select().single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('商品不存在');
        throw error;
      }
      await writeAudit(ctx, req, 'update', 'product', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'products.delete');
      const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'product', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
