-- 024_shipment_import_columns.sql
-- 发货单批量导入 + 新增弹窗单行字段（对应旧文件发货模块 11 字段 + 导入补充字段）

-- 1. 补充缺失列（snake_case、类型合理、可空）
alter table public.shipments
  add column if not exists warehouse_no text,
  add column if not exists ship_date date,
  add column if not exists shipping_cartons numeric check (shipping_cartons >= 0),
  add column if not exists shipping_qty numeric check (shipping_qty >= 0),
  add column if not exists shipping_mode text,
  add column if not exists shipment_no text,
  add column if not exists product_code text,
  add column if not exists billable_weight_vol text,
  add column if not exists volume_diff text,
  add column if not exists billable_amount numeric,
  add column if not exists pull_declare_qty numeric check (pull_declare_qty >= 0),
  add column if not exists estimated_arrival date;

create index if not exists idx_shipments_shipment_no on public.shipments(shipment_no);
create index if not exists idx_shipments_ship_date on public.shipments(ship_date);

-- 2. cargo_status / bill_check_status 枚举由英文迁移为旧文件中文枚举（前端已按中文提交）
update public.shipments
  set cargo_status = case cargo_status
        when 'transporting' then '转运中'
        when 'arrived_port' then '到港'
        when 'cleared' then '清关'
        when 'in_warehouse' then '已入仓'
        else cargo_status
      end
  where cargo_status in ('in_warehouse', 'transporting', 'arrived_port', 'cleared');

do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.shipments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%cargo_status%'
  loop
    execute format('alter table public.shipments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.shipments
  add constraint shipments_cargo_status_check
  check (cargo_status in ('转运中', '到港', '清关', '已预约', '已入仓'));

update public.shipments
  set bill_check_status = case bill_check_status
        when 'confirmed' then '已核对'
        when 'difference_confirmed' then '差异确认'
        when 'difference_pending' then '差异待确认'
        when 'pending' then '待确认'
        else bill_check_status
      end
  where bill_check_status in ('pending', 'confirmed', 'difference_confirmed', 'difference_pending');

do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.shipments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%bill_check_status%'
  loop
    execute format('alter table public.shipments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.shipments
  add constraint shipments_bill_check_status_check
  check (bill_check_status in ('待确认', '已核对', '差异确认', '差异待确认'));

-- 3. 默认值同步为中文（保持 not null）
alter table public.shipments alter column cargo_status set default '转运中';
alter table public.shipments alter column bill_check_status set default '待确认';
