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
  remark: z.string().max(1000).nullable().optional(),
  competitor_id: z.string().max(255).nullable().optional(),
  shipping_mode: z.string().max(20).optional().default('海运'),
  purchase_cost: z.coerce.number().min(0).optional().default(0),
  first_leg_freight: z.coerce.number().min(0).optional().default(0),
  last_mile_delivery_peso: z.coerce.number().min(0).optional().default(0),
  ml_commission_rate: z.coerce.number().min(0).max(1).optional().default(0.165),
  // 海外库存（平台可用库存快照，批量导入写入）
  overseas_stock: z.coerce.number().min(0).optional().default(0),
  // 安全库存阈值（自动库存预警）
  safety_stock: z.coerce.number().min(0).optional().default(0),
  // 批量导入内联图片：前端压缩后的 base64，由后端上传 Storage 并写入 image_text
  image_base64: z.string().max(6_000_000).optional(),
});

// 商品列表分页：pageSize 支持 100/200/500，0 表示不分页返回全部（供"全部"下拉使用）
const productsListSchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(0).max(500).default(200),
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

// 分批执行 in() 查询：Supabase 网关对 URL 长度有限制，
// in() 超过约 650 个值即触发 400 Bad Request（实测 600 正常 / 700 失败）。
// 每批 500 个，规避超长 URL 导致商品页全量拉取时 500。
const IN_CHUNK_SIZE = 500;
async function queryInChunks(
  supabase: any,
  table: string,
  column: string,
  ids: string[],
  selectStr: string,
  extra?: (q: any) => any
): Promise<{ data: any[] | null; error: any }> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    let q: any = supabase.from(table).select(selectStr).in(column, chunk);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'products.read');
      const q = parse(productsListSchema, req.query);
      const s = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      // 销量时间范围（可选）：sales_from / sales_to，格式 YYYY-MM-DD 或 ISO
      const salesFrom = typeof req.query.sales_from === 'string' && req.query.sales_from.trim() ? req.query.sales_from.trim() : '';
      const salesTo = typeof req.query.sales_to === 'string' && req.query.sales_to.trim() ? req.query.sales_to.trim() : '';
      // 链接ID精确过滤（可选，逗号分隔，最多500）：销售统计导入按需取商品，避免全量拉取
      const linkIdsParam = typeof req.query.link_ids === 'string' && req.query.link_ids.trim() ? req.query.link_ids.trim() : '';
      const linkIds = linkIdsParam ? Array.from(new Set(linkIdsParam.split(',').map((x: string) => x.trim()).filter(Boolean))).slice(0, 500) : [];

      const supabase = getAdminClient();
      let query: any = supabase.from('products').select('*', { count: 'exact' }).is('deleted_at', null);
      if (s) query = query.or(`sku.ilike.%${s}%,name.ilike.%${s}%,barcode.ilike.%${s}%,code.ilike.%${s}%,link_id.ilike.%${s}%`);
      if (category) query = query.eq('category', category);
      if (status) query = query.eq('status', status);
      if (linkIds.length) query = query.in('link_id', linkIds);
      query = query.order('created_at', { ascending: false });
      if (q.pageSize > 0) {
        query = query.range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const rows = data || [];
      const pageIds = rows.map((r: any) => r.id);
      // 链接ID映射：daily_sales 按 link_id 关联商品
      const pageLinkIds = rows.map((r: any) => String(r.link_id || '').trim()).filter(Boolean);
      const linkToProduct = new Map<string, string>();
      for (const r of rows) {
        const lid = String(r.link_id || '').trim();
        if (lid) linkToProduct.set(lid, r.id);
      }

      // 当前页产品聚合：国内库存 / 国外库存 / 在途数量 / 销量
      const domMap = new Map<string, number>();
      const ovsMap = new Map<string, number>();
      const transitMap = new Map<string, number>();
      const salesMap = new Map<string, number>();

      if (pageIds.length) {
        // 库存：inventory join warehouses(wh_type)（分批查询，避免超长 URL）
        const { data: invRows, error: invErr } = await queryInChunks(
          supabase,
          'inventory',
          'product_id',
          pageIds,
          'product_id, quantity, warehouses!inner(wh_type)'
        );
        if (invErr) throw invErr;
        for (const r of invRows || []) {
          const pid = r.product_id as string;
          const qty = Number(r.quantity || 0);
          const whType = (r.warehouses as any)?.wh_type;
          if (whType === 'domestic') domMap.set(pid, (domMap.get(pid) || 0) + qty);
          else if (whType === 'overseas') ovsMap.set(pid, (ovsMap.get(pid) || 0) + qty);
        }

        // 在途（仅调拨发货）：shipments(source=transfer) 货物状态非「已入仓」的货件数量（分批查询）
        const { data: transitShipRows, error: transitShipErr } = await queryInChunks(
          supabase,
          'shipment_items',
          'product_id',
          pageIds,
          'product_id, quantity, shipments!inner(source, cargo_status, deleted_at)'
        );
        if (transitShipErr) throw transitShipErr;
        for (const r of transitShipRows || []) {
          const sh = r.shipments as any;
          if (!sh || sh.source !== 'transfer' || sh.deleted_at) continue;
          if (sh.cargo_status && sh.cargo_status === '已入仓') continue;
          const pid = r.product_id as string;
          transitMap.set(pid, (transitMap.get(pid) || 0) + Number(r.quantity || 0));
        }

        // 销量：从 daily_sales 按 link_id 聚合（销售数量-退款数量=实际销量）；
        // sales_from/sales_to 传了则按 sale_date 过滤（分批查询）
        if (pageLinkIds.length) {
          const { data: salesRows, error: salesErr } = await queryInChunks(
            supabase,
            'daily_sales',
            'link_id',
            pageLinkIds,
            'link_id, quantity, refund_qty',
            (q: any) => {
              let x: any = q;
              if (salesFrom) x = x.gte('sale_date', salesFrom);
              if (salesTo) x = x.lte('sale_date', salesTo);
              return x;
            }
          );
          if (salesErr) throw salesErr;
          for (const r of salesRows || []) {
            const pid = linkToProduct.get(r.link_id as string);
            if (!pid) continue;
            salesMap.set(pid, (salesMap.get(pid) || 0) + (Number(r.quantity || 0) - Number(r.refund_qty || 0)));
          }
        }
      }

      const enriched = rows.map((r: any) => {
        const sellable = Number(r.domestic_stock || 0) + Number(r.overseas_stock ?? 0);
        const safety = Number(r.safety_stock ?? 0);
        return {
          ...r,
          domestic_stock: domMap.get(r.id) || 0,
          warehouse_overseas_stock: ovsMap.get(r.id) || 0,
          overseas_stock: Number(r.overseas_stock ?? 0),
          in_transit_qty: transitMap.get(r.id) || 0,
          sales_qty: salesMap.get(r.id) || 0,
          sellable_stock: sellable,
          low_stock: safety > 0 && sellable > 0 && sellable < safety,
          out_of_stock: sellable <= 0,
        };
      });

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
          .is('deleted_at', null)
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
