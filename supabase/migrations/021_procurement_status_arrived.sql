-- 021_procurement_status_arrived.sql
-- 采购（拿货）状态改造：新增 ARRIVED（已到货）
-- 新流程仅使用两个状态：ARRIVED（已到货，创建默认）-> RECEIVED（已入库，流转后自动入国内库存）
-- 保留旧枚举值以兼容历史数据，不删除任何旧值

alter table public.purchase_orders drop constraint if exists purchase_orders_status_check;
alter table public.purchase_orders
  add constraint purchase_orders_status_check
  check (status in ('DRAFT','SUBMITTED','APPROVED','PURCHASING','PARTIAL','RECEIVED','CANCELLED','ARRIVED'));
