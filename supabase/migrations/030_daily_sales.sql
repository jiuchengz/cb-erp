-- 030_daily_sales.sql
-- 销售统计板块：不建销售单，每日导入的历史分析数据直接写入本表
-- 唯一约束 (sale_date, platform, link_id)：同一天同一站点同一商品重复导入时覆盖更新，不重复累计
create table if not exists public.daily_sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null,
  platform text not null default '',
  link_id text not null,
  product_id uuid,
  product_name text,
  quantity numeric(18,2) not null default 0,
  unit_price numeric(18,2) not null default 0,
  overseas_stock numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_sales_unique unique (sale_date, platform, link_id)
);

create index if not exists idx_daily_sales_date on public.daily_sales(sale_date);
create index if not exists idx_daily_sales_link on public.daily_sales(link_id);

-- RLS：沿用现有策略（管理员/已登录用户可读写）
alter table public.daily_sales enable row level security;

drop policy if exists "daily_sales_select" on public.daily_sales;
create policy "daily_sales_select" on public.daily_sales
  for select using (auth.role() = 'authenticated');

drop policy if exists "daily_sales_insert" on public.daily_sales;
create policy "daily_sales_insert" on public.daily_sales
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "daily_sales_update" on public.daily_sales;
create policy "daily_sales_update" on public.daily_sales
  for update using (auth.role() = 'authenticated');

drop policy if exists "daily_sales_delete" on public.daily_sales;
create policy "daily_sales_delete" on public.daily_sales
  for delete using (auth.role() = 'authenticated');
