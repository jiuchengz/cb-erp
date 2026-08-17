-- 仓库类型：domestic（国内仓库）/ overseas（海外仓）
-- 现有仓库默认归为国内仓库
alter table public.warehouses
  add column if not exists wh_type text not null default 'domestic'
  check (wh_type in ('domestic', 'overseas'));

-- 存量数据全部归为国内仓库
update public.warehouses set wh_type = 'domestic' where wh_type is null or wh_type = '';
