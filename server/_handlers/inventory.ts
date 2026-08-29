import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

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
    const warehouseId = typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id.trim() : '';
    const productId = typeof req.query.product_id === 'string' ? req.query.product_id.trim() : '';
    const whType = typeof req.query.wh_type === 'string' ? req.query.wh_type.trim() : '';
    const supabase = getAdminClient();

    // 海外仓：inventory 表不存在 wh_type='overseas' 的库存记录，
    // 海外库存统一来自 products.overseas_stock（平台可用库存快照，销售统计导入写入）。
    // wh_type=overseas 时直接查产品快照列表，返回结构与库存列表兼容（仓库显示"海外仓"占位）。
    if (whType === 'overseas') {
      let pq: any = supabase.from('products')
        .select('id, sku, name, code, image_text, safety_stock, overseas_stock, updated_at', { count: 'exact' })
        .gt('overseas_stock', 0)
        .is('deleted_at', null);
      if (productId) pq = pq.eq('id', productId);
      if (sku) pq = pq.ilike('sku', `%${sku}%`);
      pq = pq.order('updated_at', { ascending: false })
        .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await pq;
      if (error) throw error;
      return res.status(200).json({
        data: (data || []).map((p: any) => ({
          product_id: p.id,
          products: { id: p.id, sku: p.sku, name: p.name, code: p.code, image_text: p.image_text, safety_stock: p.safety_stock },
          warehouse_id: 'overseas',
          warehouses: { id: 'overseas', name: '海外仓', wh_type: 'overseas' },
          quantity: Number(p.overseas_stock ?? 0),
          reserved_quantity: 0,
          updated_at: p.updated_at,
          _snapshot: true,
        })),
        total: count ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      });
    }

    let query: any = supabase.from('inventory')
      .select('*, products!inner(id, sku, name, code, image_text, safety_stock), warehouses!inner(id, name, wh_type)', { count: 'exact' })
      .gt('quantity', 0); // 隐藏库存数量为 0 的记录（仅按库存数量过滤，不涉及锁定数量）

    if (productId) query = query.eq('product_id', productId);
    if (whType === 'domestic') query = query.eq('warehouses.wh_type', whType);
    if (sku) {
      const { data: prods } = await supabase.from('products').select('id').eq('sku', sku).is('deleted_at', null);
      const ids = (prods || []).map((p: any) => p.id);
      if (ids.length) query = query.in('product_id', ids);
      else return res.status(200).json({ data: [], total: 0, page: q.page, pageSize: q.pageSize });
    }
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);

    query = query.order('updated_at', { ascending: false })
      .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
  } catch (e) {
    return handleError(res, e);
  }
}
