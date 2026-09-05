-- 060_shipments_to_warehouse.sql
-- 调拨发货增加「到达海外仓」to_warehouse_id：仅记录展示用（目的海外仓），
-- 不参与本地库存记账——海外仓库存仍以平台快照 products.overseas_stock 与签收登记分别展示。
-- 出库仓 from_warehouse_id 负责国内库存扣减，二者解耦。

alter table public.shipments
  add column if not exists to_warehouse_id uuid references public.warehouses(id);

create index if not exists idx_shipments_to_warehouse
  on public.shipments(to_warehouse_id);
