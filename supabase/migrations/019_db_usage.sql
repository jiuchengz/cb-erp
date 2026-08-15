-- 019_db_usage.sql
-- 数据库用量统计函数：返回当前数据库大小（字节）
-- 供 server/_handlers/db-usage.ts 的 GET /api/db-usage 调用（Supabase 免费版配额 500MB）

create or replace function public.get_db_size()
returns bigint
language sql
stable
as $$
  select pg_database_size(current_database());
$$;

grant execute on function public.get_db_size() to service_role;
grant execute on function public.get_db_size() to authenticated;
