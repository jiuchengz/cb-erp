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

// ===== 一货多仓（054 product_warehouses 绑定表） =====
// 商品为公司级主档：可见性不再由 products.warehouse_id（单仓归属）决定，
// 而是由 product_warehouses 绑定行推导——商品只要绑定任一可见仓即可见；
// 售价按仓存于绑定行 sale_price，成本（purchase_cost 等）留在主档不区分。

const NULL_UUID = '00000000-0000-0000-0000-000000000000';

// 批量加载商品绑定（product_id -> 绑定仓库+售价 列表）。
// 供销售/补货/售后/批量操作等模块在多仓模型下做"商品-仓库"校验。
const BIND_CHUNK = 500;
export interface ProductBinding {
  warehouse_id: string;
  sale_price: number;
}
export async function loadProductBindings(
  supabase: any,
  productIds: string[]
): Promise<Map<string, ProductBinding[]>> {
  const out = new Map<string, ProductBinding[]>();
  const uniq = Array.from(new Set(productIds.filter(Boolean)));
  if (uniq.length === 0) return out;
  for (let i = 0; i < uniq.length; i += BIND_CHUNK) {
    const chunk = uniq.slice(i, i + BIND_CHUNK);
    const { data, error } = await supabase
      .from('product_warehouses')
      .select('product_id, warehouse_id, sale_price')
      .in('product_id', chunk);
    if (error) throw error;
    for (const r of data || []) {
      const arr = out.get(r.product_id) || [];
      arr.push({ warehouse_id: r.warehouse_id, sale_price: Number(r.sale_price ?? 0) });
      out.set(r.product_id, arr);
    }
  }
  return out;
}

// 当前账号可见的 product_id 集合（经绑定表推导）：
// super_admin 返回 null（全量）；受限账号返回 product 集合（空集合 = 无可见商品）。
// 分页扫描绑定表（绑定表可能大于一次 URL 上限），返回前自动去重。
const WH_PAGE = 1000;

export async function loadVisibleProductIds(supabase: any, ctx: AuthContext): Promise<Set<string> | null> {
  if (hasUnrestrictedWarehouse(ctx)) return null;
  const ids = ctx.warehouseIds || [];
  const productIds = new Set<string>();
  if (ids.length === 0) return productIds;
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('product_warehouses')
      .select('product_id')
      .in('warehouse_id', ids)
      .range(page * WH_PAGE, (page + 1) * WH_PAGE - 1);
    if (error) throw error;
    const rows: any[] = data || [];
    rows.forEach((r: any) => {
      if (r.product_id) productIds.add(String(r.product_id));
    });
    if (rows.length < WH_PAGE) break;
  }
  return productIds;
}

// ===== 无仓库归属表的可见链接映射（如 daily_sales 以 link_id 关联产品） =====
// 一货多仓后通过 product_warehouses(warehouse_id -> product_id) + products.link_id 推导
// 当前账号可见的链接集合。
// super_admin 返回 null（不做过滤）；受限账号返回链接集合（空集合 = 无可见数据）。
export async function loadVisibleLinkIds(supabase: any, ctx: AuthContext): Promise<Set<string> | null> {
  if (hasUnrestrictedWarehouse(ctx)) return null;
  const visibleProductIds = await loadVisibleProductIds(supabase, ctx);
  if (!visibleProductIds) return null;
  const linkIds = new Set<string>();
  if (visibleProductIds.size === 0) return linkIds;
  const ids = Array.from(visibleProductIds);
  for (let i = 0; i < ids.length; i += BIND_CHUNK) {
    const chunk = ids.slice(i, i + BIND_CHUNK);
    const { data, error } = await supabase
      .from('products')
      .select('link_id')
      .in('id', chunk)
      .is('deleted_at', null)
      .not('link_id', 'is', null)
      .neq('link_id', '');
    if (error) throw error;
    const rows: any[] = data || [];
    rows.forEach((p: any) => {
      if (p.link_id) linkIds.add(String(p.link_id));
    });
  }
  return linkIds;
}

// ===== 物流/发货按店铺隔离（仓库绑定店铺：warehouses.store） =====
// 仓库管理为仓库绑定店铺后，调拨发货/发货单按店铺归属区分可见范围：
// super_admin / 总仓账号返回 null（不做店铺过滤）；受限账号返回其可见仓库已配置的店铺集合
// （空集合 = 无可见店铺，对应列表应过滤为空）。
export async function loadVisibleStoreNames(supabase: any, ctx: AuthContext): Promise<Set<string> | null> {
  if (hasUnrestrictedWarehouse(ctx)) return null;
  const ids = ctx.warehouseIds || [];
  const stores = new Set<string>();
  if (ids.length === 0) return stores;
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('warehouses')
      .select('store')
      .in('id', ids)
      .not('store', 'is', null)
      .neq('store', '')
      .range(page * WH_PAGE, (page + 1) * WH_PAGE - 1);
    if (error) throw error;
    const rows: any[] = data || [];
    rows.forEach((r: any) => {
      if (r.store) stores.add(String(r.store).trim());
    });
    if (rows.length < WH_PAGE) break;
  }
  return stores;
}

// 校验发货单（调拨/手动）的店铺归属在当前账号可见范围内（单条 GET / 更新 / 删除前置）：
// 受限账号仅能访问其可见仓库店铺的货件；不可见按不存在处理（防越权枚举）。
export async function assertShipmentStoreVisible(supabase: any, ctx: AuthContext, shipmentStore: unknown) {
  if (hasUnrestrictedWarehouse(ctx)) return;
  const stores = (await loadVisibleStoreNames(supabase, ctx)) || new Set<string>();
  const s = String((shipmentStore as any) ?? '').trim();
  if (!s || !stores.has(s)) throw Errors.notFound('发货单不存在');
}

// 校验商品是否存在（且未删除）且绑定任一可见仓库；不可见按不存在处理（防越权枚举）。
// 返回 { row, bindings }（bindings 仅含当前账号可见绑定；超管返回全部绑定）。
export async function fetchProductBindingsVisible(
  supabase: any,
  ctx: AuthContext,
  productId: string
): Promise<{ row: any; bindings: ProductBinding[] }> {
  const { data: row, error } = await supabase.from('products').select('*').eq('id', productId).is('deleted_at', null).single();
  if (error) {
    if (error.code === 'PGRST116') throw Errors.notFound('商品不存在');
    throw error;
  }
  const allBindings = (await loadProductBindings(supabase, [productId])).get(productId) || [];
  let visible: ProductBinding[];
  if (hasUnrestrictedWarehouse(ctx)) {
    visible = allBindings;
  } else {
    const whSet = new Set(ctx.warehouseIds || []);
    visible = allBindings.filter((b) => whSet.has(b.warehouse_id));
  }
  if (!hasUnrestrictedWarehouse(ctx) && visible.length === 0) {
    throw Errors.notFound('商品不存在');
  }
  return { row, bindings: visible };
}

// 受限账号列表查询附加"绑定任一可见仓"过滤：
// 返回 select 串与附加过滤函数，由调用方拼到 products 主查询上。
// super_admin 不做限制（bindings 全量返回）。
export function bindProductWarehouseFilter(
  ctx: AuthContext,
  filterWarehouseId = ''
): { selectBind: string; filter: (q: any) => any } {
  if (hasUnrestrictedWarehouse(ctx)) {
    const selectBind = 'product_warehouses(warehouse_id, sale_price)';
    const filter = (q: any) => {
      if (filterWarehouseId) return q.eq('product_warehouses.warehouse_id', filterWarehouseId);
      return q;
    };
    return { selectBind, filter };
  }
  const ids = ctx.warehouseIds || [];
  const selectBind = 'product_warehouses!inner(warehouse_id, sale_price)';
  const filter = (q: any) => {
    let x: any = q;
    x = x.in('product_warehouses.warehouse_id', ids.length ? ids : [NULL_UUID]);
    if (filterWarehouseId) x = x.eq('product_warehouses.warehouse_id', filterWarehouseId);
    return x;
  };
  return { selectBind, filter };
}

