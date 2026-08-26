-- 039: 成本利润表模块 - products 表新增字段
-- 说明：全部使用 ADD COLUMN IF NOT EXISTS，可重复执行；仅加列不改数据。
-- 1. 尺寸与重量（Excel 模板：长/宽/高 cm，实重 KG）
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_cm numeric DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS width_cm numeric DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS height_cm numeric DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_kg numeric DEFAULT 0;

-- 2. 运费（独立填写列，不参与总成本计算）
ALTER TABLE products ADD COLUMN IF NOT EXISTS air_freight numeric DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sea_freight numeric DEFAULT 0;

-- 3. 附加费（比索，手工填写，参与总成本）
ALTER TABLE products ADD COLUMN IF NOT EXISTS add_fee numeric DEFAULT 0;

-- 4. 平台利润（元，由成本利润表按公式计算后写回）
ALTER TABLE products ADD COLUMN IF NOT EXISTS platform_profit numeric DEFAULT 0;

-- 校验：执行后应能看到上述 8 个新列
-- SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name IN ('length_cm','width_cm','height_cm','weight_kg','air_freight','sea_freight','add_fee','platform_profit') ORDER BY column_name;
