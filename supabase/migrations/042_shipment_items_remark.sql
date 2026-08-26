-- 调拨发货管理：明细表新增备注字段（单位 unit 从 products 表联动获取，不落库冗余）
alter table public.shipment_items add column if not exists remark text;
