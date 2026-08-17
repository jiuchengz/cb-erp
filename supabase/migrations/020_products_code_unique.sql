-- 020_products_code_unique.sql
-- 商品批量上传机制调整：
-- 1. SKU 允许为空（多个空 SKU 可共存）
-- 2. 唯一键由 SKU 切换为产品编码 code（仅对非空 code 生效）
-- 3. 移除 SKU 唯一约束，允许相同 SKU 存在

alter table public.products
  alter column sku drop not null;

alter table public.products
  drop constraint if exists products_sku_key;

create unique index if not exists idx_products_code_unique
  on public.products(code)
  where code is not null and code <> '';
