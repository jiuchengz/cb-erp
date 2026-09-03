import { AuthContext } from './auth';
import { Errors } from './error';

// Backend RBAC：真正的权限校验，前端菜单控制只是 UI 层，不可作为安全机制。
// super_admin 拥有全部权限。
export function requirePermission(ctx: AuthContext, permission: string) {
  if (ctx.roles.includes('super_admin')) return;
  if (!ctx.permissions.includes(permission)) {
    throw Errors.forbidden(`无权限：${permission}`);
  }
}

// 多权限（满足其一即可）
export function requireAnyPermission(ctx: AuthContext, permissions: string[]) {
  if (ctx.roles.includes('super_admin')) return;
  if (!permissions.some((p) => ctx.permissions.includes(p))) {
    throw Errors.forbidden(`无权限：${permissions.join(' 或 ')}`);
  }
}

// ===== 仓库级行级隔离（Phase1） =====
// 判定规则：super_admin 的 warehouseIds 为 null（全量可见）；
// 普通账号 warehouseIds 为可见仓库数组（空数组 = 无可见仓库）。

export function isSuperAdmin(ctx: AuthContext): boolean {
  return ctx.roles.includes('super_admin');
}

// 当前账号是否不受仓库范围限制（super_admin）
export function hasUnrestrictedWarehouse(ctx: AuthContext): boolean {
  return ctx.warehouseIds === null;
}

// 校验指定 warehouse_id 是否在当前账号可见范围内。
// scope: 业务上下文描述（用于报错信息，如 "该仓库的商品"）
export function assertWarehouseVisible(ctx: AuthContext, warehouseId: string | null | undefined, scope = '该仓库') {
  if (!warehouseId) throw Errors.forbidden(`无权访问${scope}（缺少仓库归属）`);
  if (hasUnrestrictedWarehouse(ctx)) return;
  if (!ctx.warehouseIds!.includes(warehouseId)) {
    throw Errors.forbidden(`无权访问${scope}`);
  }
}

// 列表查询附加可见仓库过滤：返回组装好的 query（供 supabase-js 链式调用）。
export function applyWarehouseFilter(query: any, ctx: AuthContext, column = 'warehouse_id'): any {
  if (hasUnrestrictedWarehouse(ctx)) return query;
  const ids = ctx.warehouseIds || [];
  if (ids.length === 0) {
    // 无可见仓库：强制空结果
    return query.in(column, []);
  }
  return query.in(column, ids);
}

// ===== 无仓库归属表的可见链接映射（如 daily_sales 以 link_id 关联产品） =====
// 通过 products(link_id, warehouse_id) 推导当前账号可见的链接集合。
// super_admin 返回 null（不做过滤）；受限账号返回链接集合（空集合 = 无可见数据）。
const WH_PAGE = 1000;

export async function loadVisibleLinkIds(supabase: any, ctx: AuthContext): Promise<Set<string> | null> {
  if (hasUnrestrictedWarehouse(ctx)) return null;
  const ids = ctx.warehouseIds || [];
  const linkIds = new Set<string>();
  if (ids.length === 0) return linkIds;
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('products')
      .select('link_id')
      .in('warehouse_id', ids)
      .is('deleted_at', null)
      .not('link_id', 'is', null)
      .neq('link_id', '')
      .range(page * WH_PAGE, (page + 1) * WH_PAGE - 1);
    if (error) throw error;
    const rows: any[] = data || [];
    rows.forEach((p: any) => {
      if (p.link_id) linkIds.add(String(p.link_id));
    });
    if (rows.length < WH_PAGE) break;
  }
  return linkIds;
}

