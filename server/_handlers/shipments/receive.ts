import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, assertShipmentStoreVisible } from '../_lib/rbac';
import { uuidSchema, parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';
import { writeAudit } from '../_lib/audit';

// 调拨发货签收入仓：货件到达海外仓（货物状态=已入仓）后，操作员按本单明细登记实际签收数量。
// 支持明细级部分签收（received_quantity 累加，0 < 本次签收 <= 剩余未签收数量）；
// 全部明细签收完成后自动记录整单签收时间 signed_at。
// 与 products.overseas_stock（平台快照，由 daily_sales 导入/confirm-inbound 覆盖）分开展示，互不覆盖。

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        add_quantity: z.coerce.number().positive(),
      })
    )
    .min(1)
    .max(200),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));

    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const ctx = await requireAuth(req);
    requirePermission(ctx, 'shipment.write');

    const id = parse(uuidSchema, String(req.query.id));
    const body = parse(receiveSchema, req.body || {});
    const supabase = getAdminClient();

    // 1. 读取发货单及明细
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('*, shipment_items(*)')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (shipErr || !shipment) {
      throw Errors.notFound('发货单不存在');
    }
    await assertShipmentStoreVisible(supabase, ctx, (shipment as any).store);
    if ((shipment as any).source !== 'transfer') {
      throw Errors.badRequest('仅调拨发货单支持签收入仓');
    }
    if ((shipment as any).cargo_status !== '已入仓') {
      throw Errors.conflict(`当前货物状态为「${(shipment as any).cargo_status || '未知'}」，仅「已入仓」后可签收登记`);
    }

    const items: any[] = shipment.shipment_items ?? [];
    if (!items.length) {
      throw Errors.conflict('该货件无商品明细，无法签收');
    }

    // 2. 校验并逐条累加签收数量
    const byProduct = new Map(items.map((it) => [it.product_id, it]));
    const updated: any[] = [];
    for (const row of body.items) {
      const exist = byProduct.get(row.product_id);
      if (!exist) {
        throw Errors.badRequest('签收明细中存在本单未包含的产品');
      }
      const qty = Number(exist.quantity ?? 0);
      const cur = Number(exist.received_quantity ?? 0);
      const add = Number(row.add_quantity || 0);
      const next = cur + add;
      if (next > qty) {
        throw Errors.conflict(`产品 ${row.product_id} 累计签收 ${cur} 件，最多还可签收 ${qty - cur} 件`);
      }
      if (add <= 0) {
        throw Errors.badRequest('签收数量必须大于 0');
      }
      const { error: updErr } = await supabase
        .from('shipment_items')
        .update({ received_quantity: next })
        .eq('id', exist.id);
      if (updErr) throw updErr;
      updated.push({ product_id: row.product_id, received_quantity: next, quantity: qty });
    }

    // 3. 全部明细签收完成时记录整单签收时间
    const allDoneCheck = items.every((it) => {
      const addForIt = body.items.find((b) => b.product_id === it.product_id);
      const cur = Number(it.received_quantity ?? 0) + (addForIt ? Number(addForIt.add_quantity || 0) : 0);
      return cur >= Number(it.quantity ?? 0);
    });
    let signed = false;
    if (allDoneCheck) {
      const { error: signErr } = await supabase
        .from('shipments')
        .update({ signed_at: new Date().toISOString() })
        .eq('id', id);
      if (signErr) throw signErr;
      signed = true;
    }

    await writeAudit(ctx, req, 'update', 'shipment', id, { received: body.items }, { signed, updated });
    return res.status(200).json({
      data: {
        shipment_id: id,
        updated,
        signed,
        message: signed ? '全部明细已签收完成' : '签收登记成功（未全量签收，可再次登记）',
      },
    });
  } catch (e: any) {
    return handleError(res, e);
  }
}
