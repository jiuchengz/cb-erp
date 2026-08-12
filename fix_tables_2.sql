-- 第2条：inventory
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
