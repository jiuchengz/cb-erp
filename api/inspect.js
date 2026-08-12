// 复用已有 api/save.js 的 Supabase 连接来执行原始 SQL
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // 通过 Supabase REST API 的 RPC 方式执行 SQL
    // 使用 /rest/v1/rpc/exec_sql 如果存在的话
    // 否则逐表尝试插入空数据来探测列
    
    const tables = ['listings','shipments','inventory','transfers','sales','aftersales','procurement','replenishment'];
    const result = {};

    for (const table of tables) {
      try {
        // 尝试使用 REST API 获取 schema 信息
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=0`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
            'Accept': 'application/json'
          }
        });
        
        // 尝试从响应中提取列信息
        const headers = {};
        r.headers.forEach((v, k) => { headers[k] = v; });
        
        result[table] = {
          ok: r.ok,
          status: r.status,
          contentRange: r.headers.get('content-range') || 'N/A',
        };

        // 尝试用 OPTIONS 方法获取列
        try {
          const r2 = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'OPTIONS',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
            }
          });
          result[table].optionsStatus = r2.status;
          // 尝试解析 Allow 头中的列信息
          const body = await r2.text();
          if (body) {
            result[table].optionsBody = body.substring(0, 500);
          }
        } catch(e) {
          result[table].optionsError = e.message;
        }
        
      } catch(e) {
        result[table] = { error: e.message };
      }
    }

    return res.status(200).json({ result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
