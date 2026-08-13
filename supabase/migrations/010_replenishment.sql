-- 010_replenishment.sql
-- 补货单 + 明细

create table if not exists public.replenishment_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  warehouse_id uuid not null references public.warehouses(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','PROCESSING','COMPLETED','CANCELLED')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.replenishment_order_items (
  id uuid primary key default gen_random_uuid(),
  replenishment_id uuid not null references public.replenishment_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_replenishment_no on public.replenishment_orders(order_no);
create index if not exists idx_replenishment_status on public.replenishment_orders(status);
create index if not exists idx_replenishment_items on public.replenishment_order_items(replenishment_id);

create trigger trg_replenishment_updated before update on public.replenishment_orders
  for each row execute function public.set_updated_at();
create trigger trg_replenishment_items_updated before update on public.replenishment_order_items
  for each row execute function public.set_updated_at();
