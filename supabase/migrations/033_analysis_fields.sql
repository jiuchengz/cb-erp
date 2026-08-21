-- 033_analysis_fields.sql
-- 经营分析模块补充字段
-- 1. products 增加安全库存（safety_stock），供库存预警 / 安全库存达标率 / 补货建议使用
alter table public.products
  add column if not exists safety_stock numeric(18,2) not null default 0 check (safety_stock >= 0);

-- 2. 国内库存分析的在库时长：使用国内仓 inventory.created_at（最早入库时间）作为在库起点，无需新增字段
