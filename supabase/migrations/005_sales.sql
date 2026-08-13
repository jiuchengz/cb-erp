-- 005_sales.sql
-- 销售订单 + 明细

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  customer_id uuid,
  status text not null default 'DRAFT' check (status in ('DRAFT','CONFIRMED','PAID','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
  currency text not null default 'CNY',
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  sku text not null,
  quantity numeric not null check (quantity > 0),
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  discount numeric(18,2) not null default 0 check (discount >= 0),
  subtotal numeric(18,2) not null default 0 check (subtotal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_order_no on public.sales_orders(order_no);
create index if not exists idx_sales_created on public.sales_orders(created_at);
create index if not exists idx_sales_status on public.sales_orders(status);
create index if not exists idx_sales_items_order on public.sales_order_items(order_id);

create trigger trg_sales_updated before update on public.sales_orders
  for each row execute function public.set_updated_at();
create trigger trg_sales_items_updated before update on public.sales_order_items
  for each row execute function public.set_updated_at();
