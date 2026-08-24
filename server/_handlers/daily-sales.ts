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
  quantity: z.coerce.number().refine((v) => v !== 0, { message: 'quantity must not be 0' }),
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

      // 预取涉及链接的产品售价（MXN），用于退款行无单价时兜底
      const linkIds = Array.from(new Set(body.rows.map((r: any) => r.link_id || '').filter(Boolean)));
      let linkPriceMap = new Map<string, number>();
      if (linkIds.length > 0) {
        try {
          const { data: prodRows } = await supabase
            .from('products')
            .select('link_id, unit_price')
            .is('deleted_at', null)
            .in('link_id', linkIds);
          for (const p of prodRows || []) {
            const v = Number(p?.unit_price || 0);
            if (p?.link_id && v > 0 && !linkPriceMap.has(p.link_id)) linkPriceMap.set(p.link_id, v);
          }
        } catch {
          // 产品表查询失败不阻断导入，退款金额保持按导入单价计算
        }
      }

      // 按 (sale_date, platform, link_id) 聚合：正数=销售数量，负数=退款数量
      const keyMap = new Map<string, any>();
      for (const r of body.rows) {
        const key = `${r.sale_date}|${r.platform}|${r.link_id}`;
        const cur = keyMap.get(key) || {
          sale_date: r.sale_date,
          platform: r.platform,
          link_id: r.link_id,
          product_name: r.product_name,
          quantity: 0,
          refund_qty: 0,
          refund_amount: 0,
          unit_price: 0,
          overseas_stock: r.overseas_stock || 0,
        };
        const q = Number(r.quantity) || 0;
        if (q > 0) {
          cur.quantity += q;
          cur.unit_price = Number(r.unit_price || 0) || cur.unit_price;
        } else {
          const rq = -q;
          // 退款单价优先用退款行单价，缺失时复用同链接销售行单价，再缺则用产品售价兜底
          const price = Number(r.unit_price || 0) || cur.unit_price || linkPriceMap.get(r.link_id) || 0;
          cur.refund_qty += rq;
          cur.refund_amount += rq * price;
          if (price > 0 && cur.unit_price === 0) cur.unit_price = price;
        }
        keyMap.set(key, cur);
      }
      const rows = Array.from(keyMap.values()).map((r) => ({
        sale_date: r.sale_date,
        platform: r.platform,
        link_id: r.link_id,
        product_name: r.product_name,
        quantity: r.quantity,
        refund_qty: r.refund_qty,
        refund_amount: r.refund_amount,
        unit_price: r.unit_price,
        overseas_stock: r.overseas_stock,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from('daily_sales').upsert(
        rows,
        { onConflict: 'sale_date,platform,link_id' }
      );
      if (error) throw error;

      await writeAudit(ctx, req, 'create', 'daily_sales', null, null, {
        rows: rows.length,
        sale_date: body.rows[0].sale_date,
      });
      return res.status(201).json({ data: { imported: rows.length } });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
