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
  sku: z.string().max(64).nullable().optional(),
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
