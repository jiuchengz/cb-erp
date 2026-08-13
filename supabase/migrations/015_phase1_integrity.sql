-- 015_phase1_integrity.sql
-- 第一阶段：权限修复、库存流水幂等键、单据状态与库存原子事务。

-- 补货权限在 002 中遗漏。迁移需同时照顾已存在的角色数据。
insert into public.permissions (code, description) values
  ('replenishment.read', '查看补货'),
  ('replenishment.write', '创建/处理补货')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('replenishment.read', 'replenishment.write')
where r.name in ('super_admin', 'admin', 'manager')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'replenishment.read'
where r.name = 'operator'
on conflict do nothing;

-- 每次业务库存动作使用稳定的 operation_key，避免超时重试造成重复记账。
alter table public.inventory_transactions
  add column if not exists operation_key text;

create unique index if not exists uq_inventory_transactions_operation_key
  on public.inventory_transactions(operation_key)
  where operation_key is not null;

-- 新签名增加幂等键。先移除旧签名，避免 PostgREST RPC 重载解析歧义。
drop function if exists public.adjust_inventory(uuid, uuid, numeric, text, text, uuid, uuid, text);

create or replace function public.adjust_inventory(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_type text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_created_by uuid default null,
  p_note text default null,
  p_operation_key text default null
)
returns table (inventory_id uuid, before_qty numeric, after_qty numeric)
language plpgsql
as $$
declare
  v_inv_id uuid;
  v_before numeric;
  v_after numeric;
  v_existing record;
begin
  if p_type not in ('purchase_in','sales_out','transfer_out','transfer_in','adjustment','after_sales_in','loss','other') then
    raise exception 'INVALID_INVENTORY_TYPE';
  end if;

  if p_quantity = 0 then
    raise exception 'ZERO_INVENTORY_QUANTITY';
  end if;

  if p_operation_key is not null then
    select t.product_id, t.warehouse_id, t.type, t.quantity, t.before_quantity, t.after_quantity
      into v_existing
    from public.inventory_transactions t
    where t.operation_key = p_operation_key;

    if found then
      if v_existing.product_id <> p_product_id
        or v_existing.warehouse_id <> p_warehouse_id
        or v_existing.type <> p_type
        or v_existing.quantity <> p_quantity then
        raise exception 'IDEMPOTENCY_KEY_CONFLICT';
      end if;
      select i.id into v_inv_id
      from public.inventory i
      where i.product_id = p_product_id and i.warehouse_id = p_warehouse_id;
      return query select v_inv_id, v_existing.before_quantity, v_existing.after_quantity;
      return;
    end if;
  end if;

  -- 先确保库存行存在，再统一加行锁。并发首次入库由唯一约束协调。
  if p_quantity > 0 then
    insert into public.inventory (product_id, warehouse_id, quantity)
    values (p_product_id, p_warehouse_id, 0)
    on conflict (product_id, warehouse_id) do nothing;
  end if;

  select i.id, i.quantity into v_inv_id, v_before
  from public.inventory i
  where i.product_id = p_product_id and i.warehouse_id = p_warehouse_id
  for update;

  if not found then
    raise exception 'INSUFFICIENT_INVENTORY';
  end if;

  -- 锁后再次检查，覆盖等待另一个事务期间已经完成相同操作的情形。
  if p_operation_key is not null then
    select t.product_id, t.warehouse_id, t.type, t.quantity, t.before_quantity, t.after_quantity
      into v_existing
    from public.inventory_transactions t
    where t.operation_key = p_operation_key;
    if found then
      if v_existing.product_id <> p_product_id
        or v_existing.warehouse_id <> p_warehouse_id
        or v_existing.type <> p_type
        or v_existing.quantity <> p_quantity then
        raise exception 'IDEMPOTENCY_KEY_CONFLICT';
      end if;
      return query select v_inv_id, v_existing.before_quantity, v_existing.after_quantity;
      return;
    end if;
  end if;

  v_after := v_before + p_quantity;
  if v_after < 0 then
    raise exception 'INSUFFICIENT_INVENTORY';
  end if;

  update public.inventory set quantity = v_after where id = v_inv_id;

  insert into public.inventory_transactions (
    product_id, warehouse_id, type, quantity, before_quantity, after_quantity,
    reference_type, reference_id, created_by, note, operation_key
  ) values (
    p_product_id, p_warehouse_id, p_type, p_quantity, v_before, v_after,
    p_reference_type, p_reference_id, p_created_by, p_note, p_operation_key
  );

  return query select v_inv_id, v_before, v_after;
end;
$$;

create or replace function public.transition_purchase_order(
  p_order_id uuid,
  p_target_status text,
  p_user_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.purchase_orders%rowtype;
  v_item record;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = p_target_status then return to_jsonb(v_order); end if;

  if not (
    (v_order.status = 'DRAFT' and p_target_status in ('SUBMITTED','CANCELLED')) or
    (v_order.status = 'SUBMITTED' and p_target_status in ('APPROVED','CANCELLED')) or
    (v_order.status = 'APPROVED' and p_target_status in ('PURCHASING','CANCELLED')) or
    (v_order.status = 'PURCHASING' and p_target_status in ('PARTIAL','RECEIVED','CANCELLED')) or
    (v_order.status = 'PARTIAL' and p_target_status = 'RECEIVED')
  ) then raise exception 'INVALID_TRANSITION:%->%', v_order.status, p_target_status; end if;

  v_before := to_jsonb(v_order);
  if p_target_status = 'RECEIVED' then
    if v_order.warehouse_id is null then raise exception 'MISSING_WAREHOUSE'; end if;
    for v_item in select * from public.purchase_order_items where order_id = p_order_id order by product_id, id loop
      perform public.adjust_inventory(
        v_item.product_id, v_order.warehouse_id, v_item.quantity, 'purchase_in',
        'purchase_order', p_order_id, p_user_id, '采购入库 ' || v_order.order_no,
        'purchase:' || p_order_id || ':received:' || v_item.id
      );
      update public.purchase_order_items set received_quantity = quantity where id = v_item.id;
    end loop;
  end if;

  update public.purchase_orders set status = p_target_status where id = p_order_id;
  select to_jsonb(o) into v_after from public.purchase_orders o where o.id = p_order_id;
  insert into public.audit_logs(user_id, action, resource_type, resource_id, before_data, after_data, ip, user_agent)
  values (p_user_id, case when p_target_status = 'CANCELLED' then 'cancel' else p_target_status end,
          'purchase_order', p_order_id, v_before, v_after, p_ip, p_user_agent);
  return v_after;
end;
$$;

create or replace function public.transition_shipment(
  p_shipment_id uuid,
  p_target_status text,
  p_user_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.shipments%rowtype;
  v_item record;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_order from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = p_target_status then return to_jsonb(v_order); end if;

  if not (
    (v_order.status = 'PENDING' and p_target_status in ('SHIPPED','CANCELLED')) or
    (v_order.status = 'SHIPPED' and p_target_status in ('IN_TRANSIT','CANCELLED')) or
    (v_order.status = 'IN_TRANSIT' and p_target_status in ('DELIVERED','CANCELLED'))
  ) then raise exception 'INVALID_TRANSITION:%->%', v_order.status, p_target_status; end if;

  v_before := to_jsonb(v_order);
  if p_target_status = 'SHIPPED' then
    if v_order.warehouse_id is null then raise exception 'MISSING_WAREHOUSE'; end if;
    for v_item in select * from public.shipment_items where shipment_id = p_shipment_id order by product_id, id loop
      perform public.adjust_inventory(
        v_item.product_id, v_order.warehouse_id, -v_item.quantity, 'sales_out',
        'shipment', p_shipment_id, p_user_id, '发货出库 ' || v_order.tracking_no,
        'shipment:' || p_shipment_id || ':shipped:' || v_item.id
      );
    end loop;
  elsif p_target_status = 'CANCELLED' and v_order.status in ('SHIPPED','IN_TRANSIT') then
    if v_order.warehouse_id is null then raise exception 'MISSING_WAREHOUSE'; end if;
    for v_item in select * from public.shipment_items where shipment_id = p_shipment_id order by product_id, id loop
      perform public.adjust_inventory(
        v_item.product_id, v_order.warehouse_id, v_item.quantity, 'other',
        'shipment', p_shipment_id, p_user_id, '取消发货回库 ' || v_order.tracking_no,
        'shipment:' || p_shipment_id || ':cancelled:' || v_item.id
      );
    end loop;
  end if;

  update public.shipments set status = p_target_status where id = p_shipment_id;
  select to_jsonb(o) into v_after from public.shipments o where o.id = p_shipment_id;
  insert into public.audit_logs(user_id, action, resource_type, resource_id, before_data, after_data, ip, user_agent)
  values (p_user_id, case when p_target_status = 'CANCELLED' then 'cancel' else p_target_status end,
          'shipment', p_shipment_id, v_before, v_after, p_ip, p_user_agent);
  return v_after;
end;
$$;

create or replace function public.transition_transfer(
  p_transfer_id uuid,
  p_target_status text,
  p_user_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.transfers%rowtype;
  v_item record;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_order from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = p_target_status then return to_jsonb(v_order); end if;

  if not (
    (v_order.status = 'DRAFT' and p_target_status in ('APPROVED','CANCELLED')) or
    (v_order.status = 'APPROVED' and p_target_status in ('SHIPPED','CANCELLED')) or
    (v_order.status = 'SHIPPED' and p_target_status in ('RECEIVED','CANCELLED')) or
    (v_order.status = 'PARTIAL' and p_target_status = 'RECEIVED')
  ) then raise exception 'INVALID_TRANSITION:%->%', v_order.status, p_target_status; end if;

  v_before := to_jsonb(v_order);
  if p_target_status = 'SHIPPED' then
    for v_item in select * from public.transfer_items where transfer_id = p_transfer_id order by product_id, id loop
      perform public.adjust_inventory(
        v_item.product_id, v_order.from_warehouse_id, -v_item.quantity, 'transfer_out',
        'transfer', p_transfer_id, p_user_id, '调拨出库 ' || v_order.transfer_no,
        'transfer:' || p_transfer_id || ':shipped:' || v_item.id
      );
    end loop;
  elsif p_target_status = 'RECEIVED' then
    for v_item in select * from public.transfer_items where transfer_id = p_transfer_id order by product_id, id loop
      perform public.adjust_inventory(
        v_item.product_id, v_order.to_warehouse_id, v_item.quantity, 'transfer_in',
        'transfer', p_transfer_id, p_user_id, '调拨入库 ' || v_order.transfer_no,
        'transfer:' || p_transfer_id || ':received:' || v_item.id
      );
      update public.transfer_items set received_quantity = quantity where id = v_item.id;
    end loop;
  elsif p_target_status = 'CANCELLED' and v_order.status = 'SHIPPED' then
    for v_item in select * from public.transfer_items where transfer_id = p_transfer_id order by product_id, id loop
      perform public.adjust_inventory(
        v_item.product_id, v_order.from_warehouse_id, v_item.quantity, 'other',
        'transfer', p_transfer_id, p_user_id, '取消调拨回库 ' || v_order.transfer_no,
        'transfer:' || p_transfer_id || ':cancelled:' || v_item.id
      );
    end loop;
  end if;

  update public.transfers set status = p_target_status where id = p_transfer_id;
  select to_jsonb(o) into v_after from public.transfers o where o.id = p_transfer_id;
  insert into public.audit_logs(user_id, action, resource_type, resource_id, before_data, after_data, ip, user_agent)
  values (p_user_id, case when p_target_status = 'CANCELLED' then 'cancel' else p_target_status end,
          'transfer', p_transfer_id, v_before, v_after, p_ip, p_user_agent);
  return v_after;
end;
$$;

create or replace function public.transition_after_sale(
  p_after_sale_id uuid,
  p_target_status text,
  p_user_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.after_sales%rowtype;
  v_item record;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_order from public.after_sales where id = p_after_sale_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = p_target_status then return to_jsonb(v_order); end if;

  if not (
    (v_order.status = 'PENDING' and p_target_status in ('APPROVED','REJECTED')) or
    (v_order.status = 'APPROVED' and p_target_status in ('PROCESSING','REJECTED')) or
    (v_order.status = 'PROCESSING' and p_target_status = 'COMPLETED')
  ) then raise exception 'INVALID_TRANSITION:%->%', v_order.status, p_target_status; end if;

  v_before := to_jsonb(v_order);
  if p_target_status = 'COMPLETED' and v_order.type = 'return' then
    if v_order.warehouse_id is null then raise exception 'MISSING_WAREHOUSE'; end if;
    for v_item in select * from public.after_sale_items where after_sale_id = p_after_sale_id order by product_id, id loop
      perform public.adjust_inventory(
        v_item.product_id, v_order.warehouse_id, v_item.quantity, 'after_sales_in',
        'after_sale', p_after_sale_id, p_user_id, '售后退货入库 ' || v_order.order_no,
        'after-sale:' || p_after_sale_id || ':completed:' || v_item.id
      );
    end loop;
  end if;

  update public.after_sales set status = p_target_status where id = p_after_sale_id;
  select to_jsonb(o) into v_after from public.after_sales o where o.id = p_after_sale_id;
  insert into public.audit_logs(user_id, action, resource_type, resource_id, before_data, after_data, ip, user_agent)
  values (p_user_id, case when p_target_status = 'REJECTED' then 'reject' else p_target_status end,
          'after_sale', p_after_sale_id, v_before, v_after, p_ip, p_user_agent);
  return v_after;
end;
$$;

create or replace function public.transition_replenishment_order(
  p_order_id uuid,
  p_target_status text,
  p_user_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.replenishment_orders%rowtype;
  v_item record;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_order from public.replenishment_orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = p_target_status then return to_jsonb(v_order); end if;

  if not (
    (v_order.status = 'DRAFT' and p_target_status in ('SUBMITTED','CANCELLED')) or
    (v_order.status = 'SUBMITTED' and p_target_status in ('APPROVED','CANCELLED')) or
    (v_order.status = 'APPROVED' and p_target_status in ('PROCESSING','CANCELLED')) or
    (v_order.status = 'PROCESSING' and p_target_status in ('COMPLETED','CANCELLED'))
  ) then raise exception 'INVALID_TRANSITION:%->%', v_order.status, p_target_status; end if;

  v_before := to_jsonb(v_order);
  if p_target_status = 'COMPLETED' then
    for v_item in select * from public.replenishment_order_items where replenishment_id = p_order_id order by product_id, id loop
      perform public.adjust_inventory(
        v_item.product_id, v_order.warehouse_id, v_item.quantity, 'adjustment',
        'replenishment_order', p_order_id, p_user_id, '补货入库 ' || v_order.order_no,
        'replenishment:' || p_order_id || ':completed:' || v_item.id
      );
    end loop;
  end if;

  update public.replenishment_orders set status = p_target_status where id = p_order_id;
  select to_jsonb(o) into v_after from public.replenishment_orders o where o.id = p_order_id;
  insert into public.audit_logs(user_id, action, resource_type, resource_id, before_data, after_data, ip, user_agent)
  values (p_user_id, case when p_target_status = 'CANCELLED' then 'cancel' else p_target_status end,
          'replenishment_order', p_order_id, v_before, v_after, p_ip, p_user_agent);
  return v_after;
end;
$$;

-- 业务 RPC 只能由服务端 service_role 调用；浏览器端 authenticated/anon 不可直接执行。
revoke execute on function public.adjust_inventory(uuid, uuid, numeric, text, text, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.transition_purchase_order(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.transition_shipment(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.transition_transfer(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.transition_after_sale(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.transition_replenishment_order(uuid, text, uuid, text, text) from public, anon, authenticated;

grant execute on function public.adjust_inventory(uuid, uuid, numeric, text, text, uuid, uuid, text, text) to service_role;
grant execute on function public.transition_purchase_order(uuid, text, uuid, text, text) to service_role;
grant execute on function public.transition_shipment(uuid, text, uuid, text, text) to service_role;
grant execute on function public.transition_transfer(uuid, text, uuid, text, text) to service_role;
grant execute on function public.transition_after_sale(uuid, text, uuid, text, text) to service_role;
grant execute on function public.transition_replenishment_order(uuid, text, uuid, text, text) to service_role;
