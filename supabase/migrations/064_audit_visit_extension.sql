-- 064_audit_visit_extension.sql
-- 「访问记录 + 审计日志」扩展：
--   1) audit_logs 增加 user_email：记录操作人账号邮箱（登录成功也会写入 action=login / resource_type=auth）；
--   2) visit_logs 增加 visitor_id：匿名访客标识（前端 localStorage 随机 UUID），
--      服务端去重由「同 IP + 同路径 60s」改为「同访客 ID + 同路径 60s」（无访客 ID 时回退 IP）；
--   3) 重载 PostgREST schema 缓存。
-- 仅新增列与索引，不修改既有列 / 数据 / 约束，可重复执行。

-- 1) 审计日志：操作人邮箱
alter table public.audit_logs add column if not exists user_email text;

create index if not exists idx_audit_email on public.audit_logs(user_email);

-- 2) 访问记录：匿名访客标识
alter table public.visit_logs add column if not exists visitor_id text;

create index if not exists idx_visit_visitor_path_created
  on public.visit_logs(visitor_id, path, created_at desc);

-- 3) 重载 schema 缓存
notify pgrst, 'reload schema';
