import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse, applyWarehouseFilter } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const itemSchema = z.object({
  product_id: z.string().uuid(),
  actual_quantity: z.coerce.number().min(0).default(0),
  remark: z.string().max(200).optional().nullable(),
});

const createSchema = z.object({
  warehouse_id: z.string().uuid(),
  stocktake_date: z.string().optional().nullable(),
  remark: z.string().max(500).optional().nullable(),
  items: z.array(itemSchema).max(500).optional(),
});

const updateSchema = z.object({
  warehouse_id: z.string().uuid().optional(),
  stocktake_date: z.string().optional().nullable(),
  remark: z.string().max(500).optional().nullable(),
  status: z.enum(['DRAFT', 'IN_PROGRESS']).optional(),
  items: z.array(itemSchema).max(500).optional(),
});

function pathOf(req: VercelRequest): string[] {
  return new URL(req.url || '/', 'http://internal').pathname.replace(/^\/api/, '').split('/').filter(Boolean);
}

async function genStocktakeNo(supabase: any): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `ST-${ymd}-`;
  const { data, error } = await supabase
    .from('stocktakes')
    .select('stocktake_no')
    .like('stocktake_no', `${prefix}%`)
    .order('stocktake_no', { ascending: false })
    .limit(1);
  if (error) throw error;
  const seq = (data && data.length ? parseInt((data[0].stocktake_no as string).slice(prefix.length), 10) || 0 : 0) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();
    const parts = pathOf(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'stocktake.read');

      // GET /api/stocktakes/:id 详情
      if (parts.length === 2) {
        const id = parts[1];
        const { data: st, error: stErr } = await supabase
          .from('stocktakes')
          .select('*, warehouses!inner(id, name)')
          .eq('id', id)
          .is('deleted_at', null)
          .single();
        if (stErr) {
          if (stErr.code === 'PGRST116') throw Errors.notFound('盘点单不存在');
          throw stErr;
        }
        const { data: items, error: itErr } = await supabase
          .from('stocktake_items')
          .select('*, products!inner(id, sku, name, code, unit)')
          .eq('stocktake_id', id)
          .order('id', { ascending: true });
        if (itErr) throw itErr;
        const totalDiff = (items || []).reduce(
          (acc: number, it: any) => acc + Number(it.difference || 0),
          0
        );
        return res.status(200).json({
          data: {
            ...st,
            warehouse_name: st.warehouses?.name || '',
            items: items || [],
            total_difference: totalDiff,
          },
        });
      }

      // GET /api/stocktakes 列表
      const q = parse(paginationSchema, req.query);
      let query: any = supabase
        .from('stocktakes')
        .select('*, warehouses!inner(id, name)', { count: 'exact' })
        .is('deleted_at', null);
      query = applyWarehouseFilter(query, ctx); // 受限账号仅可见其绑定仓库的盘点单
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      if (status) query = query.eq('status', status);
      const warehouseId = typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id.trim() : '';
      if (warehouseId) query = query.eq('warehouse_id', warehouseId);
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;

      const rows = data || [];
      const ids = rows.map((r: any) => r.id) as string[];
      const itemMap = new Map<string, { count: number; diff: number }>();
      if (ids.length) {
        const { data: itemRows, error: itemErr } = await supabase
          .from('stocktake_items')
          .select('stocktake_id, difference')
          .in('stocktake_id', ids);
        if (itemErr) throw itemErr;
        for (const it of itemRows || []) {
          const cur = itemMap.get(it.stocktake_id) || { count: 0, diff: 0 };
          cur.count += 1;
          cur.diff += Number(it.difference || 0);
          itemMap.set(it.stocktake_id, cur);
        }
      }
      return res.status(200).json({
        data: rows.map((r: any) => ({
          id: r.id,
          stocktake_no: r.stocktake_no,
          warehouse_id: r.warehouse_id,
          warehouse_name: r.warehouses?.name || '',
          stocktake_date: r.stocktake_date,
          status: r.status,
          remark: r.remark,
          created_at: r.created_at,
          updated_at: r.updated_at,
          item_count: itemMap.get(r.id)?.count || 0,
          total_difference: itemMap.get(r.id)?.diff || 0,
        })),
        total: count ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      });
    }

    if (req.method === 'POST' && parts.length === 3 && parts[2] === 'audit') {
      // POST /api/stocktakes/:id/audit 审核盘点单
      requirePermission(ctx, 'inventory.adjust');
      const id = parts[1];
      const { data: st, error: stErr } = await supabase
        .from('stocktakes')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .single();
      if (stErr) {
        if (stErr.code === 'PGRST116') throw Errors.notFound('盘点单不存在');
        throw stErr;
      }
      if (!hasUnrestrictedWarehouse(ctx) && !(ctx.warehouseIds || []).includes(st.warehouse_id)) {
        throw Errors.notFound('盘点单不存在');
      }
      if (st.status === 'COMPLETED') throw Errors.conflict('该盘点单已完成审核，不能重复审核');
      const { data: items, error: itErr } = await supabase
        .from('stocktake_items')
        .select('*')
        .eq('stocktake_id', id)
        .order('id', { ascending: true });
      if (itErr) throw itErr;
      if (!items || !items.length) throw Errors.badRequest('盘点单没有明细，请先添加盘点商品');

      // 预检：计算与当前账面的差额，盘亏不得超过账面（批量查询）
      const ids = items.map((it: any) => it.product_id);
      const { data: invList, error: invQErr } = await supabase
        .from('inventory')
        .select('product_id, quantity')
        .in('product_id', ids)
        .eq('warehouse_id', st.warehouse_id);
      if (invQErr) throw invQErr;
      const invMap = new Map((invList ?? []).map((r: any) => [r.product_id, Number(r.quantity ?? 0)]));
      const diffs: { item: any; diff: number }[] = [];
      for (const it of items) {
        const current = invMap.get(it.product_id) ?? 0;
        const diff = Number(it.actual_quantity || 0) - current;
        if (diff < 0 && -diff > current) {
          throw Errors.conflict(`商品 ${it.product_id} 盘亏数量超过账面库存（账面 ${current}）`);
        }
        diffs.push({ item: it, diff });
      }

      // 逐个调整库存并留流水
      for (const { item, diff } of diffs) {
        if (diff === 0) continue;
        const { error: invErr } = await supabase.rpc('adjust_inventory', {
          p_product_id: item.product_id,
          p_warehouse_id: st.warehouse_id,
          p_quantity: diff,
          p_type: diff > 0 ? 'stocktake_in' : 'stocktake_out',
          p_reference_type: 'stocktake',
          p_reference_id: id,
          p_created_by: ctx.userId,
          p_note: `库存盘点 ${st.stocktake_no}`,
        });
        if (invErr) throw invErr;
      }

      // 回填差异并置为已完成
      const { error: updErr } = await supabase.from('stocktakes').update({ status: 'COMPLETED', updated_at: new Date().toISOString() }).eq('id', id);
      if (updErr) throw updErr;
      for (const { item, diff } of diffs) {
        await supabase
          .from('stocktake_items')
          .update({ difference: diff })
          .eq('id', item.id);
      }
      const totalDiff = diffs.reduce((acc: number, d: any) => acc + d.diff, 0);
      await writeAudit(ctx, req, 'audit', 'stocktake', id, st, { stocktake_no: st.stocktake_no, total_difference: totalDiff });
      return res.status(200).json({ ok: true, total_difference: totalDiff });
    }

    if (req.method === 'POST') {
      // POST /api/stocktakes 创建盘点单
      requirePermission(ctx, 'inventory.adjust');
      const body = parse(createSchema, req.body || {});
      // 受限账号：只能创建可见仓库的盘点单
      if (!hasUnrestrictedWarehouse(ctx)) {
        const visSet = new Set(ctx.warehouseIds || []);
        if (!visSet.has(body.warehouse_id)) throw Errors.forbidden('您没有该仓库的盘点权限');
      }
      const stocktakeNo = await genStocktakeNo(supabase);
      const { data: st, error } = await supabase
        .from('stocktakes')
        .insert({
          stocktake_no: stocktakeNo,
          warehouse_id: body.warehouse_id,
          stocktake_date: body.stocktake_date || null,
          remark: body.remark || null,
          status: 'DRAFT',
          created_by: ctx.userId,
        })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict('盘点单号冲突，请重试');
        throw error;
      }

      if (body.items && body.items.length) {
        const ids = body.items.map((it: any) => it.product_id);
        const { data: invList, error: invQErr } = await supabase
          .from('inventory')
          .select('product_id, quantity')
          .in('product_id', ids)
          .eq('warehouse_id', body.warehouse_id);
        if (invQErr) throw invQErr;
        const invMap = new Map((invList ?? []).map((r: any) => [r.product_id, Number(r.quantity ?? 0)]));
        const rows: any[] = [];
        for (const it of body.items) {
          const book = invMap.get(it.product_id) ?? 0;
          rows.push({
            stocktake_id: st.id,
            product_id: it.product_id,
            book_quantity: book,
            actual_quantity: it.actual_quantity,
            difference: Number(it.actual_quantity || 0) - book,
            remark: it.remark || null,
          });
        }
        const { error: itemErr } = await supabase.from('stocktake_items').insert(rows);
        if (itemErr) {
          await supabase.from('stocktakes').delete().eq('id', st.id);
          throw itemErr;
        }
        await supabase.from('stocktakes').update({ status: 'IN_PROGRESS' }).eq('id', st.id);
      }

      await writeAudit(ctx, req, 'create', 'stocktake', st.id, null, { stocktake_no: st.stocktake_no });
      return res.status(201).json({ data: st });
    }

    if (req.method === 'PATCH') {
      // PATCH /api/stocktakes/:id 编辑（草稿/盘点中可改，已完成禁止）
      requirePermission(ctx, 'inventory.adjust');
      const id = parts[1];
      const { data: before, error: getErr } = await supabase
        .from('stocktakes')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('盘点单不存在');
        throw getErr;
      }
      if (!hasUnrestrictedWarehouse(ctx) && !(ctx.warehouseIds || []).includes(before.warehouse_id)) {
        throw Errors.notFound('盘点单不存在');
      }
      if (before.status === 'COMPLETED') throw Errors.conflict('盘点单已完成审核，不能编辑');

      const body = parse(updateSchema, req.body || {});
      if (!hasUnrestrictedWarehouse(ctx) && body.warehouse_id && body.warehouse_id !== before.warehouse_id) {
        const visSet = new Set(ctx.warehouseIds || []);
        if (!visSet.has(body.warehouse_id)) throw Errors.forbidden('您没有该仓库的盘点权限');
      }
      const warehouseId = body.warehouse_id || before.warehouse_id;
      const update: any = { updated_at: new Date().toISOString() };
      if (body.warehouse_id !== undefined) update.warehouse_id = body.warehouse_id;
      if (body.stocktake_date !== undefined) update.stocktake_date = body.stocktake_date;
      if (body.remark !== undefined) update.remark = body.remark;
      if (body.status) update.status = body.status;

      const { data: updated, error: updErr } = await supabase.from('stocktakes').update(update).eq('id', id).select().single();
      if (updErr) throw updErr;

      // 明细整体替换（仓库变化时重新抓账面，批量查询避免逐条拖慢）
      if (body.items !== undefined) {
        const { error: delErr } = await supabase.from('stocktake_items').delete().eq('stocktake_id', id);
        if (delErr) throw delErr;
        if (body.items.length) {
          const ids = body.items.map((it: any) => it.product_id);
          const { data: invList, error: invQErr } = await supabase
            .from('inventory')
            .select('product_id, quantity')
            .in('product_id', ids)
            .eq('warehouse_id', warehouseId);
          if (invQErr) throw invQErr;
          const invMap = new Map((invList ?? []).map((r: any) => [r.product_id, Number(r.quantity ?? 0)]));
          const rows: any[] = [];
          for (const it of body.items) {
            const book = invMap.get(it.product_id) ?? 0;
            rows.push({
              stocktake_id: id,
              product_id: it.product_id,
              book_quantity: book,
              actual_quantity: it.actual_quantity,
              difference: Number(it.actual_quantity || 0) - book,
              remark: it.remark || null,
            });
          }
          const { error: insErr } = await supabase.from('stocktake_items').insert(rows);
          if (insErr) throw insErr;
        }
        await supabase.from('stocktakes').update({ status: 'IN_PROGRESS' }).eq('id', id);
      }

      await writeAudit(ctx, req, 'update', 'stocktake', id, before, updated);
      return res.status(200).json({ data: updated });
    }

    if (req.method === 'DELETE') {
      // DELETE /api/stocktakes/:id 删除（仅未完成可删）
      requirePermission(ctx, 'inventory.adjust');
      const id = parts[1];
      const { data: before, error: getErr } = await supabase
        .from('stocktakes')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('盘点单不存在');
        throw getErr;
      }
      if (!hasUnrestrictedWarehouse(ctx) && !(ctx.warehouseIds || []).includes(before.warehouse_id)) {
        throw Errors.notFound('盘点单不存在');
      }
      if (before.status === 'COMPLETED') throw Errors.conflict('已完成审核的盘点单不能删除，如需修正请新建盘点单');
      const { error } = await supabase.from('stocktakes').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'stocktake', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
