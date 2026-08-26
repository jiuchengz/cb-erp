import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

// 商品跟踪明细：单个产品的全部发货批次状态（在途/到港/清关/已入仓时间线）+ 按天销量
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'products.read');

    const id = parse(uuidSchema, req.query.id);
    const salesFrom = typeof req.query.sales_from === 'string' && req.query.sales_from.trim() ? req.query.sales_from.trim() : '';
    const salesTo = typeof req.query.sales_to === 'string' && req.query.sales_to.trim() ? req.query.sales_to.trim() : '';
    const supabase = getAdminClient();

    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select('id, name, sku, code, link_id, overseas_stock')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (prodErr) {
      if (prodErr.code === 'PGRST116') throw Errors.notFound('商品不存在');
      throw prodErr;
    }

    // 1. 发货批次：该商品在 shipment_items 中的全部调拨发货明细（含已入仓历史）
    const { data: items, error: itemErr } = await supabase
      .from('shipment_items')
      .select('shipment_id, quantity')
      .eq('product_id', id);
    if (itemErr) throw itemErr;

    let shipments: any[] = [];
    if (items && items.length) {
      const shipmentIds = Array.from(new Set(items.map((it: any) => it.shipment_id))) as string[];
      const qtyByShipment = new Map<string, number>();
      for (const it of items || []) {
        qtyByShipment.set(it.shipment_id, (qtyByShipment.get(it.shipment_id) || 0) + Number(it.quantity || 0));
      }
      const { data: rows, error: shErr } = await supabase
        .from('shipments')
        .select('*, forwarders(name)')
        .in('id', shipmentIds)
        .is('deleted_at', null);
      if (shErr) throw shErr;
      shipments = (rows || [])
        .map((s: any) => ({
          id: s.id,
          tracking_no: s.tracking_no || '',
          cargo_code: s.cargo_code || '',
          cargo_status: s.cargo_status || '',
          estimated_arrival: s.estimated_arrival || '',
          ship_date: s.ship_date || '',
          status: s.status || '',
          created_at: s.created_at,
          updated_at: s.updated_at,
          forwarder: (s.forwarders as any)?.name || '',
          warehouse_status: s.warehouse_status || '',
          quantity: qtyByShipment.get(s.id) || 0,
        }))
        .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    }

    // 2. 按天销量：优先 product_id，其次 link_id 兜底
    const linkId = String(product.link_id || '').trim();
    let salesQuery: any = supabase
      .from('daily_sales')
      .select('sale_date, platform, quantity, refund_qty, unit_price');
    if (linkId) salesQuery = salesQuery.or(`product_id.eq.${id},link_id.eq.${linkId}`);
    else salesQuery = salesQuery.eq('product_id', id);
    if (salesFrom) salesQuery = salesQuery.gte('sale_date', salesFrom);
    if (salesTo) salesQuery = salesQuery.lte('sale_date', salesTo);
    salesQuery = salesQuery.order('sale_date', { ascending: false }).limit(200);
    const { data: salesRows, error: salesErr } = await salesQuery;
    if (salesErr) throw salesErr;

    return res.status(200).json({
      data: {
        product: {
          id: product.id,
          name: product.name,
          sku: product.sku,
          code: product.code,
          link_id: product.link_id,
          overseas_stock: Number(product.overseas_stock ?? 0),
        },
        shipments,
        in_transit_qty: shipments
          .filter((s: any) => s.cargo_status && s.cargo_status !== '已入仓')
          .reduce((acc: number, s: any) => acc + Number(s.quantity || 0), 0),
        sales: (salesRows || []).map((r: any) => ({
          sale_date: r.sale_date,
          platform: r.platform || '',
          quantity: Number(r.quantity || 0),
          refund_qty: Number(r.refund_qty || 0),
          unit_price: Number(r.unit_price || 0),
        })),
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
