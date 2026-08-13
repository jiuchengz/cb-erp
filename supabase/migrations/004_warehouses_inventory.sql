-- 004_warehouses_inventory.sql
-- 仓库 + 库位 + 库存 + 库存流水 + 库存预留

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  code text not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, code)
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  quantity numeric not null default 0 check (quantity >= 0),
  reserved_quantity numeric not null default 0 check (reserved_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, warehouse_id)
);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  type text not null check (type in ('purchase_in','sales_out','transfer_out','transfer_in','adjustment','after_sales_in','loss','other')),
  quantity numeric not null,
  before_quantity numeric not null,
  after_quantity numeric not null,
  reference_type text,
  reference_id uuid,
  created_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  reference_type text,
  reference_id uuid,
  status text not null default 'active' check (status in ('active','released','consumed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_product on public.inventory(product_id);
create index if not exists idx_inventory_warehouse on public.inventory(warehouse_id);
create index if not exists idx_inv_txn_product on public.inventory_transactions(product_id);
create index if not exists idx_inv_txn_warehouse on public.inventory_transactions(warehouse_id);
create index if not exists idx_inv_txn_created on public.inventory_transactions(created_at);
create index if not exists idx_inv_res_inventory on public.inventory_reservations(inventory_id);

create trigger trg_warehouses_updated before update on public.warehouses
  for each row execute function public.set_updated_at();
create trigger trg_locations_updated before update on public.warehouse_locations
  for each row execute function public.set_updated_at();
create trigger trg_inventory_updated before update on public.inventory
  for each row execute function public.set_updated_at();
create trigger trg_reservations_updated before update on public.inventory_reservations
  for each row execute function public.set_updated_at();
