-- 015_products_business_fields.sql
-- 商品业务字段补齐（老系统 listings 字段迁移）
-- 说明：不补销量类字段（monthSales/todaySales/dailySales 等），由销售订单实时统计

alter table public.products
  add column if not exists code text,
  add column if not exists listing_time text,
  add column if not exists image_text text,
  add column if not exists link_id text,
  add column if not exists unit text not null default '套',
  add column if not exists competitor_id text,
  add column if not exists shipping_mode text default '海运',
  add column if not exists purchase_cost numeric(18,2) not null default 0 check (purchase_cost >= 0),
  add column if not exists first_leg_freight numeric(18,2) not null default 0 check (first_leg_freight >= 0),
  add column if not exists last_mile_delivery_peso numeric(18,2) not null default 0 check (last_mile_delivery_peso >= 0),
  add column if not exists ml_commission_rate numeric(5,4) not null default 0.165 check (ml_commission_rate >= 0 and ml_commission_rate <= 1);

alter table public.products
  alter column currency set default 'MXN';

create index if not exists idx_products_code on public.products(code);
