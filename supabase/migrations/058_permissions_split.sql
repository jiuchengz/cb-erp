-- 058_permissions_split.sql
-- 权限拆分：系统管理整组门禁(system.manage)拆为独立子码；商品总表/成本利润/库存盘点 独立读码。
-- 背景：
--   1) 系统管理整组不再以 system.manage 作为唯一门禁，设置页各 tab / 成员管理 / 日志 / 回收站均独立开关；
--   2) 商品总表 / 成本利润 原复用 products.read，库存盘点 原复用 inventory.read，现各自独立，便于单独授权；
--   3) 仪表盘 / 经营分析 不拆，维持现状（dashboard 页 requiresPerm 业务读码并集 + 绑定店铺数据隔离）。

-- 1) 新增权限码
insert into public.permissions (code, description) values
  ('product_total.read', '商品总表查看'),
  ('cost_profit.read', '成本利润查看'),
  ('stocktake.read', '库存盘点查看'),
  ('system.users', '成员管理'),
  ('system.roles', '角色管理'),
  ('system.permissions', '权限列表'),
  ('system.warehouses', '仓库管理'),
  ('system.settings', '系统设置'),
  ('system.appearance', '界面外观'),
  ('system.logo', '网站图标'),
  ('system.backup', '数据备份'),
  ('system.usage', '数据库用量'),
  ('system.audit', '审计日志'),
  ('system.logs', '操作日志'),
  ('system.recycle', '回收站')
on conflict (code) do nothing;

-- 2) super_admin 始终全量
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'super_admin'
on conflict do nothing;

-- 3) 业务读码等价补位：凡持有 products.read 的角色补 总表/成本利润 读码，保持现有可见范围不变
insert into public.role_permissions (role_id, permission_id)
select distinct r.id, p.id
from public.roles r
join public.role_permissions rp on rp.role_id = r.id
join public.permissions oldp on oldp.id = rp.permission_id
cross join public.permissions p
where r.name <> 'super_admin'
  and oldp.code = 'products.read'
  and p.code in ('product_total.read', 'cost_profit.read')
on conflict do nothing;

-- 4) 库存查询与库存盘点拆开：凡持有 inventory.read 的角色补 盘点读码 + 仓库管理可见（等价旧版 tab 可见范围）
insert into public.role_permissions (role_id, permission_id)
select distinct r.id, p.id
from public.roles r
join public.role_permissions rp on rp.role_id = r.id
join public.permissions oldp on oldp.id = rp.permission_id
cross join public.permissions p
where r.name <> 'super_admin'
  and oldp.code = 'inventory.read'
  and p.code in ('stocktake.read', 'system.warehouses')
on conflict do nothing;

-- 5) user.read 持有者补 角色管理/权限列表 读码（等价旧版设置页内 roles/permissions tab 可见）；成员管理入口仅 system.manage 持有者获得（见 6）
insert into public.role_permissions (role_id, permission_id)
select distinct r.id, p.id
from public.roles r
join public.role_permissions rp on rp.role_id = r.id
join public.permissions oldp on oldp.id = rp.permission_id
cross join public.permissions p
where r.name <> 'super_admin'
  and oldp.code = 'user.read'
  and p.code in ('system.roles', 'system.permissions')
on conflict do nothing;

-- 6) system.manage 整组门禁展开为各系统子码（原整组拥有者等价保留全部子功能，之后可单独关闭）
insert into public.role_permissions (role_id, permission_id)
select distinct r.id, p.id
from public.roles r
join public.role_permissions rp on rp.role_id = r.id
join public.permissions oldp on oldp.id = rp.permission_id
cross join public.permissions p
where r.name <> 'super_admin'
  and oldp.code = 'system.manage'
  and p.code in ('system.users','system.roles','system.permissions','system.settings','system.appearance','system.logo','system.backup','system.usage','system.audit','system.logs','system.recycle')
on conflict do nothing;

-- 注：旧码 user.read / system.manage / inventory.read / products.read 保留于 permissions 表（历史角色仍持有时不产生副作用，
--     新版前端与后端不再以它们作为门禁判断依据）。

notify pgrst, 'reload schema';
