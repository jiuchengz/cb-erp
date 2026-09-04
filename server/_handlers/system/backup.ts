import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

// 核心表清单（业务数据 + 基础资料，不含 RLS/权限等系统配置）
const CORE_TABLES = [
  'products',
  'warehouses',
  'inventory',
  'inventory_transactions',
  'sales_orders',
  'sales_order_items',
  'purchase_orders',
  'purchase_order_items',
  'shipments',
  'shipment_items',
  'transfers',
  'transfer_items',
  'replenishment_orders',
  'replenishment_order_items',
  'stocktakes',
  'stocktake_items',
  'after_sales',
  'daily_sales',
  'exchange_rates',
  'forwarders',
  'cargo_statuses',
  'after_sale_types',
  'system_settings',
];

// 一键数据备份：导出全部核心表数据为 JSON（前端下载保存）
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    // 备份导出全部核心业务表，属于系统级敏感操作：仅限 system.manage 管理员
    requirePermission(ctx, 'system.backup');
    const supabase = getAdminClient();

    const tables: Record<string, any[]> = {};
    const failed: string[] = [];
    // 分页分批拉取，避免大表 select('*') 一次返回超限 / 响应超时
    const PAGE_SIZE = 500;
    for (const name of CORE_TABLES) {
      const allRows: any[] = [];
      let ok = true;
      try {
        let from = 0;
        for (;;) {
          const { data, error } = await supabase.from(name).select('*').range(from, from + PAGE_SIZE - 1);
          if (error) {
            ok = false;
            break;
          }
          allRows.push(...(data || []));
          if (!data || data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
      } catch (e) {
        ok = false;
      }
      if (!ok) {
        failed.push(name);
        continue;
      }
      tables[name] = allRows;
    }

    const payload = {
      app: 'cb-erp',
      version: 1,
      generated_at: new Date().toISOString(),
      table_count: Object.keys(tables).length,
      failed_tables: failed,
      tables,
    };

    await writeAudit(ctx, req, 'export_backup', 'system', undefined, undefined, {
      table_count: Object.keys(tables).length,
      failed_tables: failed,
    });

    return res.status(200).json({ data: payload });
  } catch (e) {
    return handleError(res, e);
  }
}
