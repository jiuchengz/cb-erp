-- 053_user_warehouses.sql
-- 仓库可见范围从“角色绑定”调整为“用户绑定”：
--   角色（roles / role_permissions）只负责“能看哪些模块”；
--   用户（user_warehouses）负责“能看哪些仓库的数据”。
-- 口径：
--   1. user_warehouses(user_id, warehouse_id)：每个用户可绑定一个或多个仓库；
--   2. super_admin 不受仓库限制（全量可见，无需绑定）；
--   3. 数据回填：若此前已在 role_warehouses 配置过角色绑仓，则把角色绑定
--      复制给所有拥有该角色的用户（按用户取并集），避免已有配置丢失。

create table if not exists public.user_warehouses (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, warehouse_id)
);

comment on table public.user_warehouses is '用户绑定的可见仓库（仓库级数据隔离：用户维度）';
create index if not exists idx_user_warehouses_warehouse on public.user_warehouses(warehouse_id);

-- 兼容回填：仅当旧的 role_warehouses 表存在且有数据时执行
do $$
begin
  if to_regclass('public.role_warehouses') is not null then
    insert into public.user_warehouses (user_id, warehouse_id)
    select distinct ur.user_id, rw.warehouse_id
    from public.role_warehouses rw
    join public.user_roles ur on ur.role_id = rw.role_id
    on conflict (user_id, warehouse_id) do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
