-- 008_transfers.sql
-- 调拨单 + 明细

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text not null unique,
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id uuid not null references public.warehouses(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','SHIPPED','PARTIAL','RECEIVED','CANCELLED')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_warehouse_id <> to_warehouse_id)
);

create table if not exists public.transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric not null check (quantity > 0),
  received_quantity numeric not null default 0 check (received_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_transfers_no on public.transfers(transfer_no);
create index if not exists idx_transfers_status on public.transfers(status);
create index if not exists idx_transfer_items_transfer on public.transfer_items(transfer_id);

create trigger trg_transfers_updated before update on public.transfers
  for each row execute function public.set_updated_at();
create trigger trg_transfer_items_updated before update on public.transfer_items
  for each row execute function public.set_updated_at();
