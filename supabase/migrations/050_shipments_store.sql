-- 050_shipments_store.sql
-- 调拨发货管理：shipments 表新增「店铺」字段
-- 说明：仓号 warehouse_no 字段已于 024_shipment_import_columns.sql 中新增，无需重复添加

alter table public.shipments
  add column if not exists store text;

create index if not exists idx_shipments_store on public.shipments(store);
