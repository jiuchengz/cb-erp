-- 第1条：shipments
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
