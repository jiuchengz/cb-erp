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
  sku: z.string().max(200).nullable().optional(),
  name: z.string().min(1).max(200),
  barcode: z.string().max(64).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  unit_price: z.coerce.number().min(0).optional().default(0),
  currency: z.string().max(8).optional().default('MXN'),
  status: z.enum(['active', 'inactive']).optional().default('active'),
  // 老系统 listings 业务字段
  code: z.string().max(255).nullable().optional(),
  listing_time: z.string().max(255).nullable().optional(),
  image_text: z.string().max(255).nullable().optional(),
  link_id: z.string().max(255).nullable().optional(),
  unit: z.string().max(50).optional().default('套'),
  competitor_id: z.string().max(255).nullable().optional(),
  shipping_mode: z.string().max(20).optional().default('海运'),
  purchase_cost: z.coerce.number().min(0).optional().default(0),
  first_leg_freight: z.coerce.number().min(0).optional().default(0),
  last_mile_delivery_peso: z.coerce.number().min(0).optional().default(0),
  ml_commission_rate: z.coerce.number().min(0).max(1).optional().default(0.165),
  // 批量导入内联图片：前端压缩后的 base64，由后端上传 Storage 并写入 image_text
  image_base64: z.string().max(6_000_000).optional(),
});

// 上传图片到 Supabase Storage（public bucket: product-images），返回公开 URL
async function uploadProductImage(supabase: any, base64: string, sku: string | null): Promise<string> {
  const bucket = 'product-images';
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!(buckets || []).some((b: any) => b.name === bucket)) {
    const { error: cbErr } = await supabase.storage.createBucket(bucket, { public: true });
    if (cbErr) throw cbErr;
  }
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(base64);
  const mime = match ? `image/${match[1]}` : 'image/png';
  const b64 = match ? match[2] : base64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) throw new Error('图片数据为空');
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
  const safeSku = String(sku || 'img').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'img';
  const path = `${safeSku}_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

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
      // 自定义销量区间（YYYY-MM-DD，可选）
      const salesFrom = typeof req.query.sales_from === 'string' ? req.query.sales_from.trim() : '';
      const salesTo = typeof req.query.sales_to === 'string' ? req.query.sales_to.trim() : '';

      const supabase = getAdminClient();
      let query: any = supabase.from('products').select('*', { count: 'exact' });
      if (s) query = query.or(`sku.ilike.%${s}%,name.ilike.%${s}%,barcode.ilike.%${s}%,code.ilike.%${s}%,link_id.ilike.%${s}%`);
      if (category) query = query.eq('category', category);
      if (status) query = query.eq('status', status);
      query = query.order('created_at', { ascending: false })
        .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

      const { data, error, count } = await query;
      if (error) throw error;
      const rows = data || [];
      const pageIds = rows.map((r: any) => r.id);

      // 当前页产品聚合：国内库存 / 国外库存 / 在途数量 / 销量（总 + 今日 + 7天 + 15天 + 本月 + 自定义区间）
      const domMap = new Map<string, number>();
      const ovsMap = new Map<string, number>();
      const transitMap = new Map<string, number>();
      const salesMap = new Map<string, number>();
      const todayMap = new Map<string, number>();
      const d7Map = new Map<string, number>();
      const d15Map = new Map<string, number>();
      const monthMap = new Map<string, number>();
      const customMap = new Map<string, number>();

      if (pageIds.length) {
        // 库存：inventory join warehouses(wh_type)
        const { data: invRows, error: invErr } = await supabase
          .from('inventory')
          .select('product_id, quantity, warehouses!inner(wh_type)')
          .in('product_id', pageIds);
        if (invErr) throw invErr;
        for (const r of invRows || []) {
          const pid = r.product_id as string;
          const qty = Number(r.quantity || 0);
          const whType = (r.warehouses as any)?.wh_type;
          if (whType === 'domestic') domMap.set(pid, (domMap.get(pid) || 0) + qty);
          else if (whType === 'overseas') ovsMap.set(pid, (ovsMap.get(pid) || 0) + qty);
        }

        // 在途：已到货未入库的拿货数量（purchase_orders.status = ARRIVED）
        const { data: transitRows, error: transitErr } = await supabase
          .from('purchase_order_items')
          .select('product_id, quantity, purchase_orders!inner(status)')
          .in('product_id', pageIds)
          .eq('purchase_orders.status', 'ARRIVED');
        if (transitErr) throw transitErr;
        for (const r of transitRows || []) {
          const pid = r.product_id as string;
          transitMap.set(pid, (transitMap.get(pid) || 0) + Number(r.quantity || 0));
        }

        // 销量：销售明细累计（排除已取消订单），按订单创建时间拆分为今日/7天/15天/本月/自定义区间
        const { data: salesRows, error: salesErr } = await supabase
          .from('sales_order_items')
          .select('product_id, quantity, sales_orders!inner(status, created_at)')
          .in('product_id', pageIds)
          .neq('sales_orders.status', 'CANCELLED');
        if (salesErr) throw salesErr;

        // 时间窗口边界（服务器 UTC，按中国时区 UTC+8 折算自然日）
        const now = new Date();
        const cnNow = new Date(now.getTime() + 8 * 3600 * 1000);
        const startOfToday = Date.UTC(cnNow.getUTCFullYear(), cnNow.getUTCMonth(), cnNow.getUTCDate()) - 8 * 3600 * 1000;
        const startOf7d = startOfToday - 6 * 24 * 3600 * 1000; // 含今天，共 7 天
        const startOf15d = startOfToday - 14 * 24 * 3600 * 1000; // 含今天，共 15 天
        const startOfMonth = Date.UTC(cnNow.getUTCFullYear(), cnNow.getUTCMonth(), 1) - 8 * 3600 * 1000;
        let customStart = NaN;
        let customEnd = NaN;
        const isCustom = /^\d{4}-\d{2}-\d{2}$/.test(salesFrom) || /^\d{4}-\d{2}-\d{2}$/.test(salesTo);
        if (isCustom) {
          const s = /^\d{4}-\d{2}-\d{2}$/.test(salesFrom)
            ? Date.parse(`${salesFrom}T00:00:00+08:00`)
            : startOfToday;
          const e = /^\d{4}-\d{2}-\d{2}$/.test(salesTo)
            ? Date.parse(`${salesTo}T23:59:59.999+08:00`)
            : now.getTime();
          if (s <= e) {
            customStart = s;
            customEnd = e;
          }
        }

        const addTo = (map: Map<string, number>, pid: string, qty: number) =>
          map.set(pid, (map.get(pid) || 0) + qty);

        for (const r of salesRows || []) {
          const pid = r.product_id as string;
          const qty = Number(r.quantity || 0);
          const orderCreated = new Date((r.sales_orders as any)?.created_at).getTime();
          if (!Number.isFinite(orderCreated)) continue;
          addTo(salesMap, pid, qty);
          if (orderCreated >= startOfToday) addTo(todayMap, pid, qty);
          if (orderCreated >= startOf7d) addTo(d7Map, pid, qty);
          if (orderCreated >= startOf15d) addTo(d15Map, pid, qty);
          if (orderCreated >= startOfMonth) addTo(monthMap, pid, qty);
          if (Number.isFinite(customStart) && orderCreated >= customStart && orderCreated <= customEnd) addTo(customMap, pid, qty);
        }
      }

      const enriched = rows.map((r: any) => ({
        ...r,
        domestic_stock: domMap.get(r.id) || 0,
        overseas_stock: ovsMap.get(r.id) || 0,
        in_transit_qty: transitMap.get(r.id) || 0,
        sales_qty: salesMap.get(r.id) || 0,
        sales_today: todayMap.get(r.id) || 0,
        sales_7d: d7Map.get(r.id) || 0,
        sales_15d: d15Map.get(r.id) || 0,
        sales_month: monthMap.get(r.id) || 0,
        sales_custom: Number.isFinite(customStart) ? customMap.get(r.id) || 0 : null,
      }));

      return res.status(200).json({ data: enriched, total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'products.write');
      const body: any = parse(createSchema, req.body || {});
      const supabase = getAdminClient();
      // 产品编码唯一性兜底（前端已去重，此处防止并发/绕过前端直连）
      if (body.code) {
        const { data: dup } = await supabase
          .from('products')
          .select('id')
          .eq('code', body.code)
          .limit(1);
        if (dup && dup.length) throw Errors.conflict(`产品编码已存在：${body.code}`);
      }
      // 内联图片：后端上传 Storage 后写入 image_text；上传失败不阻塞商品创建
      const imgB64 = body.image_base64 as string | undefined;
      delete body.image_base64;
      if (imgB64) {
        try {
          body.image_text = await uploadProductImage(supabase, imgB64, body.sku || body.code);
        } catch (imgErr: any) {
          console.error('[products] inline image upload failed:', imgErr?.message || imgErr);
        }
      }
      const { data, error } = await supabase.from('products').insert(body).select().single();
      if (error) {
        if (error.code === '23505') {
          const msg = String(error.message || '');
          throw Errors.conflict(
            msg.includes('idx_products_code_unique') ? `产品编码已存在：${body.code}` : `SKU 已存在：${body.sku || ''}`
          );
        }
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
