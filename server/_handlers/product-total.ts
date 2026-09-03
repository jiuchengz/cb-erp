import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, bindProductWarehouseFilter, hasUnrestrictedWarehouse } from './_lib/rbac';
import { parse } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

// 商品总表分页：pageSize 默认 20，上限 200
const productTotalSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

// 分批执行 in() 查询：Supabase 网关对 URL 长度有限制（与 products.ts 同策略）
const IN_CHUNK_SIZE = 500;
async function queryInChunks(
  supabase: any,
  table: string,
  column: string,
  ids: string[],
  selectStr: string,
  extra?: (q: any) => any
): Promise<{ data: any[] | null; error: any }> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    let q: any = supabase.from(table).select(selectStr).in(column, chunk);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'products.read');

    const q = parse(productTotalSchema, req.query);
    const s = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const supabase = getAdminClient();

    // 一货一行可见性：全量账号（超管/总仓 null）= 全部商品；
    // 受限账号 = 绑定任一可见仓的商品（ids 为空自动空集）
    const bindFilter = bindProductWarehouseFilter(ctx);
    let query: any = supabase
      .from('products')
      .select(`id, code, name, unit, image_text, ${bindFilter.selectBind}`, { count: 'exact' })
      .is('deleted_at', null);
    query = bindFilter.filter(query);
    if (s) query = query.or(`code.ilike.%${s}%,name.ilike.%${s}%`);
    query = query.order('code', { ascending: true, nullsFirst: false });
    query = query.range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    const rows = (data || []).map((r: any) => {
      delete r.product_warehouses; // 绑定内嵌仅用于可见性过滤，不回传
      return r;
    });
    const pageIds = rows.map((r: any) => r.id);

    // 库存聚合：inventory join warehouses(warehouse_kind)，只统计可见仓库
    // - 全量(null)：所有 head/sub/overseas 仓库存合计；
    // - 受限：仅在 ctx.warehouseIds（可见仓）内的库存参与统计，按 kind 分三类合计。
    const headMap = new Map<string, number>();
    const subMap = new Map<string, number>();
    const ovsMap = new Map<string, number>();
    if (pageIds.length) {
      const invExtra = (qq: any) => {
        if (!hasUnrestrictedWarehouse(ctx) && (ctx.warehouseIds || []).length) {
          return qq.in('warehouse_id', ctx.warehouseIds || []);
        }
        return qq;
      };
      const { data: invRows, error: invErr } = await queryInChunks(
        supabase,
        'inventory',
        'product_id',
        pageIds,
        'product_id, quantity, warehouses!inner(warehouse_kind)',
        invExtra
      );
      if (invErr) throw invErr;
      for (const r of invRows || []) {
        const pid = r.product_id as string;
        const qty = Number(r.quantity || 0);
        const kind = (r.warehouses as any)?.warehouse_kind;
        if (kind === 'head') headMap.set(pid, (headMap.get(pid) || 0) + qty);
        else if (kind === 'sub') subMap.set(pid, (subMap.get(pid) || 0) + qty);
        else if (kind === 'overseas') ovsMap.set(pid, (ovsMap.get(pid) || 0) + qty);
      }
    }

    const out = rows.map((r: any) => ({
      code: r.code ?? '',
      name: r.name ?? '',
      unit: r.unit ?? '套',
      image_url: typeof r.image_text === 'string' && r.image_text.trim() ? r.image_text.trim() : null,
      head_stock: headMap.get(r.id) || 0,
      sub_stock: subMap.get(r.id) || 0,
      overseas_stock: ovsMap.get(r.id) || 0,
    }));

    return res.status(200).json({ data: out, total: count ?? 0, page: q.page, pageSize: q.pageSize });
  } catch (e) {
    return handleError(res, e);
  }
}
