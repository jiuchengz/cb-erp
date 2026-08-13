-- 009_after_sales.sql
-- 售后单 + 明细

create table if not exists public.after_sales (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  sales_order_id uuid references public.sales_orders(id),
  warehouse_id uuid references public.warehouses(id),
  type text not null check (type in ('return','exchange','refund')),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','PROCESSING','COMPLETED','REJECTED')),
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.after_sale_items (
  id uuid primary key default gen_random_uuid(),
  after_sale_id uuid not null references public.after_sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_after_sales_no on public.after_sales(order_no);
create index if not exists idx_after_sales_status on public.after_sales(status);
create index if not exists idx_after_sale_items on public.after_sale_items(after_sale_id);

create trigger trg_after_sales_updated before update on public.after_sales
  for each row execute function public.set_updated_at();
create trigger trg_after_sale_items_updated before update on public.after_sale_items
  for each row execute function public.set_updated_at();
