const { Pool } = require('pg');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const ref = 'lytbkusovltcgwmsikgp';
    const pool = new Pool({
      host: `db.${ref}.supabase.co`,
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });

    const client = await pool.connect();

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
      results[table] = { added: [], skipped: [] };
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
          results[table].skipped.push(`${col}: ${e.message}`);
        }
      }
    }

    // Verify by querying each table
    const verify = {};
    for (const table of Object.keys(tables)) {
      try {
        const r = await client.query(`SELECT count(*) as cnt FROM "${table}"`);
        verify[table] = r.rows[0].cnt;
      } catch (e) {
        verify[table] = 'ERROR: ' + e.message;
      }
    }

    client.release();
    await pool.end();

    return res.status(200).json({ ok: true, totalColumnsAdded: totalAdded, results, verify });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
