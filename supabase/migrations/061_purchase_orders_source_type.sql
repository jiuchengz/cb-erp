-- 061_purchase_orders_source_type.sql
-- 拿货来货状态（来源类型）：采购来货 / 调拨拿货 / 补货来货 / 自定义
-- 约定稳定语义码（非数据库枚举约束，允许任意自定义文本直接存储）：
--   purchase  = 采购来货（默认）
--   transfer  = 调拨拿货
--   replenish = 补货来货
-- 采购来货（source_type = 'purchase'）参与补货管理联动；其余类型不参与。

alter table public.purchase_orders
  add column if not exists source_type text not null default 'purchase';

comment on column public.purchase_orders.source_type is
  '拿货来货状态：purchase=采购来货（默认）/ transfer=调拨拿货 / replenish=补货来货 / 任意自定义文本';
