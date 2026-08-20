-- 014_rls.sql
-- 全表启用 Row Level Security
-- 架构说明：所有业务读写统一走服务端 API（使用 service_role key，绕过 RLS）；
-- RLS 在此作为最后一道防线：任何使用 anon / authenticated key 的直接数据库访问一律拒绝，
-- 防止前端或攻击者绕过 API 直连数据库。

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

alter table public.products enable row level security;

alter table public.warehouses enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_transactions enable row level security;

alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

alter table public.shipments enable row level security;
alter table public.shipment_items enable row level security;

alter table public.transfers enable row level security;
alter table public.transfer_items enable row level security;

alter table public.after_sales enable row level security;
alter table public.after_sale_items enable row level security;

alter table public.replenishment_orders enable row level security;
alter table public.replenishment_order_items enable row level security;

alter table public.audit_logs enable row level security;

-- 默认 deny：不创建任何 permissive policy。
-- 所有直接查询（anon / authenticated）默认返回空，确保只能通过服务端 API 访问。
