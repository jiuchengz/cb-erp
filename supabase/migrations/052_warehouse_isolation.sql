-- 052_warehouse_isolation.sql
-- 仓库级数据隔离（Phase1 数据层）
-- 目标口径：
--   1. 角色可绑定一个或多个仓库（role_warehouses），账号可见仓库 = 其所有角色绑仓的并集；
--   2. super_admin 不受仓库限制（全量访问）；
--   3. 商品记录归属单一仓库（products.warehouse_id），产品编码改为同仓内唯一；
--   4. 销售单落仓（sales_orders.warehouse_id）：由明细商品归属推导，不额外人工选仓；
--   5. 存量数据回填：仅当线上恰好存在 1 个启用仓库时自动回填商品归属；
--      多仓库场景不做自动回填，由超管在系统界面批量指定，避免误分配。

-- ============ 1. 角色-仓库绑定表 ============
create table if not exists public.role_warehouses (
  role_id      uuid not null references public.roles(id)      on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (role_id, warehouse_id)
);

comment on table public.role_warehouses is '角色绑定的可见仓库（RBAC 行级隔离：仓库维度）';
create index if not exists idx_role_warehouses_warehouse on public.role_warehouses(warehouse_id);

-- ============ 2. 商品归属仓库 ============
alter table public.products
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete set null;

create index if not exists idx_products_warehouse_id
  on public.products(warehouse_id)
  where deleted_at is null;

-- 产品编码唯一性由“全库唯一”调整为“同仓内唯一”
-- （warehouse_id 为空的历史商品暂不强制，待界面归仓后收敛）
drop index if exists idx_products_code_unique;
create unique index if not exists idx_products_code_warehouse_unique
  on public.products(warehouse_id, code)
  where code is not null and code <> '' and warehouse_id is not null and deleted_at is null;

-- ============ 3. 销售单落仓（冗余归属，便于过滤与展示） ============
alter table public.sales_orders
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete set null;

create index if not exists idx_sales_orders_warehouse_id
  on public.sales_orders(warehouse_id)
  where deleted_at is null;

-- ============ 4. 存量数据回填（安全策略） ============
-- 4.1 商品归属：仅当系统只有一个启用仓库时自动回填到该仓；多仓场景跳过，交由管理员在界面批量设置。
do $$
declare
  v_wh_id uuid;
  v_cnt int;
begin
  select count(*) into v_cnt from public.warehouses where is_active = true;
  if v_cnt = 1 then
    select id into v_wh_id from public.warehouses where is_active = true limit 1;
    if v_wh_id is not null then
      update public.products set warehouse_id = v_wh_id
        where warehouse_id is null and deleted_at is null;
    end if;
  end if;
end $$;

-- 4.2 销售单落仓：由明细商品归属推导（仅回填可唯一判定的单据，跨仓/无商品明细保持 NULL 待处理）
update public.sales_orders so
set warehouse_id = sub.wh_id
from (
  select soi.order_id,
         (array_agg(p.warehouse_id))[1] as wh_id,
         count(distinct p.warehouse_id) as wh_cnt,
         count(soi.product_id) as linked_cnt,
         count(soi.id) as item_cnt
  from public.sales_order_items soi
  left join public.products p on p.id = soi.product_id and p.deleted_at is null
  group by soi.order_id
) sub
where so.id = sub.order_id
  and so.warehouse_id is null
  and sub.linked_cnt > 0
  and sub.linked_cnt = sub.item_cnt
  and sub.wh_cnt = 1
  and sub.wh_id is not null;
