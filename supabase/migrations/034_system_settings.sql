-- 034_system_settings.sql
-- 系统全局设置表：默认时区、默认币种、软删除(回收站)开关等
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- 初始化默认设置：默认时区=墨西哥城(UTC-6)，默认币种=MXN
insert into public.system_settings (key, value) values
  ('default_timezone', '{"tz":"America/Mexico_City","label":"墨西哥城 (UTC-6)","country":"墨西哥"}'::jsonb),
  ('default_currency', '{"code":"MXN","symbol":"MX$","name":"墨西哥比索"}'::jsonb)
on conflict (key) do nothing;

alter table public.system_settings enable row level security;

create policy "system_settings_read" on public.system_settings
  for select using (auth.role() = 'authenticated');
create policy "system_settings_write" on public.system_settings
  for update using (true) with check (true);
