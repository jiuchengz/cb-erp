-- 006_procurement.sql
-- 采购订单 + 明细

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  supplier text,
  warehouse_id uuid not null references public.warehouses(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','PURCHASING','PARTIAL','RECEIVED','CANCELLED')),
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric not null check (quantity > 0),
  received_quantity numeric not null default 0 check (received_quantity >= 0),
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  subtotal numeric(18,2) not null default 0 check (subtotal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_po_order_no on public.purchase_orders(order_no);
create index if not exists idx_po_status on public.purchase_orders(status);
create index if not exists idx_po_items_order on public.purchase_order_items(order_id);

create trigger trg_po_updated before update on public.purchase_orders
  for each row execute function public.set_updated_at();
create trigger trg_po_items_updated before update on public.purchase_order_items
  for each row execute function public.set_updated_at();
