var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
var SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    var table = req.query.table;
    if (!table) {
      return res.status(400).json({ error: '缺少 table 参数' });
    }

    var headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
    };

    var all = [];
    var offset = 0;
    var limit = 1000;

    while (true) {
      var url = SUPABASE_URL + '/rest/v1/' + table + '?select=*&limit=' + limit + '&offset=' + offset;
      var fetchRes = await fetch(url, { headers: headers });

      if (!fetchRes.ok) {
        return res.status(fetchRes.status).json({ error: '查询 ' + table + ' 失败: ' + fetchRes.status });
      }

      var rows = await fetchRes.json();
      if (!rows || !rows.length) break;
      all = all.concat(rows);
      if (rows.length < limit) break;
      offset += limit;
    }

    return res.status(200).json({ ok: true, table: table, data: all });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
