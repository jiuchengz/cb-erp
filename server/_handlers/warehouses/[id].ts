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
  code: z.string().min(1).max(32).optional(),
  name: z.string().min(1).max(100).optional(),
  address: z.string().max(300).nullable().optional(),
  is_active: z.boolean().optional(),
  wh_type: z.enum(['domestic', 'overseas']).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'PATCH') {
      requirePermission(ctx, 'inventory.write');
      const body = parse(updateSchema, req.body || {});
      if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');
      const { data: before } = await supabase.from('warehouses').select('*').eq('id', id).single();
      if (!before) throw Errors.notFound('仓库不存在');
      const { data, error } = await supabase.from('warehouses').update(body).eq('id', id).select().single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict('仓库编码已存在');
        if (error.code === 'PGRST116') throw Errors.notFound('仓库不存在');
        throw error;
      }
      await writeAudit(ctx, req, 'update', 'warehouse', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'inventory.write');
      const { data: before } = await supabase.from('warehouses').select('*').eq('id', id).single();
      if (!before) throw Errors.notFound('仓库不存在');
      // 有库存记录的仓库禁止删除，避免级联清空库存
      const { data: invRows, error: invErr } = await supabase
        .from('inventory')
        .select('id')
        .eq('warehouse_id', id)
        .limit(1);
      if (invErr) throw invErr;
      if (invRows && invRows.length > 0) throw Errors.conflict('仓库下存在库存记录，请先清空库存再删除');
      const { error } = await supabase.from('warehouses').delete().eq('id', id);
      if (error) {
        // 采购单/发货单等外键引用
        if (error.code === '23503') throw Errors.conflict('仓库已被业务单据引用，无法删除');
        throw error;
      }
      await writeAudit(ctx, req, 'delete', 'warehouse', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
