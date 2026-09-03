import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, assertShipmentStoreVisible, hasUnrestrictedWarehouse, loadVisibleStoreNames } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const SHIPMENT_FLOW: Record<string, string[]> = {
  PENDING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

const updateSchema = z.object({
  status: z.enum(['PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']).optional(),
  forwarder_id: z.string().uuid().nullable().optional(),
  cargo_status: z.string().max(20).nullable().optional(),
  warehouse_status: z.string().max(100).nullable().optional(),
  actual_warehouse_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  abnormal_penalty: z.string().max(500).nullable().optional(),
  bill_check_status: z.string().max(20).nullable().optional(),
  bill_check_time: z.string().datetime().nullable().optional(),
  appointment_time: z.string().max(32).nullable().optional(),
  // 新表单字段
  warehouse_no: z.string().max(50).nullable().optional(),
  ship_date: z.string().max(32).nullable().optional(),
  shipping_cartons: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  shipping_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  shipping_mode: z.string().max(20).nullable().optional(),
  shipment_no: z.string().min(1).max(100).nullable().optional(),
  product_code: z.string().max(100).nullable().optional(),
  billable_weight_vol: z.string().max(50).nullable().optional(),
  volume_diff: z.string().max(50).nullable().optional(),
  billable_amount: z.union([z.null(), z.coerce.number()]).optional(),
  pull_declare_qty: z.union([z.null(), z.coerce.number().nonnegative()]).optional(),
  estimated_arrival: z.string().max(32).nullable().optional(),
  // 调拨发货管理字段
  cargo_code: z.string().max(100).nullable().optional(),
  store: z.string().max(100).nullable().optional(),
  tracking_no: z.string().max(100).nullable().optional(),
  items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.coerce.number().positive(), remark: z.string().max(1000).nullable().optional() })).min(1).max(200).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'shipment.read');
      const { data, error } = await supabase.from('shipments').select('*, forwarders(name), shipment_items(*)').eq('id', id).is('deleted_at', null).single();
      if (error) {
        if (error.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw error;
      }
      await assertShipmentStoreVisible(supabase, ctx, (data as any)?.store);
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      requirePermission(ctx, 'shipment.write');
      const body = parse(updateSchema, req.body || {});
      if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');
      const { data: before, error: getErr } = await supabase.from('shipments').select('*, forwarders(name), shipment_items(*)').eq('id', id).is('deleted_at', null).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw getErr;
      }
      await assertShipmentStoreVisible(supabase, ctx, (before as any)?.store);
      // 受限账号不允许将货件划归到不可见店铺 / 清空店铺
      if (!hasUnrestrictedWarehouse(ctx) && body.store !== undefined) {
        const stores = (await loadVisibleStoreNames(supabase, ctx)) || new Set<string>();
        const storeName = typeof body.store === 'string' ? body.store.trim() : '';
        if (!stores.has(storeName)) throw Errors.forbidden('无权将货件划归该店铺');
      }

      const update: Record<string, unknown> = {};
      if (body.status !== undefined) {
        const allowed = SHIPMENT_FLOW[before.status] || [];
        if (!allowed.includes(body.status)) {
          throw Errors.conflict(`非法状态转换：${before.status} -> ${body.status}`);
        }
        update.status = body.status;
      }
      // 货件号变更时：若新货件号已存在于发货管理（source=manual），执行「绑定合并」——
      // 将当前调拨记录并入该发货记录（软删除当前记录，目标记录升级为调拨发货并写入最新明细），
      // 使同一货件号在发货管理与调拨发货管理中成为同一条记录
      if (body.tracking_no !== undefined && body.tracking_no !== before.tracking_no) {
        const newNo = String(body.tracking_no || '').trim();
        if (!newNo) throw Errors.badRequest('货件号不能为空');
        const { data: target, error: tgtErr } = await supabase
          .from('shipments')
          .select('id, source, cargo_status')
          .is('deleted_at', null)
          .eq('tracking_no', newNo)
          .maybeSingle();
        if (tgtErr) throw tgtErr;
        if (target && target.id !== id) {
          if (target.source === 'transfer') {
            throw Errors.conflict(`货件号已存在于其他调拨发货记录：${newNo}`);
          }
          // source === 'manual'：绑定合并，仅允许当前记录未进入发货流程（未扣减库存）时执行
          if ((before as any).cargo_status !== '待发货') {
            throw Errors.conflict(
              `当前货件已进入发货流程（${(before as any).cargo_status}），无法改号绑定；请在调拨发货管理中新建货件号 ${newNo}`
            );
          }
          if (body.cargo_status !== undefined && body.cargo_status !== '待发货') {
            throw Errors.conflict('改号绑定时货物状态须保持「待发货」，保存后可在列表中再修改状态');
          }
          // 1. 软删除当前调拨记录
          const { error: delErr } = await supabase
            .from('shipments')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id);
          if (delErr) throw delErr;
          // 2. 升级目标发货记录为调拨发货，写入最新字段
          const mergedUpdate: Record<string, unknown> = {
            source: 'transfer',
            tracking_no: newNo,
            shipment_no: newNo,
            cargo_code: body.cargo_code ?? (before as any).cargo_code ?? null,
            store: body.store ?? (before as any).store ?? null,
            forwarder_id: body.forwarder_id ?? (before as any).forwarder_id ?? null,
            shipping_mode: body.shipping_mode ?? (before as any).shipping_mode ?? null,
            shipping_cartons: body.shipping_cartons ?? (before as any).shipping_cartons ?? 0,
            shipping_qty: body.shipping_qty ?? (before as any).shipping_qty ?? 0,
            ship_date: body.ship_date ?? (before as any).ship_date ?? null,
            product_code: body.cargo_code ?? (before as any).cargo_code ?? null,
            cargo_status: body.cargo_status ?? (before as any).cargo_status ?? '待发货',
          };
          const { data: merged, error: upErr } = await supabase
            .from('shipments')
            .update(mergedUpdate)
            .eq('id', target.id)
            .select()
            .single();
          if (upErr) {
            // 合并失败：恢复当前记录（取消软删除），避免数据丢失
            await supabase.from('shipments').update({ deleted_at: null }).eq('id', id);
            throw upErr;
          }
          // 3. 明细以编辑表单为准
          if (body.items && body.items.length > 0) {
            const { error: delItemsErr } = await supabase.from('shipment_items').delete().eq('shipment_id', target.id);
            if (delItemsErr) throw delItemsErr;
            const { error: insItemsErr } = await supabase.from('shipment_items').insert(
              body.items.map((it) => ({
                shipment_id: target.id,
                product_id: it.product_id,
                quantity: it.quantity,
                remark: it.remark || null,
              }))
            );
            if (insItemsErr) throw insItemsErr;
          }
          await writeAudit(ctx, req, 'update', 'shipment', id, before, merged);
          return res.status(200).json({
            data: merged,
            bound: true,
            message: `已绑定发货管理货件号 ${newNo}，原调拨记录已合并`,
          });
        }
        // 未命中未删除记录时，检查回收站（软删除）中是否仍占用该货件号：
        // 软删除记录仍占 tracking_no 唯一索引，若不复用会导致 update 报 23505，
        // 故自动将回收站记录货件号追加删除标记释放占用
        const { data: recycled, error: rcErr } = await supabase
          .from('shipments')
          .select('id')
          .eq('tracking_no', newNo)
          .not('deleted_at', 'is', null)
          .maybeSingle();
        if (rcErr) throw rcErr;
        if (recycled) {
          const releaseNo = `${newNo.slice(0, 80)}__DEL_${recycled.id.slice(0, 8)}`;
          const { error: relErr } = await supabase
            .from('shipments')
            .update({ tracking_no: releaseNo })
            .eq('id', recycled.id);
          if (relErr) throw relErr;
        }
        update.tracking_no = body.tracking_no;
      }
      if (body.forwarder_id !== undefined) update.forwarder_id = body.forwarder_id;
      if (body.cargo_status !== undefined) update.cargo_status = body.cargo_status;
      if (body.warehouse_status !== undefined) update.warehouse_status = body.warehouse_status;
      if (body.actual_warehouse_qty !== undefined) update.actual_warehouse_qty = body.actual_warehouse_qty;
      if (body.abnormal_penalty !== undefined) update.abnormal_penalty = body.abnormal_penalty;
      if (body.appointment_time !== undefined) update.appointment_time = body.appointment_time;
      if (body.bill_check_time !== undefined) {
        update.bill_check_time = body.bill_check_time;
      } else if (body.bill_check_status !== undefined && body.bill_check_status !== before.bill_check_status) {
        // 账单核对状态变更时自动记录核对时间
        update.bill_check_time = new Date().toISOString();
      }
      if (body.bill_check_status !== undefined) update.bill_check_status = body.bill_check_status;
      // 新表单字段
      if (body.warehouse_no !== undefined) update.warehouse_no = body.warehouse_no;
      if (body.ship_date !== undefined) update.ship_date = body.ship_date;
      if (body.shipping_cartons !== undefined) update.shipping_cartons = body.shipping_cartons;
      if (body.shipping_qty !== undefined) update.shipping_qty = body.shipping_qty;
      if (body.shipping_mode !== undefined) update.shipping_mode = body.shipping_mode;
      if (body.shipment_no !== undefined) update.shipment_no = body.shipment_no;
      if (body.product_code !== undefined) update.product_code = body.product_code;
      if (body.billable_weight_vol !== undefined) update.billable_weight_vol = body.billable_weight_vol;
      if (body.volume_diff !== undefined) update.volume_diff = body.volume_diff;
      if (body.billable_amount !== undefined) update.billable_amount = body.billable_amount;
      if (body.pull_declare_qty !== undefined) update.pull_declare_qty = body.pull_declare_qty;
      if (body.estimated_arrival !== undefined) update.estimated_arrival = body.estimated_arrival;
      if (body.cargo_code !== undefined) update.cargo_code = body.cargo_code;
      if (body.store !== undefined) update.store = body.store;

      // 调拨发货确认发货：货物状态由「待发货」变为其他状态时，扣减国内仓库库存（transfer_out）
      const confirmItems = (body.items && body.items.length ? body.items : (before as any).shipment_items) || [];
      const willConfirmShipment =
        (before as any).source === 'transfer' &&
        before.cargo_status === '待发货' &&
        body.cargo_status !== undefined &&
        body.cargo_status !== '待发货';
      let deductedDomestic = false;
      if (willConfirmShipment) {
        const { data: domWh, error: domWhErr } = await supabase
          .from('warehouses')
          .select('id')
          .eq('wh_type', 'domestic')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (domWhErr) throw domWhErr;
        if (!domWh) throw Errors.conflict('暂无国内仓库，无法扣减国内库存');
        for (const it of confirmItems) {
          const { error: invErr } = await supabase.rpc('adjust_inventory', {
            p_product_id: it.product_id,
            p_warehouse_id: domWh.id,
            p_quantity: -Number(it.quantity || 0),
            p_type: 'transfer_out',
            p_reference_type: 'shipment',
            p_reference_id: id,
            p_created_by: ctx.userId,
            p_note: `调拨发货确认发货（${before.cargo_status}→${body.cargo_status}）${before.tracking_no || before.shipment_no || id}`,
          });
          if (invErr) throw invErr;
        }
        deductedDomestic = true;
      }

      const { data, error } = await supabase.from('shipments').update(update).eq('id', id).select().single();
      if (error) {
        // 已扣减国内库存但更新失败：回补，保持数据一致
        if (deductedDomestic) {
          const { data: domWh, error: domWhErr } = await supabase
            .from('warehouses')
            .select('id')
            .eq('wh_type', 'domestic')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!domWhErr && domWh) {
            for (const it of confirmItems) {
              await supabase.rpc('adjust_inventory', {
                p_product_id: it.product_id,
                p_warehouse_id: domWh.id,
                p_quantity: Number(it.quantity || 0),
                p_type: 'transfer_in',
                p_reference_type: 'shipment',
                p_reference_id: id,
                p_created_by: ctx.userId,
                p_note: `调拨发货状态更新失败回补 ${before.tracking_no || before.shipment_no || id}`,
              });
            }
          }
        }
        if (error.code === '23503') throw Errors.conflict('关联的货代不存在');
        if (error.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw error;
      }

      // 调拨发货货物状态变为「已入仓」：自动增加海外仓库存（仅从未入仓变为已入仓时执行一次）
      const becameInbound =
        (before as any).source === 'transfer' &&
        before.cargo_status !== '已入仓' &&
        body.cargo_status === '已入仓';
      if (becameInbound) {
        const items = (body.items && body.items.length ? body.items : (before as any).shipment_items) || [];
        const { data: ovsWh, error: ovsWhErr } = await supabase
          .from('warehouses')
          .select('id')
          .eq('wh_type', 'overseas')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (ovsWhErr) throw ovsWhErr;
        if (!ovsWh) throw Errors.conflict('暂无海外仓库，无法增加海外库存');
        for (const it of items) {
          const { error: invErr } = await supabase.rpc('adjust_inventory', {
            p_product_id: it.product_id,
            p_warehouse_id: ovsWh.id,
            p_quantity: Number(it.quantity || 0),
            p_type: 'transfer_in',
            p_reference_type: 'shipment',
            p_reference_id: id,
            p_created_by: ctx.userId,
            p_note: `调拨发货已入仓 ${data.tracking_no || data.shipment_no || id}`,
          });
          if (invErr) throw invErr;
        }
      }

      // 明细整体替换：先删旧明细，再插入新明细
      if (body.items && body.items.length > 0) {
        const { error: delErr } = await supabase.from('shipment_items').delete().eq('shipment_id', id);
        if (delErr) throw delErr;
        const { error: insErr } = await supabase
          .from('shipment_items')
          .insert(
            body.items.map((it) => ({
              shipment_id: id,
              product_id: it.product_id,
              quantity: it.quantity,
              remark: it.remark || null,
            }))
          );
        if (insErr) throw insErr;
      }

      await writeAudit(ctx, req, 'update', 'shipment', id, before, data);
      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'shipment.write');
      const { data: before, error: getErr } = await supabase.from('shipments').select('*, shipment_items(*)').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('发货单不存在');
        throw getErr;
      }
      await assertShipmentStoreVisible(supabase, ctx, (before as any)?.store);
      // 软删除：置 deleted_at，数据进入回收站
      const { error } = await supabase.from('shipments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      // 调拨发货已确认发货（状态非「待发货」，已扣减国内库存）的记录，删除时回补国内库存；
      // 待发货记录未扣减，无需回补；已入仓货件入仓时已增加海外库存，删除仅移除登记，不反向扣减
      if ((before as any).source === 'transfer' && before.cargo_status !== '待发货') {
        const items = (before as any).shipment_items || [];
        const { data: domWh, error: domWhErr } = await supabase
          .from('warehouses')
          .select('id')
          .eq('wh_type', 'domestic')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!domWhErr && domWh) {
          for (const it of items) {
            await supabase.rpc('adjust_inventory', {
              p_product_id: it.product_id,
              p_warehouse_id: domWh.id,
              p_quantity: Number(it.quantity || 0),
              p_type: 'transfer_in',
              p_reference_type: 'shipment',
              p_reference_id: id,
              p_created_by: ctx.userId,
              p_note: `删除调拨发货回补国内库存 ${before.tracking_no || before.shipment_no || id}`,
            });
          }
        }
      }
      await writeAudit(ctx, req, 'delete', 'shipment', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
