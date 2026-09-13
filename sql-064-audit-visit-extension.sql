-- 064_audit_visit_extension.sql
-- 「访问记录 + 审计日志」三项扩展的数据库变更：
--   1) audit_logs 增加 user_email：审计日志直接记录操作人账号邮箱（历史数据为 null，
--      前端「操作人」列对无邮箱的历史记录回退展示账号 ID 短值）；
--   2) visit_logs 增加 visitor_id：匿名访客标识（前端 localStorage 持久化的随机 UUID，
--      不含任何个人信息），服务端去重由「同 IP + 同路径」改为「同访客 ID + 同路径」
--      （无 visitor_id 时仍回退按 IP 去重）；
--   3) 重载 PostgREST schema 缓存，使新增列立即对 API 生效。
-- 说明：仅新增列与索引，不修改任何既有列 / 数据 / 约束，可安全重复执行。

-- 1) 审计日志：新增操作人邮箱列
alter table public.audit_logs add column if not exists user_email text;

-- 按邮箱检索审计记录（可选筛选场景）
create index if not exists idx_audit_email on public.audit_logs(user_email);

-- 2) 访问记录：新增匿名访客标识列
alter table public.visit_logs add column if not exists visitor_id text;

-- 去重命中的索引：按 (visitor_id, path, created_at desc) 先查后插
-- （保留 063 中的 (ip, path, created_at desc) 索引，供无访客 ID 时的 IP 回退去重使用）
create index if not exists idx_visit_visitor_path_created
  on public.visit_logs(visitor_id, path, created_at desc);

-- 3) 让 PostgREST 重新加载 schema（新增列 / 索引立即生效，无需重启服务）
notify pgrst, 'reload schema';
