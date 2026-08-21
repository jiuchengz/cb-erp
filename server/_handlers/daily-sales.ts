import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const importRowSchema = z.object({
  sale_date: z.string().min(1).max(20),
  platform: z.string().max(50).optional().default(''),
  link_id: z.string().min(1).max(200),
  product_name: z.string().max(200).optional().default(''),
  quantity: z.coerce.number().positive(),
  unit_price: z.coerce.number().min(0).optional().default(0),
  overseas_stock: z.coerce.number().min(0).optional().default(0),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(5000),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'sales.read');
      const q = parse(paginationSchema, req.query);
      const saleFrom = typeof req.query.sale_from === 'string' ? req.query.sale_from.trim() : '';
      const saleTo = typeof req.query.sale_to === 'string' ? req.query.sale_to.trim() : '';
      const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';

      let query: any = supabase.from('daily_sales').select('*', { count: 'exact' });
      if (saleFrom) query = query.gte('sale_date', saleFrom);
      if (saleTo) query = query.lte('sale_date', saleTo);
      if (keyword) {
        query = query.or(`link_id.ilike.%${keyword}%,product_name.ilike.%${keyword}%`);
      }
      query = query.order('sale_date', { ascending: false }).order('created_at', { ascending: false })
        .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      // 汇总统计：所选范围内的总出单行数、总销量
      let statQuery: any = supabase
        .from('daily_sales')
        .select('quantity', { count: 'exact' });
      if (saleFrom) statQuery = statQuery.gte('sale_date', saleFrom);
      if (saleTo) statQuery = statQuery.lte('sale_date', saleTo);
      if (keyword) {
        statQuery = statQuery.or(`link_id.ilike.%${keyword}%,product_name.ilike.%${keyword}%`);
      }
      const { data: statRows, count: statCount } = await statQuery;
      const totalQty = (statRows || []).reduce((s: number, r: any) => s + Number(r.quantity || 0), 0);

      return res.status(200).json({
        data: data || [],
        total: count ?? 0,
        page: q.page,
        pageSize: q.pageSize,
        summary: { rows: statCount ?? 0, quantity: totalQty },
      });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'sales.write');
      const body = parse(importSchema, req.body || {});

      // 按 (sale_date, platform, link_id) upsert：重复导入当天数据时覆盖更新，不重复累计
      const { error } = await supabase.from('daily_sales').upsert(
        body.rows.map((r) => ({
          sale_date: r.sale_date,
          platform: r.platform,
          link_id: r.link_id,
          product_name: r.product_name,
          quantity: r.quantity,
          unit_price: r.unit_price,
          overseas_stock: r.overseas_stock,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'sale_date,platform,link_id' }
      );
      if (error) throw error;

      await writeAudit(ctx, req, 'create', 'daily_sales', null, null, {
        rows: body.rows.length,
        sale_date: body.rows[0].sale_date,
      });
      return res.status(201).json({ data: { imported: body.rows.length } });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
