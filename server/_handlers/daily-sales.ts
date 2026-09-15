import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, loadVisibleLinkIds } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const importRowSchema = z.object({
  sale_date: z.string().min(1).max(20),
  platform: z.string().max(50).optional().default(''),
  link_id: z.string().min(1).max(200),
  product_name: z.string().max(200).optional().default(''),
  quantity: z.coerce.number().refine((v) => v !== 0, { message: 'quantity must not be 0' }),
  unit_price: z.coerce.number().min(0).optional().default(0),
  overseas_stock: z.coerce.number().min(0).optional().default(0),
  ad_group: z.string().max(100).optional().default(''),
});

/** 规范化业务文本字段：去首尾空白，防止平台/链接因前后空格产生重复 key */
function normText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(5000),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'sales.read');
      const q = parse(paginationSchema, req.query);
      const saleFrom = typeof req.query.sale_from === 'string' ? req.query.sale_from.trim() : '';
      const saleTo = typeof req.query.sale_to === 'string' ? req.query.sale_to.trim() : '';
      const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
      const platform = typeof req.query.platform === 'string' ? req.query.platform.trim() : '';
      const adGroup = typeof req.query.ad_group === 'string' ? req.query.ad_group.trim() : '';
      const linkId = typeof req.query.link_id === 'string' ? req.query.link_id.trim() : '';

      // 仓库级隔离：daily_sales 无 warehouse_id，通过 products.link_id 推导当前账号可见链接集。
      // super_admin 返回 null（不限制）；受限账号链接集可能很大，采用分批 in 查询后在内存统一排序分页。
      const visibleLinks = await loadVisibleLinkIds(supabase, ctx);
      if (visibleLinks && visibleLinks.size === 0) {
        return res.status(200).json({ data: [], total: 0, page: q.page, pageSize: q.pageSize, summary: { rows: 0, quantity: 0 } });
      }

      if (visibleLinks) {
        // 受限账号：分批拉取可见链接数据后内存过滤、排序与分页
        const chunkLinks = Array.from(visibleLinks);
        const collected: any[] = [];
        const CHUNK = 250;
        for (let i = 0; i < chunkLinks.length; i += CHUNK) {
          let cq: any = supabase.from('daily_sales').select('*').in('link_id', chunkLinks.slice(i, i + CHUNK));
          if (saleFrom) cq = cq.gte('sale_date', saleFrom);
          if (saleTo) cq = cq.lte('sale_date', saleTo);
          if (platform) cq = cq.eq('platform', platform);
          if (adGroup) cq = cq.eq('ad_group', adGroup);
          if (linkId) cq = cq.eq('link_id', linkId);
          if (keyword) {
            cq = cq.or(`link_id.ilike.%${keyword}%,product_name.ilike.%${keyword}%`);
          }
          const { data: rows, error: rowsErr } = await cq;
          if (rowsErr) throw rowsErr;
          collected.push(...(rows || []));
        }
        collected.sort(
          (a: any, b: any) => String(b.sale_date || '').localeCompare(String(a.sale_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || ''))
        );
        const totalCount = collected.length;
        const paged = collected.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
        const qty = collected.reduce((s: number, r: any) => s + Number(r.quantity || 0), 0);
        return res.status(200).json({
          data: paged,
          total: totalCount,
          page: q.page,
          pageSize: q.pageSize,
          summary: { rows: totalCount, quantity: qty },
        });
      }

      // 超管/不受限路径：沿用原分页查询
      let query: any = supabase.from('daily_sales').select('*', { count: 'exact' });
      if (saleFrom) query = query.gte('sale_date', saleFrom);
      if (saleTo) query = query.lte('sale_date', saleTo);
      if (platform) query = query.eq('platform', platform);
      if (adGroup) query = query.eq('ad_group', adGroup);
      if (linkId) query = query.eq('link_id', linkId);
      if (keyword) {
        query = query.or(`link_id.ilike.%${keyword}%,product_name.ilike.%${keyword}%`);
      }
      query = query.order('sale_date', { ascending: false }).order('created_at', { ascending: false })
        .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      // 汇总统计：总出单行数直接复用主查询的 exact count（过滤条件一致），
      // 不再重复发起一次带 count 的聚合查询；总销量需额外拉取轻量列 quantity
      // 在内存求和（PostgREST 无内置 sum 聚合，相比原实现已省去一次 count 扫描）。
      let sumQuery: any = supabase.from('daily_sales').select('quantity');
      if (saleFrom) sumQuery = sumQuery.gte('sale_date', saleFrom);
      if (saleTo) sumQuery = sumQuery.lte('sale_date', saleTo);
      if (platform) sumQuery = sumQuery.eq('platform', platform);
      if (adGroup) sumQuery = sumQuery.eq('ad_group', adGroup);
      if (linkId) sumQuery = sumQuery.eq('link_id', linkId);
      if (keyword) {
        sumQuery = sumQuery.or(`link_id.ilike.%${keyword}%,product_name.ilike.%${keyword}%`);
      }
      const { data: statRows } = await sumQuery;
      const totalQty = (statRows || []).reduce((s: number, r: any) => s + Number(r.quantity || 0), 0);

      return res.status(200).json({
        data: data || [],
        total: count ?? 0,
        page: q.page,
        pageSize: q.pageSize,
        summary: { rows: count ?? 0, quantity: totalQty },
      });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'sales.write');
      const body = parse(importSchema, req.body || {});

      // 规范化文本字段（去首尾空白），避免同义不同值的脏 key（如 platform/link_id 前后空格）
      const cleanRows = body.rows.map((r: any) => ({
        ...r,
        sale_date: normText(r.sale_date),
        platform: normText(r.platform),
        link_id: normText(r.link_id),
        product_name: normText(r.product_name),
        ad_group: normText(r.ad_group),
      }));

      // 预取涉及链接的产品售价（MXN），用于退款行无单价时兜底
      const linkIds = Array.from(new Set(cleanRows.map((r: any) => r.link_id).filter(Boolean)));
      let linkPriceMap = new Map<string, number>();
      if (linkIds.length > 0) {
        try {
          const { data: prodRows } = await supabase
            .from('products')
            .select('link_id, unit_price')
            .is('deleted_at', null)
            .in('link_id', linkIds);
          for (const p of prodRows || []) {
            const v = Number(p?.unit_price || 0);
            if (p?.link_id && v > 0 && !linkPriceMap.has(p.link_id)) linkPriceMap.set(p.link_id, v);
          }
        } catch {
          // 产品表查询失败不阻断导入，退款金额保持按导入单价计算
        }
      }

      // 按 (sale_date, platform, link_id) 聚合：正数=销售数量，负数=退款数量
      const keyMap = new Map<string, any>();
      for (const r of cleanRows) {
        const key = `${r.sale_date}|${r.platform}|${r.link_id}`;
        const cur = keyMap.get(key) || {
          sale_date: r.sale_date,
          platform: r.platform,
          link_id: r.link_id,
          product_name: r.product_name,
          ad_group: r.ad_group,
          quantity: 0,
          refund_qty: 0,
          refund_amount: 0,
          unit_price: 0,
          overseas_stock: r.overseas_stock || 0,
        };
        const q = Number(r.quantity) || 0;
        if (q > 0) {
          cur.quantity += q;
          cur.unit_price = Number(r.unit_price || 0) || cur.unit_price;
        } else {
          const rq = -q;
          // 退款单价优先用退款行单价，缺失时复用同链接销售行单价，再缺则用产品售价兜底
          const price = Number(r.unit_price || 0) || cur.unit_price || linkPriceMap.get(r.link_id) || 0;
          cur.refund_qty += rq;
          cur.refund_amount += rq * price;
          if (price > 0 && cur.unit_price === 0) cur.unit_price = price;
        }
        // 广告组取本次导入的非空值（后续行覆盖）
        if (r.ad_group) cur.ad_group = r.ad_group;
        keyMap.set(key, cur);
      }
      const rows = Array.from(keyMap.values()).map((r) => ({
        sale_date: r.sale_date,
        platform: r.platform,
        link_id: r.link_id,
        product_name: r.product_name,
        ad_group: r.ad_group || '',
        quantity: r.quantity,
        refund_qty: r.refund_qty,
        refund_amount: r.refund_amount,
        unit_price: r.unit_price,
        overseas_stock: r.overseas_stock,
        updated_at: new Date().toISOString(),
      }));

      // 幂等导入前置查询：先按 sale_date 范围取库中已有行，用于「重复判定」。
      // 语义为覆盖（与 030 迁移唯一约束的设计一致）：同一 (sale_date, platform, link_id)
      // 若库中数值与本次完全一致则跳过，不重复累加；有差异才以本次导入值覆盖。
      const saleDates = Array.from(new Set(rows.map((r: any) => r.sale_date)));
      const existingMap = new Map<string, any>();
      for (let i = 0; i < saleDates.length; i += 500) {
        const dateBatch = saleDates.slice(i, i + 500);
        const { data: existingRows, error: exErr } = await supabase
          .from('daily_sales')
          .select('*')
          .in('sale_date', dateBatch);
        if (exErr) throw exErr;
        for (const e of existingRows || []) {
          // 历史库值可能含前后空格，按清理后的 key 匹配，避免增量累加错位
          existingMap.set(`${e.sale_date}|${normText(e.platform)}|${normText(e.link_id)}`, e);
        }
      }

      const now = new Date().toISOString();
      // 重复判定：库中已有行与本次导入值在「销售数量 / 退款数量 / 退款金额」上完全一致时，
      // 视为同一张表格同一天同一销量的重复导入，直接跳过不写库（不再累加）；
      // 数值有差异才以本次导入值覆盖，避免重复导入把销量翻倍。
      const mergedRows: any[] = [];
      let updated = 0;
      let skipped = 0;
      for (const r of rows) {
        const key = `${r.sale_date}|${r.platform}|${r.link_id}`;
        const ex = existingMap.get(key);
        if (!ex) {
          mergedRows.push(r);
          continue;
        }
        const isDuplicate =
          Number(ex.quantity || 0) === Number(r.quantity || 0) &&
          Number(ex.refund_qty || 0) === Number(r.refund_qty || 0) &&
          Number(ex.refund_amount || 0) === Number(r.refund_amount || 0);
        if (isDuplicate) {
          skipped++;
          continue;
        }
        mergedRows.push({
          sale_date: r.sale_date,
          platform: r.platform,
          link_id: r.link_id,
          product_name: r.product_name || ex.product_name || '',
          ad_group: r.ad_group || ex.ad_group || '',
          quantity: Number(r.quantity) || 0,
          refund_qty: Number(r.refund_qty) || 0,
          refund_amount: Number(r.refund_amount) || 0,
          // unit_price / overseas_stock 取本次导入的非 0 值，为 0 时保留原值
          unit_price: Number(r.unit_price) > 0 ? r.unit_price : (Number(ex.unit_price) || 0),
          overseas_stock: Number(r.overseas_stock) > 0 ? r.overseas_stock : (Number(ex.overseas_stock) || 0),
          updated_at: now,
        });
        updated++;
      }

      if (mergedRows.length) {
        const { error } = await supabase.from('daily_sales').upsert(
          mergedRows,
          { onConflict: 'sale_date,platform,link_id' }
        );
        if (error) throw error;
      }

      const inserted = mergedRows.length - updated;

      await writeAudit(ctx, req, 'create', 'daily_sales', undefined, null, {
        rows: mergedRows.length,
        inserted,
        updated,
        skipped,
        sale_date: body.rows[0].sale_date,
      });
      return res.status(201).json({ data: { imported: mergedRows.length, inserted, updated, skipped, total: rows.length } });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
