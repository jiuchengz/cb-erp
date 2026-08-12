-- ==========================================
-- 跨境电商管理系统 - 7张缺失表（已优化语法）
-- 请在 Supabase SQL Editor 全选执行
-- ==========================================

-- 1. shipments（发货）
DROP TABLE IF EXISTS shipments;
CREATE TABLE shipments (
  id BIGSERIAL PRIMARY KEY,
  "shipDate" TEXT,
  forwarder TEXT,
  "shippingMode" TEXT,
  "warehouseNo" TEXT,
  "shippingCartons" INTEGER DEFAULT 0,
  "shippingQty" INTEGER DEFAULT 0,
  "shipmentNo" TEXT,
  "productCode" TEXT,
  "billableWeightVol" TEXT,
  "volumeDiff" TEXT,
  "billableAmount" NUMERIC DEFAULT 0,
  freight NUMERIC DEFAULT 0,
  "freightDiff" TEXT,
  "totalFreight" NUMERIC DEFAULT 0,
  "pullDeclareQty" INTEGER DEFAULT 0,
  "estimatedArrival" TEXT,
  "cargoStatus" TEXT,
  "appointmentTime" TEXT,
  "warehouseStatus" TEXT,
  "actualWarehouseQty" INTEGER DEFAULT 0,
  "abnormalPenalty" TEXT,
  "billCheckStatus" TEXT,
  "checkTime" TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;

-- 2. inventory（库存）
DROP TABLE IF EXISTS inventory;
CREATE TABLE inventory (
  id BIGSERIAL PRIMARY KEY,
  img TEXT,
  code TEXT,
  barcode TEXT,
  "productName" TEXT,
  sku TEXT,
  "domesticStock" INTEGER DEFAULT 0,
  "overseasStock" INTEGER DEFAULT 0,
  "inTransit" INTEGER DEFAULT 0,
  "totalStock" INTEGER DEFAULT 0,
  "safeStock" INTEGER DEFAULT 0,
  "inTransitDetails" JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

-- 3. transfers（调拨）
DROP TABLE IF EXISTS transfers;
CREATE TABLE transfers (
  id BIGSERIAL PRIMARY KEY,
  remark TEXT,
  "sourceWarehouse" TEXT,
  "targetWarehouse" TEXT,
  date TEXT,
  status TEXT,
  shipping TEXT,
  "trackingNo" TEXT,
  items JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;

-- 4. sales（销售）
DROP TABLE IF EXISTS sales;
CREATE TABLE sales (
  id BIGSERIAL PRIMARY KEY,
  "orderNo" TEXT,
  code TEXT,
  "imgText" TEXT,
  "linkId" TEXT,
  "productName" TEXT,
  price NUMERIC DEFAULT 0,
  quantity INTEGER DEFAULT 0,
  "totalAmount" NUMERIC DEFAULT 0,
  profit NUMERIC DEFAULT 0,
  "saleDate" TEXT,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- 5. aftersales（售后）
DROP TABLE IF EXISTS aftersales;
CREATE TABLE aftersales (
  id BIGSERIAL PRIMARY KEY,
  "orderNo" TEXT,
  "linkId" TEXT,
  "imgText" TEXT,
  "productName" TEXT,
  "issueType" TEXT,
  description TEXT,
  status TEXT,
  result TEXT,
  "createDate" TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE aftersales ENABLE ROW LEVEL SECURITY;

-- 6. procurement（采购）
DROP TABLE IF EXISTS procurement;
CREATE TABLE procurement (
  id BIGSERIAL PRIMARY KEY,
  code TEXT,
  "imgText" TEXT,
  "productName" TEXT,
  "planQuantity" INTEGER DEFAULT 0,
  "actualQuantity" INTEGER DEFAULT 0,
  status TEXT,
  date TEXT,
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE procurement ENABLE ROW LEVEL SECURITY;

-- 7. replenishment（补货）
DROP TABLE IF EXISTS replenishment;
CREATE TABLE replenishment (
  id BIGSERIAL PRIMARY KEY,
  code TEXT,
  "imgText" TEXT,
  "productName" TEXT,
  "currentStock" INTEGER DEFAULT 0,
  "replenishQty" INTEGER DEFAULT 0,
  priority TEXT,
  status TEXT,
  eta TEXT,
  "replenishmentTime" TEXT,
  "arrivalTime" TEXT,
  readonly BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE replenishment ENABLE ROW LEVEL SECURITY;
