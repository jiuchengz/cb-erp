-- 017_forwarders_and_shipment_fields.sql
-- 货代管理 + 发货单入仓/账单核对全链路字段（旧版货代/货物状态/入仓/账单核对移植）

-- 货代表
create table if not exists public.forwarders (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact text,
  phone text,
  remark text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_forwarders_name on public.forwarders(name);
create index if not exists idx_forwarders_is_active on public.forwarders(is_active);

create trigger trg_forwarders_updated before update on public.forwarders
  for each row execute function public.set_updated_at();

-- shipments 增加货代关联 + 入仓/账单核对字段
alter table public.shipments
  add column if not exists forwarder_id uuid references public.forwarders(id) on delete set null,
  add column if not exists cargo_status text not null default 'in_warehouse'
    check (cargo_status in ('in_warehouse','transporting','arrived_port','cleared')),
  add column if not exists warehouse_status text,
  add column if not exists actual_warehouse_qty numeric check (actual_warehouse_qty >= 0),
  add column if not exists abnormal_penalty text,
  add column if not exists bill_check_status text not null default 'pending'
    check (bill_check_status in ('pending','confirmed','difference_confirmed','difference_pending')),
  add column if not exists bill_check_time timestamptz,
  add column if not exists appointment_time timestamptz;

create index if not exists idx_shipments_forwarder on public.shipments(forwarder_id);
create index if not exists idx_shipments_cargo_status on public.shipments(cargo_status);
create index if not exists idx_shipments_bill_check on public.shipments(bill_check_status);

-- RLS：沿用全表默认 deny 防线（详见 014_rls.sql 说明）
alter table public.forwarders enable row level security;
