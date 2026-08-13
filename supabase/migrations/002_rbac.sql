-- 002_rbac.sql
-- RBAC：roles / permissions / role_permissions / user_roles + 种子数据

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index if not exists idx_role_permissions_role on public.role_permissions(role_id);
create index if not exists idx_user_roles_user on public.user_roles(user_id);

-- ============ 种子：角色 ============
insert into public.roles (name, description) values
  ('super_admin', '超级管理员：全部权限'),
  ('admin', '管理员：业务全量，无用户/系统管理'),
  ('manager', '经理：业务读写，无删除/用户/系统'),
  ('operator', '操作员：只读')
on conflict (name) do nothing;

-- ============ 种子：权限 ============
insert into public.permissions (code, description) values
  ('products.read', '查看商品'),
  ('products.write', '新增/编辑商品'),
  ('products.delete', '删除商品'),
  ('inventory.read', '查看库存'),
  ('inventory.write', '库存操作'),
  ('inventory.adjust', '库存盘点调整'),
  ('sales.read', '查看销售订单'),
  ('sales.write', '创建/编辑销售订单'),
  ('sales.cancel', '取消销售订单'),
  ('shipment.read', '查看发货'),
  ('shipment.write', '创建/编辑发货'),
  ('procurement.read', '查看采购'),
  ('procurement.write', '创建/编辑采购'),
  ('transfer.read', '查看调拨'),
  ('transfer.write', '创建调拨'),
  ('transfer.approve', '审核调拨'),
  ('after_sales.read', '查看售后'),
  ('after_sales.write', '创建/编辑售后'),
  ('user.read', '查看用户'),
  ('user.manage', '管理用户与角色'),
  ('system.manage', '系统配置管理')
on conflict (code) do nothing;

-- ============ 种子：角色-权限映射 ============
-- super_admin：全部权限
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'super_admin'
on conflict do nothing;

-- admin：除 user.manage / system.manage 外全部
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'admin' and p.code not in ('user.manage', 'system.manage')
on conflict do nothing;

-- manager：业务读写（无 delete、无 user、无 system）
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'manager'
  and p.code in (
    'products.read','products.write',
    'inventory.read','inventory.write','inventory.adjust',
    'sales.read','sales.write','sales.cancel',
    'shipment.read','shipment.write',
    'procurement.read','procurement.write',
    'transfer.read','transfer.write','transfer.approve',
    'after_sales.read','after_sales.write'
  )
on conflict do nothing;

-- operator：只读
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'operator'
  and p.code in (
    'products.read','inventory.read','sales.read',
    'shipment.read','procurement.read','transfer.read','after_sales.read'
  )
on conflict do nothing;
