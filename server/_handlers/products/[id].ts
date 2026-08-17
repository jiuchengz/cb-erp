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
  sku: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200).optional(),
  barcode: z.string().max(64).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  unit_price: z.coerce.number().min(0).optional(),
  currency: z.string().max(8).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  // 老系统 listings 业务字段
  code: z.string().max(255).nullable().optional(),
  listing_time: z.string().max(255).nullable().optional(),
  image_text: z.string().max(255).nullable().optional(),
  link_id: z.string().max(255).nullable().optional(),
  unit: z.string().max(50).optional(),
  competitor_id: z.string().max(255).nullable().optional(),
  shipping_mode: z.string().max(20).optional(),
  purchase_cost: z.coerce.number().min(0).optional(),
  first_leg_freight: z.coerce.number().min(0).optional(),
  last_mile_delivery_peso: z.coerce.number().min(0).optional(),
  ml_commission_rate: z.coerce.number().min(0).max(1).optional(),
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
        if (error.code === '23505') throw Errors.conflict('SKU 已存在');
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
