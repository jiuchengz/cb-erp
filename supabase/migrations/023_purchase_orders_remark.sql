-- 采购（拿货）记录新增备注字段
alter table purchase_orders add column if not exists remark text;
