import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const MAX_ROWS = 1000;

/**
 * 发货批量导入行（source=manual）
 * 字段与前端发货导入模板一致，其中 estimated_arrival 为文本（允许任意格式）
 */
const manualRowSchema = z.object({
  row_no: z.number().int().positive().optional(),
  ship_date: z.string().max(32).nullable().optional(),
  forwarder_name: z.string().max(128).nullable().optional(),
  shipping_mode: z.string().max(20).nullable().optional(),
  warehouse_no: z.string().max(50).nullable().optional(),
  shipping_cartons: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  shipping_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  shipment_no: z.string().min(1).max(100),
  product_code: z.string().max(100).nullable().optional(),
  billable_weight_vol: z.string().max(50).nullable().optional(),
  volume_diff: z.string().max(50).nullable().optional(),
  billable_amount: z.union([z.null(), z.coerce.number()]).optional(),
  estimated_arrival: z.string().max(32).nullable().optional(),
  cargo_status: z.string().max(20).nullable().optional(),
  appointment_time: z.string().max(32).nullable().optional(),
  warehouse_status: z.string().max(100).nullable().optional(),
  actual_warehouse_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  abnormal_penalty: z.string().max(500).nullable().optional(),
  bill_check_status: z.string().max(20).nullable().optional(),
});

/**
 * 调拨发货批量导入行（source=transfer）
 * 一行 = 一个明细；同一货件号多行聚合为一个调拨单（shipments.source=transfer + shipment_items）
 */
const transferRowSchema = z.object({
  row_no: z.number().int().positive().optional(),
  shipment_no: z.string().min(1).max(100),
  cargo_code: z.string().max(100).nullable().optional(),
  forwarder_name: z.string().max(128).nullable().optional(),
  shipping_mode: z.string().max(20).nullable().optional(),
  shipping_cartons: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  ship_date: z.string().max(32).nullable().optional(),
  product_code: z.string().min(1).max(100),
  quantity: z.coerce.number().positive(),
  remark: z.string().max(1000).nullable().optional(),
});

const importSchema = z.object({
  source: z.enum(['manual', 'transfer']).default('manual'),
  rows: z.array(z.unknown()).min(1).max(MAX_ROWS),
});

function cleanStr(v: unknown): string | null {
  if (v === '' || v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function cleanNum(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'shipment.write');

    const body = parse(importSchema, req.body || {});
    const supabase = getAdminClient();
    const source = body.source;
    const rawRows = body.rows as any[];
    const errors: { row: string; message: string }[] = [];

    // 预加载货代与商品映射
    const forwarderMap = new Map<string, string>();
    {
      const { data: fRows } = await supabase.from('forwarders').select('id, name');
      for (const f of fRows || []) {
        const n = cleanStr(f.name);
        if (n) forwarderMap.set(n, f.id);
      }
    }
    const productIdMap = new Map<string, string>();
    {
      const { data: pRows } = await supabase
        .from('products')
        .select('id, code, sku, barcode')
        .is('deleted_at', null);
      for (const p of pRows || []) {
        for (const key of [p.code, p.sku, p.barcode]) {
          const k = cleanStr(key);
          if (k && !productIdMap.has(k)) productIdMap.set(k, p.id);
        }
      }
    }

    const pushError = (rowNo: number | string, message: string) => {
      errors.push({ row: String(rowNo), message });
    };

    let created = 0;
    let updated = 0;
    let failedRows = 0;
    let transferOrders = 0;

    if (source === 'manual') {
      // 逐行解析
      const parsedRows: { row_no: number; ok: boolean; data?: any; err?: string }[] = [];
      rawRows.forEach((r, i) => {
        const rowNo = (r as any)?.row_no || i + 1;
        const parsed = manualRowSchema.safeParse(r);
        if (!parsed.success) {
          failedRows++;
          const msg = parsed.error.issues[0]?.message || '字段格式错误';
          pushError(rowNo, msg);
          parsedRows.push({ row_no: rowNo, ok: false });
          return;
        }
        parsedRows.push({ row_no: rowNo, ok: true, data: parsed.data });
      });

      // 预取已存在的货件号 -> id（仅创建/更新前查一次，避免逐行查询）
      const nos = Array.from(
        new Set(parsedRows.filter((p) => p.ok).map((p) => String(cleanStr(p.data.shipment_no) || '').trim()).filter(Boolean))
      );
      const existingMap = new Map<string, string>();
      for (let i = 0; i < nos.length; i += 500) {
        const chunk = nos.slice(i, i + 500);
        const { data: exRows } = await supabase
          .from('shipments')
          .select('id, shipment_no, tracking_no')
          .is('deleted_at', null)
          .in('shipment_no', chunk);
        for (const e of exRows || []) {
          const k = cleanStr(e.shipment_no);
          if (k && !existingMap.has(k)) existingMap.set(k, e.id);
        }
      }

      for (const p of parsedRows) {
        if (!p.ok || !p.data) continue;
        const r = p.data;
        const rowNo = p.row_no;
        const shipmentNo = cleanStr(r.shipment_no);
        if (!shipmentNo) {
          failedRows++;
          pushError(rowNo, '货件号为空，已跳过');
          continue;
        }
        let forwarderId: string | null = null;
        const fwName = cleanStr(r.forwarder_name);
        if (fwName) {
          forwarderId = forwarderMap.get(fwName) || null;
          if (!forwarderId) {
            failedRows++;
            pushError(rowNo, `货代「${fwName}」不存在，请先到系统设置维护货代`);
            continue;
          }
        }
        const payload: Record<string, unknown> = {
          warehouse_no: cleanStr(r.warehouse_no),
          ship_date: cleanStr(r.ship_date),
          forwarder_id: forwarderId,
          shipping_cartons: cleanNum(r.shipping_cartons),
          shipping_qty: cleanNum(r.shipping_qty),
          shipping_mode: cleanStr(r.shipping_mode),
          shipment_no: shipmentNo,
          product_code: cleanStr(r.product_code),
          billable_weight_vol: cleanStr(r.billable_weight_vol),
          volume_diff: cleanStr(r.volume_diff),
          billable_amount: cleanNum(r.billable_amount),
          estimated_arrival: cleanStr(r.estimated_arrival),
          cargo_status: cleanStr(r.cargo_status) || '转运中',
          appointment_time: cleanStr(r.appointment_time),
          warehouse_status: cleanStr(r.warehouse_status),
          actual_warehouse_qty: cleanNum(r.actual_warehouse_qty),
          abnormal_penalty: cleanStr(r.abnormal_penalty),
          bill_check_status: cleanStr(r.bill_check_status) || '待确认',
        };
        const existingId = existingMap.get(shipmentNo);
        try {
          if (existingId) {
            // 与现有编辑逻辑一致：更新单行字段（软删除过滤由查询保证）
            const { error: upErr } = await supabase.from('shipments').update(payload).eq('id', existingId);
            if (upErr) throw upErr;
            updated++;
          } else {
            const { error: inErr } = await supabase.from('shipments').insert({
              ...payload,
              tracking_no: shipmentNo,
              source: 'manual',
              created_by: ctx.userId,
            });
            if (inErr) {
              if (inErr.code === '23505') {
                failedRows++;
                pushError(rowNo, `货件号「${shipmentNo}」已存在（可能刚被创建），已跳过`);
                continue;
              }
              throw inErr;
            }
            created++;
          }
        } catch (e: any) {
          failedRows++;
          pushError(rowNo, e?.message || '写入失败');
        }
      }

      await writeAudit(ctx, req, 'import', 'shipment', undefined, undefined, {
        source: 'manual',
        rows: parsedRows.length,
        created,
        updated,
        failedRows,
      });
      return res.status(200).json({
        data: {
          source,
          total_rows: parsedRows.length,
          created,
          updated,
          transfer_orders: 0,
          failed_rows: failedRows,
          errors,
        },
      });
    }

    // ===== source=transfer 调拨批量导入 =====
    const transferRows: { row_no: number; ok: boolean; data?: any; err?: string }[] = [];
    rawRows.forEach((r, i) => {
      const rowNo = (r as any)?.row_no || i + 1;
      const parsed = transferRowSchema.safeParse(r);
      if (!parsed.success) {
        failedRows++;
        const msg = parsed.error.issues[0]?.message || '字段格式错误';
        pushError(rowNo, msg);
        transferRows.push({ row_no: rowNo, ok: false });
        return;
      }
      transferRows.push({ row_no: rowNo, ok: true, data: parsed.data });
    });

    // 按货件号分组
    const groups = new Map<string, { rows: { row_no: number; data: any }[] }>();
    for (const p of transferRows) {
      if (!p.ok || !p.data) continue;
      const shipmentNo = cleanStr(p.data.shipment_no);
      if (!shipmentNo) {
        failedRows++;
        pushError(p.row_no, '货件号为空，已跳过');
        continue;
      }
      if (!groups.has(shipmentNo)) groups.set(shipmentNo, { rows: [] });
      groups.get(shipmentNo)!.rows.push({ row_no: p.row_no, data: p.data });
    }

    const { data: domWh, error: domWhErr } = await supabase
      .from('warehouses')
      .select('id')
      .eq('wh_type', 'domestic')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (domWhErr) throw domWhErr;
    if (!domWh) throw Errors.conflict('暂无国内仓库，无法扣减国内库存');

    for (const [shipmentNo, group] of groups) {
      const rowNos = group.rows.map((r) => r.row_no);
      // 行号标签：纯数字或区间（如 "2" / "2-8"），由前端统一拼「第 X 行」避免重复前缀
      const rowLabel = rowNos.length === 1 ? String(rowNos[0]) : `${Math.min(...rowNos)}-${Math.max(...rowNos)}`;

      // 组级字段：取第一条非空值
      const first = group.rows[0].data;
      const fwName = group.rows.map((r) => cleanStr(r.data.forwarder_name)).find(Boolean) || null;
      const forwarderId = fwName ? forwarderMap.get(fwName) || null : null;
      if (!forwarderId) {
        failedRows += group.rows.length;
        pushError(rowLabel, `货代${fwName ? `「${fwName}」不存在，请先到系统设置维护货代` : '为空，请填写货代'}`);
        continue;
      }

      // 逐明细行校验产品与数量
      const items: { product_id: string; quantity: number; remark: string | null }[] = [];
      let groupFailed = 0;
      for (const r of group.rows) {
        const productCode = cleanStr(r.data.product_code);
        const productId = productCode ? productIdMap.get(productCode) : undefined;
        if (!productCode || !productId) {
          failedRows++;
          groupFailed++;
          pushError(r.row_no, `产品编码「${productCode || ''}」不存在，请核对商品管理中编码/SKU/条码`);
          continue;
        }
        const qty = cleanNum(r.data.quantity);
        if (qty === null || qty <= 0) {
          failedRows++;
          groupFailed++;
          pushError(r.row_no, '数量必须为大于 0 的数字');
          continue;
        }
        items.push({ product_id: productId, quantity: qty, remark: cleanStr(r.data.remark) });
      }
      if (groupFailed === group.rows.length || items.length === 0) continue;

      // 创建调拨单（与现有新增逻辑一致：source=transfer + items，库存联动扣减）
      const { data: shipment, error: insErr } = await supabase
        .from('shipments')
        .insert({
          tracking_no: shipmentNo,
          shipment_no: shipmentNo,
          cargo_code: cleanStr(first.cargo_code),
          forwarder_id: forwarderId,
          shipping_mode: cleanStr(first.shipping_mode),
          shipping_cartons: cleanNum(first.shipping_cartons),
          ship_date: cleanStr(first.ship_date),
          source: 'transfer',
          cargo_status: '转运中',
          created_by: ctx.userId,
        })
        .select()
        .single();
      if (insErr) {
        failedRows += group.rows.length;
        pushError(
          rowLabel,
          insErr.code === '23505' ? `货件号「${shipmentNo}」已存在，请用编辑功能修改或换号` : (insErr.message || '创建调拨单失败')
        );
        continue;
      }

      // 扣减国内库存：与 shipments.ts POST 一致，失败回滚已扣部分并删除货件
      const deducted: { product_id: string; quantity: number }[] = [];
      let stockFail: string | null = null;
      for (const it of items) {
        const { error: invErr } = await supabase.rpc('adjust_inventory', {
          p_product_id: it.product_id,
          p_warehouse_id: domWh.id,
          p_quantity: -it.quantity,
          p_type: 'transfer_out',
          p_reference_type: 'shipment',
          p_reference_id: shipment.id,
          p_created_by: ctx.userId,
          p_note: `调拨批量导入扣减 ${shipmentNo}`,
        });
        if (invErr) {
          stockFail = `国内库存不足，无法创建调拨发货：商品 ${it.product_id} 缺少 ${it.quantity} 件`;
          break;
        }
        deducted.push({ product_id: it.product_id, quantity: it.quantity });
      }
      if (stockFail) {
        for (const d of deducted) {
          await supabase.rpc('adjust_inventory', {
            p_product_id: d.product_id,
            p_warehouse_id: domWh.id,
            p_quantity: d.quantity,
            p_type: 'adjustment',
            p_reference_type: 'shipment',
            p_reference_id: shipment.id,
            p_created_by: ctx.userId,
            p_note: '调拨批量导入失败回滚',
          });
        }
        await supabase.from('shipments').delete().eq('id', shipment.id);
        failedRows += group.rows.length;
        pushError(rowLabel, stockFail);
        continue;
      }

      const { error: itemErr } = await supabase.from('shipment_items').insert(
        items.map((it) => ({
          shipment_id: shipment.id,
          product_id: it.product_id,
          quantity: it.quantity,
          remark: it.remark || null,
        }))
      );
      if (itemErr) {
        for (const d of deducted) {
          await supabase.rpc('adjust_inventory', {
            p_product_id: d.product_id,
            p_warehouse_id: domWh.id,
            p_quantity: d.quantity,
            p_type: 'adjustment',
            p_reference_type: 'shipment',
            p_reference_id: shipment.id,
            p_created_by: ctx.userId,
            p_note: '调拨批量导入失败回滚',
          });
        }
        await supabase.from('shipments').delete().eq('id', shipment.id);
        failedRows += group.rows.length;
        pushError(rowLabel, itemErr.message || '明细写入失败');
        continue;
      }

      transferOrders++;
      created += items.length;
      await writeAudit(ctx, req, 'create', 'shipment', shipment.id, null, {
        source: 'transfer',
        tracking_no: shipmentNo,
        items: items.length,
      });
    }

    await writeAudit(ctx, req, 'import', 'shipment', undefined, undefined, {
      source: 'transfer',
      rows: transferRows.length,
      created,
      updated,
      failedRows,
      transferOrders,
    });
    return res.status(200).json({
      data: {
        source,
        total_rows: transferRows.length,
        created,
        updated,
        transfer_orders: transferOrders,
        failed_rows: failedRows,
        errors,
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
