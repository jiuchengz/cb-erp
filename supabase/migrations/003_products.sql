-- 003_products.sql
-- 商品 + 变体

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  barcode text,
  category text,
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  currency text not null default 'CNY',
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  name text,
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_barcode on public.products(barcode);
create index if not exists idx_products_category on public.products(category);
create index if not exists idx_product_variants_product on public.product_variants(product_id);

create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();
create trigger trg_variants_updated before update on public.product_variants
  for each row execute function public.set_updated_at();
