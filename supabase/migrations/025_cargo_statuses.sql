-- 货物状态自定义字典
-- 每个状态可自定义名称和颜色，供发货管理整行着色使用

create table if not exists cargo_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#FFFFFF',
  sort_order int default 0,
  created_at timestamptz default now()
);

-- 插入默认5条数据（对齐旧版硬编码字典）
insert into cargo_statuses (name, color, sort_order) values
  ('转运中', '#FFFFFF', 1),
  ('到港', '#F0AD4E', 2),
  ('清关', '#17A2B8', 3),
  ('已预约', '#007BFF', 4),
  ('已入仓', '#28A745', 5)
on conflict (name) do nothing;

-- RLS：沿用 deny 默认策略，service_role 绕过
alter table cargo_statuses enable row level security;