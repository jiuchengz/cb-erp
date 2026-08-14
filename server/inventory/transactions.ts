import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, paginationSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { handleError } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'inventory.read');

    const q = parse(paginationSchema, req.query);
    const sku = typeof req.query.sku === 'string' ? req.query.sku.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const supabase = getAdminClient();

    let query: any = supabase.from('inventory_transactions')
      .select('*, products!inner(id, sku, name), warehouses!inner(id, name)', { count: 'exact' });

    if (sku) {
      const { data: prods } = await supabase.from('products').select('id').eq('sku', sku);
      const ids = (prods || []).map((p: any) => p.id);
      if (ids.length) query = query.in('product_id', ids);
      else return res.status(200).json({ data: [], total: 0, page: q.page, pageSize: q.pageSize });
    }
    if (type) query = query.eq('type', type);

    query = query.order('created_at', { ascending: false })
      .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
  } catch (e) {
    return handleError(res, e);
  }
}
