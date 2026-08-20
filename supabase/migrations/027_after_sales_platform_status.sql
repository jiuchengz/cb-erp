-- 售后状态新增"平台已介入"
-- 1. 修改 CHECK 约束以包含新状态
-- 2. 修改"已驳回"为"已取消"（仅前端展示层，DB值不变）

alter table public.after_sales
  drop constraint if exists after_sales_status_check;

alter table public.after_sales
  add constraint after_sales_status_check
  check (status in ('PENDING','APPROVED','PROCESSING','COMPLETED','REJECTED','PLATFORM_INTERVENED'));