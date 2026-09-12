import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission, hasUnrestrictedWarehouse } from '../_lib/rbac';
import { parse } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { handleError } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';
import { datePartInTz } from '../_lib/datetime';
import { collectUnarrived, groupByDate, summarizeAll } from '../_lib/replenishment-unarrived';

// GET /api/replenishment/stats
// 「每天统计全部未到货商品的总数量及对应 SKU」（精确口径，只读）
//   口径：补货单 status ∈ {DRAFT,SUBMITTED,APPROVED,PROCESSING}（排除 COMPLETED / CANCELLED）
//         且未通过到货匹配（arrival_matched = false，见 _lib/replenishment-match.ts）
//   维度：按"匹配基准日"分组（补货时间；为空时回落该单创建日期，系统默认时区）
//   输出：每日未到货商品去重 SKU、总数量、涉及单数、按仓分布
// 仓库行级隔离：非全量可见账号仅统计其可见仓库
const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));

    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET' } });
    }

    const ctx = await requireAuth(req);
    requirePermission(ctx, 'replenishment.read');

    const q = parse(querySchema, req.query);
    const supabase = getAdminClient();
    const warehouseIds = hasUnrestrictedWarehouse(ctx) ? null : ctx.warehouseIds || [];

    const result = await collectUnarrived(supabase, { warehouseIds });
    const allDates = groupByDate(result.cells, result.orders_by_date);
    const todayDate = datePartInTz(new Date().toISOString(), result.timezone);
    const focusDate = q.date || todayDate;
    const dates = q.date ? allDates.filter((d) => d.date === q.date) : allDates;
    const today = allDates.find((d) => d.date === focusDate) || null;
    // 全量口径：跨全部统计日汇总（SKU 与补货单按跨日去重），不受 date 查询参数影响
    const all = summarizeAll(result.cells, result.orders_by_date);

    return res.status(200).json({
      data: {
        timezone: result.timezone,
        generated_at: new Date().toISOString(),
        // 精确口径说明（供前端/助手提示口径来源）
        criteria: {
          statuses_excluded: ['COMPLETED', 'CANCELLED'],
          arrival_match: 'source_type=purchase 且 status∈{ARRIVED,RECEIVED} 且 receive_date > 匹配基准日 且 数量>=明细数量',
          grouping: '匹配基准日 = 补货时间（空则回落该单创建日期，系统默认时区）',
        },
        today_date: todayDate,
        today: today
          ? { date: today.date, order_count: today.order_count, total_qty: today.total_qty, sku_count: today.sku_count }
          : { date: todayDate, order_count: 0, total_qty: 0, sku_count: 0 },
        // 全部统计日的汇总口径（跨日去重）
        all,
        scanned_orders: result.scanned_orders,
        unarrived_orders: result.unarrived_orders,
        orders_without_items: result.orders_without_items,
        dates,
      },
    });
  } catch (e) {
    return handleError(res, e);
  }
}
