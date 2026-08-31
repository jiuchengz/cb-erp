-- 051_replenishment_order_no_nullable.sql
-- 补货管理不再使用补货单号：order_no 允许为空
-- 保留 unique 约束（PostgreSQL 中多个 NULL 互不冲突），存量单号不受影响
alter table public.replenishment_orders alter column order_no drop not null;
