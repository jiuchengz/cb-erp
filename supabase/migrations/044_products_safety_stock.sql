-- 044: 商品安全库存阈值（自动库存预警用）
alter table public.products
  add column if not exists safety_stock numeric not null default 0 check (safety_stock >= 0);

comment on column public.products.safety_stock is '安全库存阈值，可售库存低于该值触发低库存预警';
