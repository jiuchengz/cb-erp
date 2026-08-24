-- 036: 软删除支持（回收站）
-- 为商品与业务单据主表增加 deleted_at 列，删除操作改为标记删除，列表查询过滤已删除数据
-- 请在 Supabase SQL Editor 手动执行本文件

alter table public.products add column if not exists deleted_at timestamptz;
alter table public.sales_orders add column if not exists deleted_at timestamptz;
alter table public.purchase_orders add column if not exists deleted_at timestamptz;
alter table public.shipments add column if not exists deleted_at timestamptz;
alter table public.after_sales add column if not exists deleted_at timestamptz;
alter table public.replenishment_orders add column if not exists deleted_at timestamptz;

-- 已删除数据的索引（回收站列表按 deleted_at 倒序取最新）
create index if not exists idx_products_deleted_at on public.products (deleted_at);
create index if not exists idx_sales_orders_deleted_at on public.sales_orders (deleted_at);
create index if not exists idx_purchase_orders_deleted_at on public.purchase_orders (deleted_at);
create index if not exists idx_shipments_deleted_at on public.shipments (deleted_at);
create index if not exists idx_after_sales_deleted_at on public.after_sales (deleted_at);
create index if not exists idx_replenishment_orders_deleted_at on public.replenishment_orders (deleted_at);
