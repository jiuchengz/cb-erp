-- 054_product_warehouses.sql
-- 一货多仓（用户确认版）：商品档案升为公司级主档，多仓可见通过绑定表实现
-- 业务口径：
--   1. 一套商品档案（编码全库唯一），可同时绑定总仓 + 子仓 + 海外仓；
--   2. 售价按仓区分：product_warehouses.sale_price（绑定行带售价）；
--   3. 成本（采购成本/头程/尾程/佣金率等）不区分，保留在 products 主档；
--   4. 创建商品默认绑定总仓，可加绑子仓；商品管理编辑中可加绑/解绑；
--   5. 库存仍走 inventory(product_id, warehouse_id)，与绑定表正交，无需改动。

-- ============ 1. 商品-仓库绑定表 ============
create table if not exists public.product_warehouses (
  product_id   uuid not null references public.products(id)     on delete cascade,
  warehouse_id uuid not null references public.warehouses(id)   on delete cascade,
  sale_price   numeric(18,2) not null default 0 check (sale_price >= 0),
  created_at   timestamptz not null default now(),
  primary key (product_id, warehouse_id)
);

comment on table public.product_warehouses is '商品可售仓库绑定（一货多仓；绑定行内维护按仓售价）';
create index if not exists idx_product_warehouses_warehouse
  on public.product_warehouses(warehouse_id);

-- ============ 2. 存量回填 ============
-- 把现有 products.warehouse_id 归属复制为初始绑定；售价沿用 products.unit_price。
-- （052 曾把商品强制归到唯一启用仓，或用户界面已手动指定；此处只复制非空归属）
insert into public.product_warehouses (product_id, warehouse_id, sale_price)
select p.id, p.warehouse_id, p.unit_price
from public.products p
where p.warehouse_id is not null
  and p.deleted_at is null
on conflict (product_id, warehouse_id) do update
  set sale_price = excluded.sale_price;

-- ============ 3. 商品编码恢复全库唯一 ============
-- 先校验：若存在同 code 多条（跨仓重复建档），中止迁移并要求先合并，防止误删数据。
do $$
declare
  dup_cnt int;
begin
  select count(*) into dup_cnt
  from (
    select code
    from public.products
    where code is not null and code <> '' and deleted_at is null
    group by code
    having count(*) > 1
  ) d;
  if dup_cnt > 0 then
    raise exception '检测到 % 组重复商品编码，请先人工合并（勿直接删除），再重跑本迁移', dup_cnt;
  end if;
end $$;

-- 052 曾将编码唯一改为同仓内唯一；一货多仓下改为全库唯一。
drop index if exists idx_products_code_warehouse_unique;
create unique index if not exists idx_products_code_unique
  on public.products(code)
  where code is not null and code <> '' and deleted_at is null;

notify pgrst, 'reload schema';
