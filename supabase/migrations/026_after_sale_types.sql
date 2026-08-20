-- 售后类型自定义字典
-- 每个类型可自定义标识(value)、名称(name)、是否退货入库(need_stock_in)

create table if not exists after_sale_types (
  id uuid primary key default gen_random_uuid(),
  value text not null unique,
  name text not null,
  need_stock_in boolean not null default false,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- 插入默认3条（对齐旧版硬编码字典）
insert into after_sale_types (value, name, need_stock_in, sort_order) values
  ('return', '退货', true, 1),
  ('exchange', '换货', false, 2),
  ('refund', '退款', false, 3)
on conflict (value) do nothing;

-- 放开 after_sales.type 的 CHECK 约束，允许写入自定义类型
alter table after_sales drop constraint if exists after_sales_type_check;

-- RLS：沿用 deny 默认策略，service_role 绕过
alter table after_sale_types enable row level security;
