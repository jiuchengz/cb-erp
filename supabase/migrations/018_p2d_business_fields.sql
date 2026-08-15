-- 018_p2d_business_fields.sql
-- P2-d 阶段业务字段补充（对应旧版 legacy/index.html 的拿货日期/补货数量/补货时间/处理结果）

-- 采购单：拿货日期（旧版字段）
alter table public.purchase_orders
add column if not exists receive_date date;

-- 补货单：补货数量 + 补货时间（旧版字段）
alter table public.replenishment_orders
add column if not exists replenish_qty numeric(18,2) not null default 0 check (replenish_qty >= 0),
add column if not exists replenishment_time date;

-- 售后单：处理结果（旧版字段）
alter table public.after_sales
add column if not exists result text;
