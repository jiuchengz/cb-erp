const { Pool } = require('pg');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const ref = 'lytbkusovltcgwmsikgp';
  const password = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const candidates = [
    { name: 'direct', host: `db.${ref}.supabase.co`, port: 5432 },
    { name: 'pooler-us-east-1', host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543 },
    { name: 'pooler-ap-southeast-1', host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 6543 },
    { name: 'pooler-ap-northeast-1', host: 'aws-0-ap-northeast-1.pooler.supabase.com', port: 6543 },
    { name: 'pooler-eu-west-1', host: 'aws-0-eu-west-1.pooler.supabase.com', port: 6543 },
    { name: 'pooler-eu-central-1', host: 'aws-0-eu-central-1.pooler.supabase.com', port: 6543 },
    { name: 'pooler-us-west-1', host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543 },
    { name: 'pooler-ap-southeast-2', host: 'aws-0-ap-southeast-2.pooler.supabase.com', port: 6543 }
  ];

  let client = null;
  let connected = null;
  const attempts = [];

  for (const c of candidates) {
    const pool = new Pool({
      host: c.host, port: c.port, database: 'postgres', user: 'postgres.lytbkusovltcgwmsikgp',
      password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000
    });
    try {
      const cl = await pool.connect();
      client = cl; connected = c; break;
    } catch (e) {
      attempts.push({ name: c.name, error: e.message });
      try { await pool.end(); } catch (_) {}
    }
  }

  if (!client) {
    return res.status(500).json({ error: 'ALL_CONNECTION_FAILED', attempts });
  }

  try {
    const tables = {
      listings: ["barcode","category","code","competitorId","dailySales","firstLegFreight","imgText","lastMileDeliveryPeso","linkId","listingTime","mlCommissionRate","monthSales","name","purchaseCost","sellingPricePeso","shipping","sku","todaySales","totalSales","unit","warehouseNo"],
      shipments: ["abnormalPenalty","actualWarehouseQty","appointmentTime","billCheckStatus","billableAmount","billableWeightVol","cargoStatus","checkTime","estimatedArrival","forwarder","freight","freightDiff","productCode","pullDeclareQty","shipDate","shipmentNo","shippingCartons","shippingMode","shippingQty","totalFreight","volumeDiff","warehouseNo","warehouseStatus"],
      inventory: ["barcode","code","domesticStock","img","inTransit","inTransitDetails","overseasStock","productName","safeStock","sku","totalStock"],
      transfers: ["code","date","items","productName","quantity","remark","shipping","sourceWarehouse","status","targetWarehouse","trackingNo"],
      sales: ["code","imgText","linkId","orderNo","platform","price","productName","profit","quantity","saleDate","totalAmount"],
      aftersales: ["createDate","description","imgText","issueType","linkId","orderNo","productName","result","status"],
      procurement: ["actualQuantity","code","date","imgText","planQuantity","productName","remark","status"],
      replenishment: ["arrivalTime","code","currentStock","eta","imgText","priority","productName","readonly","replenishQty","replenishmentTime","status"]
    };

    const textCols = ["imgText","inTransitDetails","items","description","shippingCartons","readonly"];
    const numCols = ["dailySales","monthSales","todaySales","totalSales","mlCommissionRate","price","profit","totalAmount","freight","totalFreight","freightDiff","billableAmount","billableWeightVol","volumeDiff","abnormalPenalty","sellingPricePeso","purchaseCost","firstLegFreight","lastMileDeliveryPeso"];
    const intCols = ["domesticStock","overseasStock","inTransit","totalStock","safeStock","quantity","shippingQty","pullDeclareQty","actualWarehouseQty","currentStock","replenishQty","planQuantity","actualQuantity"];
    const tsCols = ["listingTime","appointmentTime","checkTime","shipDate","date","saleDate","createDate","arrivalTime","replenishmentTime"];

    const results = {};
    let totalAdded = 0;

    for (const [table, cols] of Object.entries(tables)) {
      results[table] = { added: [], errors: [] };
      for (const col of cols) {
        let colType = 'TEXT';
        if (textCols.includes(col)) colType = 'TEXT';
        else if (numCols.includes(col)) colType = 'NUMERIC';
        else if (intCols.includes(col)) colType = 'INTEGER';
        else if (tsCols.includes(col)) colType = 'TIMESTAMPTZ';
        try {
          await client.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" ${colType}`);
          results[table].added.push(col);
          totalAdded++;
        } catch (e) {
          results[table].errors.push(col + ': ' + e.message);
        }
      }
    }

    const verify = {};
    for (const table of Object.keys(tables)) {
      try {
        const r = await client.query(`SELECT count(*) as cnt FROM "${table}"`);
        verify[table] = r.rows[0].cnt;
      } catch (e) {
        verify[table] = 'ERROR: ' + e.message;
      }
    }

    return res.status(200).json({ ok: true, connectedVia: connected, totalColumnsAdded: totalAdded, results, verify });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  } finally {
    try { client.release(); } catch (_) {}
  }
};
