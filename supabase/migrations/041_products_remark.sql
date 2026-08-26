-- 商品管理模块：新增备注字段（单位 unit 已在 015 迁移中存在）
alter table public.products add column if not exists remark text;
