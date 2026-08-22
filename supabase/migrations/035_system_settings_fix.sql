-- 035_system_settings_fix.sql
-- 修复系统设置保存不生效：补充 insert policy + 软删除开关初始行
-- 原因：旧 policy 只有 for update，upsert 首次插入 soft_delete_enabled 走 insert 分支会被 RLS 拦截

create policy "system_settings_insert" on public.system_settings
  for insert with check (true);

-- 补插软删除开关初始行（默认关闭），on conflict 不覆盖已存值
insert into public.system_settings (key, value) values
  ('soft_delete_enabled', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;
