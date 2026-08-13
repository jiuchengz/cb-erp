-- 013_warehouse_refs.sql
-- 补仓库维度：采购入库、发货出库需要明确 warehouse_id

alter table public.purchase_orders
  add column if not exists warehouse_id uuid references public.warehouses(id);

alter table public.shipments
  add column if not exists warehouse_id uuid references public.warehouses(id);

create index if not exists idx_po_warehouse on public.purchase_orders(warehouse_id);
create index if not exists idx_shipments_warehouse on public.shipments(warehouse_id);
