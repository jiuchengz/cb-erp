-- 043 库存盘点模块
-- 盘点单主表
create table if not exists public.stocktakes (
  id uuid primary key default gen_random_uuid(),
  stocktake_no text not null unique,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  stocktake_date date,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'IN_PROGRESS', 'COMPLETED')),
  remark text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 盘点明细
create table if not exists public.stocktake_items (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  book_quantity numeric not null default 0,
  actual_quantity numeric not null default 0,
  difference numeric not null default 0,
  remark text
);

create index if not exists idx_stocktakes_status on public.stocktakes(status);
create index if not exists idx_stocktakes_warehouse on public.stocktakes(warehouse_id);
create index if not exists idx_stocktake_items_stocktake on public.stocktake_items(stocktake_id);
create index if not exists idx_stocktake_items_product on public.stocktake_items(product_id);

-- 库存流水类型扩展：盘点入库 / 盘点出库
alter table public.inventory_transactions drop constraint if exists inventory_transactions_type_check;
alter table public.inventory_transactions add constraint inventory_transactions_type_check check (
  type in ('purchase_in', 'sales_out', 'transfer_out', 'transfer_in', 'adjustment', 'after_sales_in', 'loss', 'other', 'stocktake_in', 'stocktake_out')
);
