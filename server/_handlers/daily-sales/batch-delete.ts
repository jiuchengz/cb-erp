import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, loadVisibleLinkIds } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const batchDeleteSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(500).optional().default([]),
    link_ids: z.array(z.string().min(1).max(200)).max(500).optional().default([]),
    sale_from: z.string().max(20).optional().default(''),
    sale_to: z.string().max(20).optional().default(''),
  })
  .refine(
    (v) =>
      v.ids.length > 0 ||
      (v.link_ids.length > 0 && (v.sale_from.length > 0 || v.sale_to.length > 0)),
    { message: '需提供 ids，或 link_ids 配合日期范围' }
  );

// 链接口径归一化：历史数据与产品主档的 link_id 存在带/不带 MLM 前缀两种写法，
// 可见性校验时统一归一化，避免合法请求被误拒。
function normLink(v: unknown): string {
  return String(v ?? '').trim().replace(/^MLM/i, '');
}

// 批量删除日常销量统计明细。
// daily_sales 为统计明细表（无 deleted_at），此处为物理删除，前端已做二次确认。
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requirePermission(ctx, 'sales.write');
    const body = parse(batchDeleteSchema, req.body || {});
    const supabase = getAdminClient();

    const visibleLinks = await loadVisibleLinkIds(supabase, ctx);
    if (visibleLinks && visibleLinks.size === 0) {
      return res.status(200).json({ ok: true, deleted: 0, matched: 0 });
    }

    // 1) 先拉取命中行：既用于行级可见性校验，也用于审计留痕（删除后无法回查）
    const collected: any[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q: any = supabase
        .from('daily_sales')
        .select('id, sale_date, platform, link_id, quantity, refund_qty, refund_amount');
      if (body.ids.length) {
        q = q.in('id', body.ids);
      } else {
        q = q.in('link_id', body.link_ids);
        if (body.sale_from) q = q.gte('sale_date', body.sale_from);
        if (body.sale_to) q = q.lte('sale_date', body.sale_to);
      }
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      const batch = (data || []) as any[];
      collected.push(...batch);
      if (batch.length < PAGE) break;
    }

    // 2) 受限账号行级校验：命中的链接必须都在可见集内，否则整批取消
    if (visibleLinks && collected.length) {
      const vis = new Set<string>();
      visibleLinks.forEach((l) => vis.add(normLink(l)));
      const denied = collected.filter((r) => !vis.has(normLink(r.link_id)));
      if (denied.length) {
        throw Errors.forbidden(`所选数据包含 ${denied.length} 条无权访问的链接记录，已取消删除`);
      }
    }

    // 3) 分批物理删除
    const ids = collected.map((r) => r.id);
    let deleted = 0;
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { data, error } = await supabase.from('daily_sales').delete().in('id', chunk).select('id');
      if (error) throw error;
      deleted += (data || []).length;
    }

    // 汇总审计（一次写入，删除类操作必须留痕）
    await writeAudit(ctx, req, 'batch_delete', 'daily_sales', undefined, collected, null);
    return res.status(200).json({ ok: true, deleted, matched: collected.length });
  } catch (e) {
    return handleError(res, e);
  }
}
