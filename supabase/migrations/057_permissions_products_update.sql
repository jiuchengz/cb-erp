-- 057_permissions_products_update.sql
-- 补全权限码：products.update（商品成本/利润数据维护）
-- 背景：后端 cost-profit.ts 两处写接口 requirePermission(ctx, 'products.update')，
--       但 permissions 表种子从未注册该权限码，导致：
--       1) 权限列表/角色勾选 UI 中不存在该权限，无法授权；
--       2) resolvePermissionIds 校验失败，保存即报「权限不存在」；
--       3) 前端 CostProfit 按钮按 products.write 显隐，与后端校验不一致。
-- 1) 新增权限
insert into public.permissions (code, description) values
  ('products.update', '商品成本/利润数据维护')
on conflict (code) do nothing;

-- 2) 授权 super_admin / admin / manager（与 products.write 持有者对齐）
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name in ('super_admin', 'admin', 'manager')
  and p.code = 'products.update'
on conflict do nothing;

-- 3) 通知 PostgREST 刷新 schema 缓存
notify pgrst, 'reload schema';
