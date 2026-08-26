-- 038: 销售统计加载提速 —— daily_sales 日期索引
-- 作用：销售统计页按日期范围查询聚合，sale_date 加索引后可大幅减少扫描行数。
-- 说明：IF NOT EXISTS 保证可重复执行；仅建索引，不修改数据，可随时执行。

-- 1. 日期范围过滤索引（销售统计按日期区间查询）
CREATE INDEX IF NOT EXISTS idx_daily_sales_sale_date ON daily_sales (sale_date);

-- 2. 复合索引：日期 + 链接（覆盖常见过滤与排序组合，含关键词查询按链接匹配）
CREATE INDEX IF NOT EXISTS idx_daily_sales_date_link ON daily_sales (sale_date, link_id);

-- 3. 校验：执行后应能看到两个新索引
-- SELECT indexname FROM pg_indexes WHERE tablename = 'daily_sales' ORDER BY indexname;
