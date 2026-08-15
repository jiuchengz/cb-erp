-- 016_users_warehouses_status.sql
-- 用户/仓库停启用状态字段（旧版有启用/禁用概念，新版补列）

alter table public.profiles
  add column if not exists is_active boolean not null default true;

alter table public.warehouses
  add column if not exists is_active boolean not null default true;
