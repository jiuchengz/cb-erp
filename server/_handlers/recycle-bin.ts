import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

// type 枚举 -> 表 / 标题字段 / 删除权限（与各 DELETE 接口保持一致）
const TYPES: Record<string, { table: string; titleField: string; write: string }> = {
  product: { table: 'products', titleField: 'name', write: 'products.delete' },
  sales_order: { table: 'sales_orders', titleField: 'order_no', write: 'sales.write' },
  purchase_order: { table: 'purchase_orders', titleField: 'order_no', write: 'procurement.write' },
  shipment: { table: 'shipments', titleField: 'tracking_no', write: 'shipment.write' },
  after_sale: { table: 'after_sales', titleField: 'order_no', write: 'after_sales.write' },
  replenishment_order: { table: 'replenishment_orders', titleField: 'order_no', write: 'replenishment.write' },
};

const typeSchema = z.enum(['product', 'sales_order', 'purchase_order', 'shipment', 'after_sale', 'replenishment_order']);

const actionSchema = z.object({
  type: typeSchema,
  id: z.string().uuid(),
});

function toItems(rows: any[], type: string, cfg: { table: string; titleField: string; write: string }) {
  return (rows || []).map((r: any) => ({
    type,
    id: r.id,
    title: r[cfg.titleField] ?? '',
    code: r[cfg.titleField] ?? '',
    status: r.status ?? null,
    deleted_at: r.deleted_at,
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();

    // ---------- GET /recycle-bin ----------
    if (req.method === 'GET') {
      requirePermission(ctx, 'system.manage'); // 回收站属系统管理整组，仅 system.manage 可见
      const typeRaw = typeof req.query.type === 'string' ? req.query.type.trim() : '';
      const page = Math.max(1, parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(typeof req.query.pageSize === 'string' ? req.query.pageSize : '20', 10) || 20));

      if (typeRaw) {
        const parsed = typeSchema.safeParse(typeRaw);
        if (!parsed.success) throw Errors.badRequest('无效的 type');
        const cfg = TYPES[parsed.data];
        const { data, count, error } = await supabase
          .from(cfg.table)
          .select(`id, ${cfg.titleField}, status, deleted_at`, { count: 'exact' })
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false })
          .range((page - 1) * pageSize, page * pageSize - 1);
        if (error) throw error;
        return res.status(200).json({
          data: {
            total: count ?? 0,
            page,
            pageSize,
            items: toItems(data, parsed.data, cfg),
          },
        });
      }

      // 全部类型：各表拉取后合并，按 deleted_at 倒序
      const tasks = Object.entries(TYPES).map(async ([type, cfg]) => {
        const { data, count, error } = await supabase
          .from(cfg.table)
          .select(`id, ${cfg.titleField}, status, deleted_at`, { count: 'exact' })
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false })
          .limit(2000);
        if (error) throw error;
        return { type, items: toItems(data, type, cfg), total: count ?? 0 };
      });
      const results = await Promise.all(tasks);
      const all = results
        .flatMap((r) => r.items)
        .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
      const total = results.reduce((s, r) => s + r.total, 0);
      const items = all.slice((page - 1) * pageSize, page * pageSize);
      return res.status(200).json({ data: { total, page, pageSize, items } });
    }

    // ---------- POST /recycle-bin/restore | /recycle-bin/purge ----------
    if (req.method === 'POST') {
      const path = new URL(req.url || '/', 'http://internal').pathname.replace(/^\/api/, '') || '/';
      const { type, id } = parse(actionSchema, req.body || {});
      const cfg = TYPES[type];
      requirePermission(ctx, 'system.manage'); // 恢复/清除同样仅 system.manage 可操作

      const { data: before, error: getErr } = await supabase.from(cfg.table).select('*').eq('id', id).maybeSingle();
      if (getErr) throw getErr;
      if (!before) throw Errors.notFound('记录不存在');
      if (!before.deleted_at) throw Errors.badRequest('该记录不在回收站中');

      if (path.endsWith('/recycle-bin/restore')) {
        // 恢复未入仓的调拨货件：对称扣回国内库存（删除时已回补）。
        // 先执行库存扣减并收集错误：任一 RPC 失败则整体失败（不执行恢复），
        // 避免恢复后库存与账面不一致。
        if (type === 'shipment' && (before as any).source === 'transfer' && before.cargo_status !== '已入仓') {
          const items = (before as any).shipment_items || [];
          if (items.length) {
            const { data: domWh, error: domWhErr } = await supabase
              .from('warehouses')
              .select('id')
              .eq('wh_type', 'domestic')
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle();
            if (domWhErr) throw domWhErr;
            if (domWh) {
              const rpcErrors: string[] = [];
              for (const it of items) {
                const { error: rpcErr } = await supabase.rpc('adjust_inventory', {
                  p_product_id: it.product_id,
                  p_warehouse_id: domWh.id,
                  p_quantity: -Number(it.quantity || 0),
                  p_type: 'transfer_out',
                  p_reference_type: 'shipment',
                  p_reference_id: id,
                  p_created_by: ctx.userId,
                  p_note: '调拨发货恢复扣减国内库存',
                });
                if (rpcErr) {
                  rpcErrors.push(`product ${it.product_id}: ${rpcErr.message || 'RPC 调用失败'}`);
                }
              }
              if (rpcErrors.length) {
                throw Errors.conflict('恢复货件时扣减国内库存失败：' + rpcErrors.join('; '));
              }
            }
          }
        }
        const { data, error } = await supabase.from(cfg.table).update({ deleted_at: null }).eq('id', id).select().single();
        if (error) throw error;
        await writeAudit(ctx, req, 'restore', type, id, before, data);
        return res.status(200).json({ ok: true, data });
      }

      if (path.endsWith('/recycle-bin/purge')) {
        const { error } = await supabase.from(cfg.table).delete().eq('id', id);
        if (error) throw error;
        await writeAudit(ctx, req, 'purge', type, id, before, null);
        return res.status(200).json({ ok: true });
      }

      throw Errors.notFound('未知操作');
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
