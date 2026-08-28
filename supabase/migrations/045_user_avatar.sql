-- 045_user_avatar.sql
-- 用户头像：profiles 增加 avatar_url（与网站图标一致，直接存 dataURL）

alter table public.profiles
  add column if not exists avatar_url text;
