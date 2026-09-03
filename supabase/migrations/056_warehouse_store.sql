-- 056_warehouse_store.sql
-- 仓库管理新增「店铺」字段：仓库与店铺绑定
-- 用途：物流发货单方案B按仓库绑定的店铺区分（调拨发货管理创建时选店铺，
--       发货管理 / 经营分析 / 首页概览按可见仓库店铺过滤）

alter table public.warehouses
  add column if not exists store text;

create index if not exists idx_warehouses_store on public.warehouses(store);
