-- 059_transfer_from_warehouse_and_receive.sql
-- 调拨发货 × 海外库存联动（口径 A2 + 签收/批次跟踪）
--
-- 1. shipments 增加「出库仓库」from_warehouse_id：确认发货/删除回补按此仓扣加库存
-- 2. shipment_items 增加明细级实收数量 received_quantity（签收登记，NULL=未签收，可部分签收）
-- 3. shipments 增加整单签收完成时间 signed_at
--
-- 存量兼容：历史 transfer 单 from_warehouse_id 保持 NULL，
--           后端扣减/回补自动回退"第一个 domestic 仓"（与旧逻辑一致），不破坏存量数据。

alter table public.shipments
  add column if not exists from_warehouse_id uuid references public.warehouses(id);

create index if not exists idx_shipments_from_warehouse
  on public.shipments(from_warehouse_id);

alter table public.shipment_items
  add column if not exists received_quantity numeric
  check (received_quantity is null or received_quantity >= 0);

alter table public.shipments
  add column if not exists signed_at timestamptz;

create index if not exists idx_shipments_signed_at
  on public.shipments(signed_at);
