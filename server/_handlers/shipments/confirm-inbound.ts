import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { uuidSchema, parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

// 确认入仓：发货管理货物状态变为「已入仓」后，将本货件明细涉及的产品
// 按销售统计(daily_sales)最新库存覆盖商品海外仓库存 products.overseas_stock；
// 销售统计中无记录的产品保持原值不变。
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));

    if (req.method !== 'POST') {
      return res.status(405).json({ error: { message: 'Method Not Allowed' } });
    }

    const ctx = await requireAuth(req);
    requirePermission(ctx, 'shipment.write');

    const id = parse(uuidSchema, String(req.query.id));
    const supabase = getAdminClient();

    // 1. 读取发货单及其明细
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('*, shipment_items(*)')
      .eq('id', id)
      .single();
    if (shipErr || !shipment) {
      throw Errors.notFound('发货单不存在');
    }
    const items: any[] = shipment.shipment_items ?? [];
    if (items.length === 0) {
      return res.json({ data: { updated: [], skipped: [], message: '该货件无产品明细，无需同步' } });
    }

    const productIds = Array.from(new Set(items.map((it) => it.product_id).filter(Boolean))) as string[];
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, link_id, overseas_stock')
      .in('id', productIds);
    if (prodErr) throw prodErr;

    // 2. 汇总本货件涉及的有 link_id 产品
    const withLink = (products ?? []).filter((p) => p.link_id && String(p.link_id).trim());
    const linkIds = Array.from(new Set(withLink.map((p) => String(p.link_id).trim())));

    // 3. 从销售统计取每个 link_id 最新 sale_date 的 overseas_stock
    const latestByLink = new Map<string, number>();
    if (linkIds.length > 0) {
      const { data: sales, error: saleErr } = await supabase
        .from('daily_sales')
        .select('link_id, sale_date, overseas_stock')
        .in('link_id', linkIds);
      if (saleErr) throw saleErr;
      const byLink = new Map<string, { sale_date: string; overseas_stock: number }>();
      for (const row of sales ?? []) {
        const lid = String(row.link_id).trim();
        const cur = byLink.get(lid);
        const d = String(row.sale_date || '');
        if (!cur || d > cur.sale_date) {
          byLink.set(lid, { sale_date: d, overseas_stock: Number(row.overseas_stock ?? 0) });
        }
      }
      byLink.forEach((v, k) => latestByLink.set(k, v.overseas_stock));
    }

    // 4. 按销售统计最新库存覆盖海外仓库存
    const updated: any[] = [];
    const skipped: any[] = [];
    for (const p of withLink) {
      const lid = String(p.link_id).trim();
      if (!latestByLink.has(lid)) {
        skipped.push({ product_id: p.id, link_id: lid, reason: '销售统计无记录，保持原值' });
        continue;
      }
      const newStock = latestByLink.get(lid) as number;
      const oldStock = Number(p.overseas_stock ?? 0);
      if (oldStock === newStock) {
        skipped.push({ product_id: p.id, link_id: lid, reason: '库存未变化' });
        continue;
      }
      const { error: updErr } = await supabase
        .from('products')
        .update({ overseas_stock: newStock })
        .eq('id', p.id);
      if (updErr) {
        skipped.push({ product_id: p.id, link_id: lid, reason: '更新失败: ' + updErr.message });
        continue;
      }
      updated.push({ product_id: p.id, link_id: lid, old_stock: oldStock, new_stock: newStock });
    }

    return res.json({ data: { updated, skipped } });
  } catch (e: any) {
    return handleError(e, res);
  }
}
