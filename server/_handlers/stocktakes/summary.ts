import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { getAdminClient } from '../_lib/db';
import { handleError } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

// 盘点差异复盘：汇总所有已完成盘点单的明细差异
// - by_product：按商品汇总盘盈/盘亏（数量与金额，金额按 unit_price 估算）
// - by_warehouse：按仓库汇总
// - totals：整体盘盈/盘亏合计
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'inventory.read');
    const supabase = getAdminClient();

    // 已完成盘点单
    const { data: stocktakes, error: stErr } = await supabase
      .from('stocktakes')
      .select('id, stocktake_no, warehouse_id, stocktake_date, warehouses!inner(name)')
      .eq('status', 'COMPLETED')
      .is('deleted_at', null);
    if (stErr) throw stErr;
    const stList = stocktakes || [];
    const stIds = stList.map((s: any) => s.id);

    const byProduct = new Map<string, any>();
    const byWarehouse = new Map<string, any>();
    let totals = { gain_qty: 0, loss_qty: 0, net_qty: 0, gain_amount: 0, loss_amount: 0, net_amount: 0 };

    if (stIds.length) {
      const { data: items, error: itErr } = await supabase
        .from('stocktake_items')
        .select('stocktake_id, product_id, book_quantity, actual_quantity, difference, products!inner(id, sku, name, unit_price, unit)')
        .in('stocktake_id', stIds);
      if (itErr) throw itErr;

      const stById = new Map(stList.map((s: any) => [s.id, s]));

      for (const it of items || []) {
        const diff = Number(it.difference || 0);
        if (diff === 0) continue;
        const st = stById.get(it.stocktake_id);
        const whId = st?.warehouse_id || '';
        const whName = st?.warehouses?.name || '未知仓库';
        const price = Number(it.products?.unit_price || 0);
        const amount = diff * price;

        // 按商品
        const pid = it.product_id;
        const p = byProduct.get(pid) || {
          product_id: pid,
          sku: it.products?.sku || '',
          name: it.products?.name || '',
          unit: it.products?.unit || '',
          unit_price: price,
          stocktake_count: 0,
          gain_qty: 0,
          loss_qty: 0,
          net_qty: 0,
          gain_amount: 0,
          loss_amount: 0,
          net_amount: 0,
        };
        p.stocktake_count += 1;
        if (diff > 0) {
          p.gain_qty += diff;
          p.gain_amount += amount;
        } else {
          p.loss_qty += -diff;
          p.loss_amount += -amount;
        }
        p.net_qty += diff;
        p.net_amount += amount;
        byProduct.set(pid, p);

        // 按仓库
        const w = byWarehouse.get(whId) || {
          warehouse_id: whId,
          warehouse_name: whName,
          stocktake_count: 0,
          gain_qty: 0,
          loss_qty: 0,
          net_qty: 0,
          gain_amount: 0,
          loss_amount: 0,
          net_amount: 0,
        };
        w.stocktake_count += 1;
        if (diff > 0) {
          w.gain_qty += diff;
          w.gain_amount += amount;
        } else {
          w.loss_qty += -diff;
          w.loss_amount += -amount;
        }
        w.net_qty += diff;
        w.net_amount += amount;
        byWarehouse.set(whId, w);

        // 总计
        if (diff > 0) {
          totals.gain_qty += diff;
          totals.gain_amount += amount;
        } else {
          totals.loss_qty += -diff;
          totals.loss_amount += -amount;
        }
        totals.net_qty += diff;
        totals.net_amount += amount;
      }
    }

    // 排序：按净差异绝对值降序，方便前端取 Top N
    const byProductList = Array.from(byProduct.values()).sort(
      (a: any, b: any) => Math.abs(b.net_qty) - Math.abs(a.net_qty)
    );
    const byWarehouseList = Array.from(byWarehouse.values()).sort(
      (a: any, b: any) => Math.abs(b.net_qty) - Math.abs(a.net_qty)
    );

    return res.status(200).json({
      data: {
        stocktake_count: stList.length,
        totals,
        by_product: byProductList,
        by_warehouse: byWarehouseList,
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
