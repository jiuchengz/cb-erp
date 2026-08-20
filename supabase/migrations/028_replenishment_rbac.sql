-- 028_replenishment_rbac.sql
-- 补货模块权限：replenishment.read / replenishment.write
-- 背景：002_rbac.sql 种子数据缺少补货权限，导致补货页面操作按钮全部隐藏（前端 canWrite=false）

-- 1) 新增权限
insert into public.permissions (code, description) values
  ('replenishment.read', '查看补货'),
  ('replenishment.write', '创建/编辑补货')
on conflict (code) do nothing;

-- 2) super_admin / admin / manager：读写权限
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name in ('super_admin', 'admin', 'manager')
  and p.code in ('replenishment.read', 'replenishment.write')
on conflict do nothing;

-- 3) operator：只读权限
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'operator'
  and p.code = 'replenishment.read'
on conflict do nothing;

-- 4) 通知 PostgREST 刷新 schema 缓存
notify pgrst, 'reload schema';
