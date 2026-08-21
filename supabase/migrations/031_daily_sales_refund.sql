-- 031_daily_sales_refund.sql
-- 说明：daily_sales 增加退款数量/退款金额列，支持销售与退款拆分统计
-- 执行方式：在 Supabase SQL Editor 手动执行，成功显示 "Success. No rows returned" 即可。

alter table public.daily_sales
  add column if not exists refund_qty numeric(18,2) not null default 0;

alter table public.daily_sales
  add column if not exists refund_amount numeric(18,2) not null default 0;
