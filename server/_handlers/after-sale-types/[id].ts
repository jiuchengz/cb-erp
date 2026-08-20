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
  name: z.string().min(1).max(50).optional(),
  need_stock_in: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'PATCH') {
      requirePermission(ctx, 'after_sales.write');
      const body = parse(updateSchema, req.body || {});
      if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');
      const { data: before } = await supabase.from('after_sale_types').select('*').eq('id', id).single();
      if (!before) throw Errors.notFound('售后类型不存在');
      const { data, error } = await supabase.from('after_sale_types').update(body).eq('id', id).select().single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('售后类型不存在');
        throw error;
      }
      await writeAudit(ctx, req, 'update', 'after_sale_type', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'after_sales.write');
      const { data: before } = await supabase.from('after_sale_types').select('*').eq('id', id).single();
      if (!before) throw Errors.notFound('售后类型不存在');
      // 被售后单引用的类型禁止删除
      const { data: refRows, error: refErr } = await supabase
        .from('after_sales')
        .select('id')
        .eq('type', before.value)
        .limit(1);
      if (refErr) throw refErr;
      if (refRows && refRows.length > 0) throw Errors.conflict('该类型已被售后单引用，无法删除');
      const { error } = await supabase.from('after_sale_types').delete().eq('id', id);
      if (error) {
        if (error.code === '23503') throw Errors.conflict('售后类型已被业务单据引用，无法删除');
        throw error;
      }
      await writeAudit(ctx, req, 'delete', 'after_sale_type', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}