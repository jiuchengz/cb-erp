-- 成本利润表：重量单位由 KG 改为 克(g)
-- 将 products.weight_kg 重命名为 weight_g，语义调整为克
alter table public.products rename column weight_kg to weight_g;
