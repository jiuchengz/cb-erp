-- 007_shipments.sql
-- 发货单 + 明细

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  tracking_no text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING','SHIPPED','IN_TRANSIT','DELIVERED','CANCELLED')),
  carrier text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  sales_order_id uuid references public.sales_orders(id),
  product_id uuid not null references public.products(id),
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shipments_tracking on public.shipments(tracking_no);
create index if not exists idx_shipments_status on public.shipments(status);
create index if not exists idx_shipment_items_shipment on public.shipment_items(shipment_id);

create trigger trg_shipments_updated before update on public.shipments
  for each row execute function public.set_updated_at();
create trigger trg_shipment_items_updated before update on public.shipment_items
  for each row execute function public.set_updated_at();
