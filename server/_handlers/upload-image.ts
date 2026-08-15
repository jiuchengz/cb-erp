import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const schema = z.object({
  base64: z.string().min(20).max(6_000_000),
  sku: z.string().max(64).optional().default('img'),
});

// 上传商品图片到 Supabase Storage（public bucket: product-images），返回公开 URL
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'products.write');
    const body = parse(schema, req.body || {});
    const supabase = getAdminClient();

    const bucket = 'product-images';
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!(buckets || []).some((b: any) => b.name === bucket)) {
      const { error: cbErr } = await supabase.storage.createBucket(bucket, { public: true });
      if (cbErr) throw cbErr;
    }

    const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(body.base64);
    const mime = match ? `image/${match[1]}` : 'image/png';
    const b64 = match ? match[2] : body.base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: '图片数据为空' } });

    const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
    const safeSku = body.sku.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'img';
    const path = `${safeSku}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buffer, {
      contentType: mime,
      upsert: false,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return res.status(201).json({ url: data.publicUrl });
  } catch (e) {
    return handleError(res, e);
  }
}
