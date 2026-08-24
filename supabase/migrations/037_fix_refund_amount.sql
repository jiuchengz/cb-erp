-- 037: 补算历史退款金额（退款数量 × 单价）
-- 背景：此前导入退款行未填单价，导致 daily_sales.refund_amount = 0，
--       页面"退款金额"显示为 0。此迁移回填历史数据。
-- 执行方式：在 Supabase SQL Editor 中执行，可重复执行（幂等）。

-- 1) 退款金额 = 退款数量 × 同记录单价（销售行与退款行同 key 聚合后 unit_price 即为销售单价）
UPDATE daily_sales
SET refund_amount = refund_qty * unit_price
WHERE refund_qty > 0 AND refund_amount = 0 AND unit_price > 0;

-- 2) 兜底：退款行单价也为 0 时，用 products 表售价（MXN）补算并回填单价
UPDATE daily_sales ds
SET refund_amount = ds.refund_qty * p.unit_price,
    unit_price = p.unit_price
FROM products p
WHERE ds.refund_qty > 0 AND ds.refund_amount = 0
  AND p.link_id = ds.link_id
  AND p.unit_price > 0;

-- 3) 顺带：销售行单价为 0 的历史数据，用产品售价回填（保证"实际销售额=实际销量×单价"准确）
UPDATE daily_sales ds
SET unit_price = p.unit_price
FROM products p
WHERE ds.unit_price = 0
  AND ds.quantity > 0
  AND p.link_id = ds.link_id
  AND p.unit_price > 0;

-- 验证：仍有退款数量但退款金额为 0 的（说明产品也未维护售价，需人工补产品售价后重跑）
SELECT sale_date, link_id, product_name, quantity, refund_qty, refund_amount, unit_price
FROM daily_sales
WHERE refund_qty > 0 AND refund_amount = 0
ORDER BY sale_date DESC;
