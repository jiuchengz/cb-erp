-- 029_sales_platform_overseas_stock.sql
-- 销售订单新增：销售日期、平台（批量导入历史分析表）
alter table public.sales_orders
  add column if not exists sale_date date,
  add column if not exists platform text;

-- 商品新增：海外库存（平台可用库存快照，批量导入写入）
alter table public.products
  add column if not exists overseas_stock numeric(18,2) not null default 0;

-- 销售明细：允许未匹配商品（product_id 可空）+ 产品名称展示列
alter table public.sales_order_items alter column product_id drop not null;
alter table public.sales_order_items add column if not exists product_name text;
