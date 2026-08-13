-- 012_inventory_functions.sql
-- 库存事务函数：数据库事务 + 行级锁，防止并发覆盖，并自动写库存流水

-- 通用库存变更：正数入库、负数出库，任何变更都必须经过此函数产生流水
create or replace function public.adjust_inventory(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_type text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_created_by uuid default null,
  p_note text default null
)
returns table (inventory_id uuid, before_qty numeric, after_qty numeric)
language plpgsql
as $$
declare
  v_inv_id uuid;
  v_before numeric;
  v_after numeric;
begin
  if p_type not in ('purchase_in','sales_out','transfer_out','transfer_in','adjustment','after_sales_in','loss','other') then
    raise exception 'INVALID_INVENTORY_TYPE';
  end if;

  -- 行级锁，防止并发读取后覆盖
  select id, quantity into v_inv_id, v_before
  from public.inventory
  where product_id = p_product_id and warehouse_id = p_warehouse_id
  for update;

  if not found then
    if p_quantity < 0 then
      raise exception 'INSUFFICIENT_INVENTORY';
    end if;
    v_before := 0;
    insert into public.inventory (product_id, warehouse_id, quantity)
    values (p_product_id, p_warehouse_id, p_quantity)
    returning id into v_inv_id;
    v_after := p_quantity;
  else
    v_after := v_before + p_quantity;
    if v_after < 0 then
      raise exception 'INSUFFICIENT_INVENTORY';
    end if;
    update public.inventory set quantity = v_after where id = v_inv_id;
  end if;

  insert into public.inventory_transactions (
    product_id, warehouse_id, type, quantity, before_quantity, after_quantity,
    reference_type, reference_id, created_by, note
  ) values (
    p_product_id, p_warehouse_id, p_type, p_quantity, v_before, v_after,
    p_reference_type, p_reference_id, p_created_by, p_note
  );

  return query select v_inv_id, v_before, v_after;
end;
$$;
