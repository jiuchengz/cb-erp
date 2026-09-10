import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, applyWarehouseFilter, hasUnrestrictedWarehouse } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';
import { writeAudit } from '../_lib/audit';
import { datePartInTz } from '../_lib/datetime';
import { collectUnarrived } from '../_lib/replenishment-unarrived';

// /api/replenishment/snapshots
//   GET  : 读取历史快照（只读，受仓库行级隔离）
//   POST : 生成/刷新某个"快照日"的未到货快照（写入 replenishment_unarrived_snapshots，见迁移 062）
//          鉴权二选一：
//            ① 定时任务：请求头 x-cron-secret === 环境变量 CRON_SECRET（服务端到服务端，全量仓库）
//            ② 登录账号：具备 replenishment.write 权限（按其可见仓库范围生成）
//          幂等：同一 snapshot_date 先删后插（重跑覆盖，不产生重复行）
//          注意：快照只能反映"采集当时"的未到货状态；补跑历史日期不等于历史时点回放。
const SNAPSHOT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const listSchema = z.object({
  date: z.string().regex(SNAPSHOT_DATE_RE).optional(),
  from: z.string().regex(SNAPSHOT_DATE_RE).optional(),
  to: z.string().regex(SNAPSHOT_DATE_RE).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const runSchema = z.object({
  snapshot_date: z.string().regex(SNAPSHOT_DATE_RE).optional(),
});

function isCronRequest(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET || '';
  const got = (req.headers['x-cron-secret'] as string) || '';
  return !!secret && got === secret;
}

async function runSnapshot(req: VercelRequest, res: VercelResponse) {
  const cron = isCronRequest(req);
  const supabase = getAdminClient();

  let warehouseIds: string[] | null = null;
  let ctx: any = null;
  if (!cron) {
    ctx = await requireAuth(req);
    requirePermission(ctx, 'replenishment.write');
    warehouseIds = hasUnrestrictedWarehouse(ctx) ? null : ctx.warehouseIds || [];
  }

  const body = parse(runSchema, req.body ?? {});
  const result = await collectUnarrived(supabase, { warehouseIds });
  const snapshotDate = body.snapshot_date || datePartInTz(new Date().toISOString(), result.timezone);
  if (!snapshotDate) throw Errors.badRequest('无法确定快照日期');

  // 幂等重跑：先清除该快照日的旧行，再按当前口径写入
  const { error: delErr } = await supabase
    .from('replenishment_unarrived_snapshots')
    .delete()
    .eq('snapshot_date', snapshotDate);
  if (delErr) throw delErr;

  const rows = result.cells.map((c) => ({
    snapshot_date: snapshotDate,
    group_date: c.group_date,
    warehouse_id: c.warehouse_id,
    product_id: c.product_id,
    sku: c.sku,
    code: c.code,
    name: c.name,
    unarrived_qty: c.quantity,
    item_count: c.item_count,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: insErr } = await supabase
      .from('replenishment_unarrived_snapshots')
      .insert(rows.slice(i, i + CHUNK));
    if (insErr) throw insErr;
  }

  if (ctx) {
    await writeAudit(ctx, req, 'snapshot', 'replenishment_unarrived_snapshots', snapshotDate, null, {
      row_count: rows.length,
    });
  }

  return res.status(200).json({
    data: {
      snapshot_date: snapshotDate,
      timezone: result.timezone,
      trigger: cron ? 'cron' : 'manual',
      row_count: rows.length,
      group_dates: Object.keys(result.orders_by_date).sort(),
      unarrived_orders: result.unarrived_orders,
      orders_without_items: result.orders_without_items,
      generated_at: new Date().toISOString(),
    },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));

    if (req.method === 'POST') return await runSnapshot(req, res);

    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET / POST' } });
    }

    const ctx = await requireAuth(req);
    requirePermission(ctx, 'replenishment.read');

    const q = parse(listSchema, req.query);
    const supabase = getAdminClient();
    let query: any = supabase
      .from('replenishment_unarrived_snapshots')
      .select('snapshot_date, group_date, warehouse_id, product_id, sku, code, name, unarrived_qty, item_count, created_at', {
        count: 'exact',
      });
    query = applyWarehouseFilter(query, ctx, 'warehouse_id');
    if (q.date) query = query.eq('snapshot_date', q.date);
    if (q.from) query = query.gte('snapshot_date', q.from);
    if (q.to) query = query.lte('snapshot_date', q.to);
    const limit = q.limit ?? 500;
    query = query
      .order('snapshot_date', { ascending: false })
      .order('group_date', { ascending: false })
      .order('unarrived_qty', { ascending: false })
      .range(0, limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.status(200).json({ data: data || [], total: count ?? (data || []).length });
  } catch (e) {
    return handleError(res, e);
  }
}
