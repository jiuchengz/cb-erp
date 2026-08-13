-- 011_audit_logs.sql
-- 审计日志

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null,
  resource_type text,
  resource_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_user on public.audit_logs(user_id);
create index if not exists idx_audit_created on public.audit_logs(created_at);
create index if not exists idx_audit_resource on public.audit_logs(resource_type, resource_id);
