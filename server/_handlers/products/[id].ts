import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, assertWarehouseVisible, hasUnrestrictedWarehouse } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const updateSchema = z.object({
  sku: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(200).optional(),
  barcode: z.string().max(64).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  unit_price: z.coerce.number().min(0).optional(),
  currency: z.string().max(8).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  // 迁移仓库（同款记录从 A 仓改归 B 仓，需同步校验同仓编码唯一）
  warehouse_id: z.string().uuid().optional(),
  // 老系统 listings 业务字段
  code: z.string().max(255).nullable().optional(),
  listing_time: z.string().max(255).nullable().optional(),
  image_text: z.string().max(255).nullable().optional(),
  link_id: z.string().max(255).nullable().optional(),
  unit: z.string().max(50).optional(),
  remark: z.string().max(1000).nullable().optional(),
  competitor_id: z.string().max(255).nullable().optional(),
  shipping_mode: z.string().max(20).optional(),
  purchase_cost: z.coerce.number().min(0).optional(),
  first_leg_freight: z.coerce.number().min(0).optional(),
  last_mile_delivery_peso: z.coerce.number().min(0).optional(),
  ml_commission_rate: z.coerce.number().min(0).max(1).optional(),
  overseas_stock: z.coerce.number().min(0).optional(),
  safety_stock: z.coerce.number().min(0).optional(),
});

// 抓取商品并对当前账号做仓库可见性校验（不可见按不存在处理，防越权枚举）
async function fetchProductVisible(supabase: any, ctx: any, id: string) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).is('deleted_at', null).single();
  if (error) {
    if (error.code === 'PGRST116') throw Errors.notFound('商品不存在');
    throw error;
  }
  if (!hasUnrestrictedWarehouse(ctx) && !(ctx.warehouseIds || []).includes(data.warehouse_id)) {
    throw Errors.notFound('商品不存在');
  }
  return data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'products.read');
      const data = await fetchProductVisible(supabase, ctx, id);
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      requirePermission(ctx, 'products.write');
      const body = parse(updateSchema, req.body || {});
      if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');
      // P2 数据规范：字符串字段去首尾空白；可空字段空串归一为 null
      const textKeys = ['sku', 'code', 'link_id', 'name', 'barcode', 'category', 'unit', 'remark', 'competitor_id', 'shipping_mode', 'listing_time', 'image_text', 'currency'];
      const nullableKeys = ['code', 'link_id', 'barcode', 'category', 'remark', 'competitor_id', 'listing_time', 'image_text'];
      const normalized = body as Record<string, unknown>;
      for (const k of textKeys) {
        const val = normalized[k];
        if (typeof val === 'string') {
          const v = val.trim();
          normalized[k] = v === '' && nullableKeys.includes(k) ? null : v;
        }
      }
      const before = await fetchProductVisible(supabase, ctx, id);
      // 仓库可见性：跨仓迁移同样校验目标仓在可见范围内
      const targetWarehouseId = body.warehouse_id !== undefined ? body.warehouse_id : before.warehouse_id;
      if (body.warehouse_id !== undefined) assertWarehouseVisible(ctx, body.warehouse_id, '目标仓库');
      // 同仓编码唯一性（改了 code 或 warehouse_id 时前置校验；null code 不受限）
      if (body.code && (body.code !== before.code || body.warehouse_id !== undefined)) {
        const { data: dup } = await supabase
          .from('products')
          .select('id')
          .eq('warehouse_id', targetWarehouseId)
          .eq('code', body.code)
          .neq('id', id)
          .is('deleted_at', null)
          .limit(1);
        if (dup && dup.length) throw Errors.conflict(`产品编码已存在：${body.code}`);
      }
      const { data, error } = await supabase.from('products').update(body).eq('id', id).select().single();
      if (error) {
        if (error.code === '23505') {
          // code 冲突已前置校验，此处兜底仅剩 SKU 冲突
          throw Errors.conflict(`SKU 已存在：${body.sku || ''}`);
        }
        if (error.code === 'PGRST116') throw Errors.notFound('商品不存在');
        throw error;
      }
      await writeAudit(ctx, req, 'update', 'product', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'products.delete');
      const before = await fetchProductVisible(supabase, ctx, id);
      // 软删除：置 deleted_at，数据进入回收站
      const { error } = await supabase.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'product', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
