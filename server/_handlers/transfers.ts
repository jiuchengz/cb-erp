import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const itemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
});

const createSchema = z.object({
  transfer_no: z.string().min(1).max(64),
  from_warehouse_id: z.string().uuid(),
  to_warehouse_id: z.string().uuid(),
  items: z.array(itemSchema).min(1).max(200),
}).refine((v) => v.from_warehouse_id !== v.to_warehouse_id, { message: '调出与调入仓库不能相同' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'transfer.read');
      const q = parse(paginationSchema, req.query);
      const supabase = getAdminClient();
      let query: any = supabase.from('transfers').select('*', { count: 'exact' });
      // 受限账号：调出仓或调入仓任一在可见仓集才可见
      if (!hasUnrestrictedWarehouse(ctx)) {
        const vis = ctx.warehouseIds || [];
        if (vis.length === 0) {
          query = query.in('from_warehouse_id', []);
        } else {
          query = query.or(`from_warehouse_id.in.(${vis.join(',')}),to_warehouse_id.in.(${vis.join(',')})`);
        }
      }
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      if (status) query = query.eq('status', status);
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: data || [], total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'transfer.write');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      // 受限账号：调出/调入仓库都必须在自己可见范围内
      if (!hasUnrestrictedWarehouse(ctx)) {
        const vis = new Set(ctx.warehouseIds || []);
        if (!vis.has(body.from_warehouse_id) || !vis.has(body.to_warehouse_id)) {
          throw Errors.forbidden('调出/调入仓库不在您的可见范围');
        }
      }

      const { data: transfer, error } = await supabase.from('transfers').insert({
        transfer_no: body.transfer_no,
        from_warehouse_id: body.from_warehouse_id,
        to_warehouse_id: body.to_warehouse_id,
        created_by: ctx.userId,
      }).select().single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`调拨单号已存在：${body.transfer_no}`);
        throw error;
      }

      const { error: itemErr } = await supabase.from('transfer_items').insert(
        body.items.map((it) => ({ transfer_id: transfer.id, product_id: it.product_id, quantity: it.quantity }))
      );
      if (itemErr) {
        await supabase.from('transfers').delete().eq('id', transfer.id);
        throw itemErr;
      }

      await writeAudit(ctx, req, 'create', 'transfer', transfer.id, null, { transfer_no: transfer.transfer_no, items: body.items.length });
      return res.status(201).json({ data: transfer });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
