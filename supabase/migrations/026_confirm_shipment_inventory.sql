-- 调拨发货确认发货扣减库存：新增"待发货"状态
-- 创建调拨发货时 cargo_status 默认为"待发货"，状态由"待发货"变为其他状态时扣减国内库存

-- 1. 货物状态字典加入"待发货"（排在首位）
insert into cargo_statuses (name, color, sort_order) values
  ('待发货', '#6C757D', 0)
on conflict (name) do nothing;

-- 2. shipments.cargo_status 约束放开为包含"待发货"
alter table public.shipments
  drop constraint if exists shipments_cargo_status_check;
alter table public.shipments
  add constraint shipments_cargo_status_check
  check (cargo_status in ('待发货', '转运中', '到港', '清关', '已预约', '已入仓'));

-- 3. 默认值改为"待发货"
alter table public.shipments alter column cargo_status set default '待发货';
