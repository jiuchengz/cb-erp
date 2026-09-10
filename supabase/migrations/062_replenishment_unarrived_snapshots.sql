-- 062_replenishment_unarrived_snapshots.sql
-- 每日"未到货"快照表（补货管理 - 每天统计全部未到货商品总数量及对应 SKU）
--
-- 用途：保留逐日历史。补货的到货匹配（arrival_matched）是接口侧动态计算的，
--       不落库、也无法回放历史时点，因此需要每日定时把当期"未到货"结果固化下来。
--
-- 口径（写入端实现见 server/_handlers/replenishment/snapshots.ts）：
--   未到货 = 补货单 status ∈ {DRAFT,SUBMITTED,APPROVED,PROCESSING}（排除 COMPLETED/CANCELLED）
--            且未通过到货匹配（每个明细均存在 source_type='purchase'、status∈{ARRIVED,RECEIVED}、
--            receive_date 晚于匹配基准日、数量 ≥ 明细数量的采购记录）
--   匹配基准日 group_date = 补货时间 replenishment_time；为空时回落该单 created_at 的日期部分
--
-- 行粒度：(snapshot_date, group_date, warehouse_id, product_id)
--   snapshot_date = 采集日（系统默认时区当天）
--   group_date    = 该未到货数量所属的补货日期分组
--   unarrived_qty = 未到货数量（按补货明细数量累计，不跨单去重）

create table if not exists public.replenishment_unarrived_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  group_date date not null,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text,
  code text,
  name text,
  unarrived_qty numeric(18,2) not null default 0 check (unarrived_qty >= 0),
  item_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (snapshot_date, group_date, warehouse_id, product_id)
);

comment on table public.replenishment_unarrived_snapshots is
  '补货未到货每日快照：按（采集日, 补货日期分组, 仓库, 商品）记录未到货数量与明细条数';

create index if not exists idx_rep_unarrived_snap_date
  on public.replenishment_unarrived_snapshots (snapshot_date desc);
create index if not exists idx_rep_unarrived_snap_group_date
  on public.replenishment_unarrived_snapshots (group_date desc);
create index if not exists idx_rep_unarrived_snap_warehouse
  on public.replenishment_unarrived_snapshots (warehouse_id);
create index if not exists idx_rep_unarrived_snap_product
  on public.replenishment_unarrived_snapshots (product_id);

-- 与全库一致：启用 RLS 且不建 policy（默认 deny），业务统一走服务端 API（service_role 绕过 RLS）
alter table public.replenishment_unarrived_snapshots enable row level security;

notify pgrst, 'reload schema';
