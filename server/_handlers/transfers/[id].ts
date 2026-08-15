import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const TRANSFER_FLOW: Record<string, string[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['RECEIVED', 'CANCELLED'],
  PARTIAL: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

const updateSchema = z.object({
  status: z.enum(['DRAFT', 'APPROVED', 'SHIPPED', 'PARTIAL', 'RECEIVED', 'CANCELLED']),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'transfer.read');
      const { data, error } = await supabase.from('transfers').select('*, transfer_items(*)').eq('id', id).single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('调拨单不存在');
        throw error;
      }
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      const body = parse(updateSchema, req.body || {});
      const { data: before, error: getErr } = await supabase.from('transfers').select('*, transfer_items(*)').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('调拨单不存在');
        throw getErr;
      }

      const allowed = TRANSFER_FLOW[before.status] || [];
      if (!allowed.includes(body.status)) {
        throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
      }

      if (body.status === 'APPROVED') {
        requirePermission(ctx, 'transfer.approve');
      } else {
        requirePermission(ctx, 'transfer.write');
      }

      const items = before.transfer_items || [];

      // 出库：SHIPPED 时从调出仓库扣减
      if (body.status === 'SHIPPED' && before.status !== 'SHIPPED') {
        for (const it of items) {
          const { error: invErr } = await supabase.rpc('adjust_inventory', {
            p_product_id: it.product_id,
            p_warehouse_id: before.from_warehouse_id,
            p_quantity: -Number(it.quantity),
            p_type: 'transfer_out',
            p_reference_type: 'transfer',
            p_reference_id: id,
            p_created_by: ctx.userId,
            p_note: `调拨出库 ${before.transfer_no}`,
          });
          if (invErr) {
            if (invErr.message.includes('INSUFFICIENT_INVENTORY')) throw Errors.conflict('调出仓库库存不足');
            throw invErr;
          }
        }
      }

      // 入库：RECEIVED 时加到调入仓库
      if (body.status === 'RECEIVED' && before.status !== 'RECEIVED') {
        for (const it of items) {
          const { error: invErr } = await supabase.rpc('adjust_inventory', {
            p_product_id: it.product_id,
            p_warehouse_id: before.to_warehouse_id,
            p_quantity: Number(it.quantity),
            p_type: 'transfer_in',
            p_reference_type: 'transfer',
            p_reference_id: id,
            p_created_by: ctx.userId,
            p_note: `调拨入库 ${before.transfer_no}`,
          });
          if (invErr) throw invErr;
        }
        await supabase.from('transfer_items').update({ received_quantity: 0 }).eq('transfer_id', id).gt('quantity', 0);
        for (const it of items) {
          await supabase.from('transfer_items').update({ received_quantity: it.quantity }).eq('id', it.id);
        }
      }

      const { data, error } = await supabase.from('transfers').update({ status: body.status }).eq('id', id).select().single();
      if (error) throw error;

      await writeAudit(ctx, req, body.status === 'CANCELLED' ? 'cancel' : body.status, 'transfer', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'transfer.write');
      const { data: before, error: getErr } = await supabase.from('transfers').select('*').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('调拨单不存在');
        throw getErr;
      }
      const { error } = await supabase.from('transfers').delete().eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'transfer', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
