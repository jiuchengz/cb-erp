-- 第3条：transfers（调拨）
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

-- 第4条：sales（销售）
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

-- 第5条：aftersales（售后）
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

-- 第6条：procurement（采购）
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

-- 第7条：replenishment（补货）
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
