import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

// 拿货批量导入：单次请求创建多张拿货单，避免前端逐行 await POST /purchase-orders 的串行慢导入。
// 行为对齐单条 POST /purchase-orders：
//   - 产品编码必须存在
//   - 仓库：非受限账号未传取首个国内仓；受限账号必须显式传自己有权限的国内仓
//   - 新增拿货默认 status=ARRIVED（待入库），不自动入库
//   - source_type 默认 purchase
//   - 单号唯一冲突自动重试一次
// 另外执行重复拦截：同一仓库下已存在「相同产品编码 + 相同数量 + 相同拿货日期」的未删除拿货记录时跳过不录入；
// 批内后出现的相同行同样拦截（创建成功后把该 key 加入已存在集合）。

const MAX_ROWS = 1000;

const rowSchema = z.object({
  row_no: z.number().int().positive().optional(), // Excel 数据行号（表头下一行=2），仅用于结果明细回显
  product_code: z.string().min(1).max(64),
  quantity: z.coerce.number().positive(),
  receive_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  remark: z.string().max(500).optional(),
  source_type: z.string().max(50).optional(),
});

const batchSchema = z.object({
  warehouse_id: z.string().uuid().optional(), // 整批统一入库仓库（前端导入弹窗选择）
  rows: z.array(rowSchema).min(1).max(MAX_ROWS),
});

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function genOrderNo(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `CG-${y}${m}${day}-${rand}`;
}

// 数量归一化用于重复 key：DB numeric 可能返回字符串（如 '100.00'），统一转 Number 文本避免误判
function qtyKey(q: unknown) {
  const n = Number(q);
  return Number.isFinite(n) ? String(n) : String(q);
}

async function insertOrder(
  supabase: any,
  orderNo: string,
  warehouseId: string,
  receiveDate: string,
  row: z.infer<typeof rowSchema>,
  userId: string
) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .insert({
      order_no: orderNo,
      supplier: null,
      warehouse_id: warehouseId,
      receive_date: receiveDate,
      remark: row.remark || null,
      status: 'ARRIVED', // 新增拿货默认待入库；入库由流转/批量入库置 RECEIVED 时执行
      source_type: row.source_type || 'purchase',
      total_amount: 0,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function insertItem(supabase: any, orderId: string, productId: string, quantity: number) {
  const { error } = await supabase.from('purchase_order_items').insert({
    order_id: orderId,
    product_id: productId,
    quantity,
    received_quantity: 0,
    unit_price: 0,
    subtotal: 0,
  });
  if (error) throw error;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'procurement.write');

    const body = parse(batchSchema, req.body || {});
    const supabase = getAdminClient();

    // ===== 仓库校验（整批统一仓库，与单条 POST 规则一致）=====
    const visSet = new Set(ctx.warehouseIds || []);
    let warehouseId: string;
    if (body.warehouse_id) {
      // 受限账号必须显式选择自己有可见权限的仓库
      if (!hasUnrestrictedWarehouse(ctx) && !visSet.has(body.warehouse_id)) {
        throw Errors.forbidden('您没有该仓库的拿货权限，请选择可见仓库');
      }
      const { data: wh, error: whErr } = await supabase
        .from('warehouses')
        .select('id, wh_type')
        .eq('id', body.warehouse_id)
        .maybeSingle();
      if (whErr) throw whErr;
      if (!wh) throw Errors.conflict('仓库不存在');
      if (wh.wh_type !== 'domestic') throw Errors.conflict('拿货只能选择国内仓库入库');
      warehouseId = wh.id;
    } else {
      if (!hasUnrestrictedWarehouse(ctx)) {
        throw Errors.forbidden('您没有该仓库的拿货权限，请选择可见仓库');
      }
      const { data: warehouse, error: whErr } = await supabase
        .from('warehouses')
        .select('id')
        .eq('wh_type', 'domestic')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (whErr) throw whErr;
      if (!warehouse) throw Errors.conflict('暂无国内仓库，请先创建国内仓库');
      warehouseId = warehouse.id;
    }

    // ===== 预载产品（按编码批量匹配，一次查询，避免逐行查）=====
    const codes = Array.from(new Set(body.rows.map((r) => r.product_code.trim()).filter(Boolean)));
    const productMap = new Map<string, { id: string; sku: string; code: string }>();
    for (let i = 0; i < codes.length; i += 500) {
      const chunk = codes.slice(i, i + 500);
      const { data: products, error: prodErr } = await supabase
        .from('products')
        .select('id, sku, code, name')
        .is('deleted_at', null)
        .in('code', chunk);
      if (prodErr) throw prodErr;
      for (const p of products || []) {
        if (p.code && !productMap.has(p.code)) productMap.set(p.code, p);
      }
    }

    // ===== 预载该仓库未删除拿货记录（含明细），构建重复 key 集合 =====
    const validRows = body.rows.filter((r) => productMap.has(r.product_code.trim()));
    const productIds = Array.from(new Set(validRows.map((r) => productMap.get(r.product_code.trim())!.id)));
    // 历史记录日期统一取前 10 位（YYYY-MM-DD，兼容 date 列返回带时间戳）拼入 key
    const dateKey = (d: unknown) => (d ? String(d).slice(0, 10) : '');
    const dupKeys = new Set<string>();
    {
      const { data: orders } = await supabase
        .from('purchase_orders')
        .select('warehouse_id, receive_date, purchase_order_items!inner(product_id, quantity)')
        .is('deleted_at', null)
        .eq('warehouse_id', warehouseId)
        .in('purchase_order_items.product_id', productIds);
      for (const o of orders || []) {
        for (const it of o.purchase_order_items || []) {
          if (productIds.includes(it.product_id)) {
            dupKeys.add(`${warehouseId}|${it.product_id}|${qtyKey(it.quantity)}|${dateKey(o.receive_date)}`);
          }
        }
      }
    }

    // ===== 逐行创建 =====
    const seenKeys = new Set(dupKeys); // 批内成功后追加，拦截批内后出现的相同行
    let created = 0;
    let duplicate = 0;
    let failed = 0;
    const results: {
      row_no: number;
      product_code: string;
      quantity: number;
      receive_date?: string;
      status: 'created' | 'duplicate' | 'failed';
      message?: string;
    }[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      const rowNo = row.row_no || i + 2;
      const code = row.product_code.trim();
      const result: any = { row_no: rowNo, product_code: code, quantity: row.quantity };
      try {
        const product = productMap.get(code);
        if (!product) {
          result.status = 'failed';
          result.message = `产品编码不存在：${code}`;
          failed++;
          results.push(result);
          continue;
        }
        // 判重口径与实际落库一致：未填日期按当天计算
        const receiveDate = row.receive_date || todayStr();
        const key = `${warehouseId}|${product.id}|${qtyKey(row.quantity)}|${receiveDate}`;
        if (seenKeys.has(key)) {
          result.status = 'duplicate';
          result.message = '同仓库下已有相同产品编码、数量和拿货日期的拿货记录';
          result.receive_date = receiveDate;
          duplicate++;
          results.push(result);
          continue;
        }
        // 单号唯一冲突时重试一次（与单条 POST 一致）
        let order: any;
        try {
          order = await insertOrder(supabase, genOrderNo(), warehouseId, receiveDate, row, ctx.userId);
        } catch (e: any) {
          if (e?.code !== '23505') throw e;
          order = await insertOrder(supabase, genOrderNo(), warehouseId, receiveDate, row, ctx.userId);
        }
        try {
          await insertItem(supabase, order.id, product.id, row.quantity);
        } catch (e: any) {
          // 明细写入失败回滚主单，避免产生无明细的孤儿拿货单
          await supabase.from('purchase_orders').delete().eq('id', order.id);
          throw e;
        }

        seenKeys.add(key);
        created++;
        result.status = 'created';
      } catch (e: any) {
        result.status = 'failed';
        result.message = e?.message || '创建失败';
        failed++;
      }
      results.push(result);
    }

    // 一次性汇总写审计（避免批量导入为每行单独写审计）
    await writeAudit(ctx, req, 'import', 'purchase_order', undefined, undefined, {
      warehouse_id: warehouseId,
      rows: body.rows.length,
      created,
      duplicate,
      failed,
    });

    return res.status(200).json({
      data: {
        total_rows: body.rows.length,
        warehouse_id: warehouseId,
        created,
        duplicate,
        failed,
        results,
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
