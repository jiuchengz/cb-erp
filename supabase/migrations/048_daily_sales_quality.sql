-- 048_daily_sales_quality.sql
-- P2 数据补齐：daily_sales 数据质量治理
-- 1. 广告组维度（ad_group）：供统计/导出接口按广告组筛选（可选列，默认空）
-- 2. 店铺筛选索引：platform 高频过滤（销售统计页/接口按店铺筛选）
-- 3. 组合索引：sale_date + platform（日期+店铺常见过滤组合）
-- 幂等说明：唯一约束 daily_sales_unique(sale_date, platform, link_id) 已在 030 建立，
--   服务端 upsert 以该约束为冲突键做增量累加（P0 已完成），本迁移不再重复建约束，
--   只补充筛选索引与广告组列。
-- 执行方式：在 Supabase SQL Editor 手动执行，成功显示 "Success. No rows returned" 即可。

-- 1. 广告组列（可选，导入/编辑时可写）
alter table public.daily_sales
  add column if not exists ad_group text;

-- 2. 店铺（platform）筛选索引
create index if not exists idx_daily_sales_platform on public.daily_sales (platform);

-- 3. 日期+店铺组合索引
create index if not exists idx_daily_sales_date_platform on public.daily_sales (sale_date, platform);

-- 4. 日期+广告组组合索引（广告组筛选）
create index if not exists idx_daily_sales_date_ad_group on public.daily_sales (sale_date, ad_group);

-- 校验：执行后应能看到新列与索引
-- SELECT column_name FROM information_schema.columns WHERE table_name='daily_sales' AND column_name='ad_group';
-- SELECT indexname FROM pg_indexes WHERE tablename='daily_sales' ORDER BY indexname;

-- ============================================================
-- 附：历史重复数据核查（只读，不自动执行删除）
-- 唯一约束已存在的库中理论上无重复；若因历史导入方式不同出现重复，可用以下 SQL 核查：
--   select sale_date, platform, link_id, count(*) as cnt
--   from public.daily_sales
--   group by sale_date, platform, link_id
--   having count(*) > 1
--   order by cnt desc
--   limit 100;
-- 确认需要清理时（保留最新一条，其余删除），可执行：
--   delete from public.daily_sales a
--   using public.daily_sales b
--   where a.sale_date = b.sale_date and a.platform = b.platform and a.link_id = b.link_id
--     and a.created_at < b.created_at;
-- ⚠️ 删除为不可逆操作，请先在只读核查确认后再执行。
-- ============================================================
