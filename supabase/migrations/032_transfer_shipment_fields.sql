-- 032_transfer_shipment_fields.sql
-- 调拨发货管理：复用 shipments 表实现（与发货管理联动，同源数据）
-- 新增列：
--   cargo_code : 货代号（手动填写）
--   source     : 来源标记，manual=普通发货 / transfer=调拨发货；发货管理显示全部，调拨发货管理仅显示 transfer

alter table public.shipments
  add column if not exists cargo_code text,
  add column if not exists source text not null default 'manual';

create index if not exists idx_shipments_source on public.shipments(source);
create index if not exists idx_shipments_cargo_code on public.shipments(cargo_code);
