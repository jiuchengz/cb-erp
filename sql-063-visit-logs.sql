-- ============================================================================
-- 063_visit_logs —— 访问记录（来访 IP）· 待执行 SQL（可直接整段粘贴到 Supabase SQL Editor）
-- 项目：cb-erp    配套代码：server/_handlers/visit.ts、visits.ts、src/pages/Settings.vue
-- 说明：
--   1) 采集所有系统页面访问（含登录页 /login），记录 IP、IP 归属地、访问路径、时间、账号、设备；
--   2) IP 归属地由服务端调用公开 IP 库解析，解析失败留空、前端显示「未知」，不阻塞写入；
--   3) 同一 IP 对同一路径 60 秒内的重复访问由服务端去重，不重复入库；
--   4) 读写在服务端统一使用 service_role（绕过 RLS），anon / authenticated 直连一律拒绝；
--   5) 仅持有 system.visit 权限的账号（super_admin）可查看记录。
-- 本脚本可重复执行（幂等），执行后无需重启服务。
-- ============================================================================

-- 1) 访问记录表
create table if not exists public.visit_logs (
  id uuid primary key default gen_random_uuid(),
  ip text,
  country text,          -- 归属地：国家
  region text,           -- 归属地：省/州
  city text,             -- 归属地：城市
  isp text,              -- 归属地：运营商
  path text,             -- 访问路径（不含查询串）
  user_id uuid,          -- 已登录：账号 id
  user_email text,       -- 已登录：账号邮箱；未登录为 null
  is_guest boolean not null default true,
  user_agent text,
  device text,           -- 由 UA 解析出的设备/浏览器摘要
  referer text,
  created_at timestamptz not null default now()
);

-- 2) 索引：列表按时间倒序分页；去重按 (ip, path, created_at) 命中；筛选按 ip / 路径 / 账号
create index if not exists idx_visit_created on public.visit_logs(created_at desc);
create index if not exists idx_visit_ip_path_created on public.visit_logs(ip, path, created_at desc);
create index if not exists idx_visit_ip on public.visit_logs(ip);
create index if not exists idx_visit_path on public.visit_logs(path);
create index if not exists idx_visit_email on public.visit_logs(user_email);

-- 3) RLS：默认 deny（不创建任何 policy）
alter table public.visit_logs enable row level security;

-- 4) 新增权限项 system.visit，并绑定到 super_admin 角色
insert into public.permissions (code, description) values
  ('system.visit', '访问记录')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'super_admin'
  and p.code = 'system.visit'
on conflict do nothing;

-- 5) 通知 PostgREST 重新加载 schema（让新表 / 新权限立即可用）
notify pgrst, 'reload schema';

-- 6) 自检（可选，粘贴执行后应能看到 1 行）
select p.code, p.description, count(rp.role_id) as bound_roles
from public.permissions p
left join public.role_permissions rp on rp.permission_id = p.id
where p.code = 'system.visit'
group by p.code, p.description;
