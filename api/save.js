var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
var SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    var body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    var table = body.table;
    var data = body.data;

    if (!table) {
      return res.status(400).json({ error: '缺少 table 参数' });
    }

    var headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };

    // 1. 删除旧数据
    var delRes = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=gt.0', {
      method: 'DELETE',
      headers: headers
    });

    if (!delRes.ok && delRes.status !== 404) {
      return res.status(delRes.status).json({ error: 'DELETE ' + table + ' 失败: ' + delRes.status });
    }

    // 2. UPSERT 新数据
    if (!data || !data.length) {
      return res.status(200).json({ ok: true, table: table, deleted: true, inserted: 0 });
    }

    var batch = [];
    for (var i = 0; i < data.length; i++) {
      var row = {};
      for (var k in data[i]) {
        if (!data[i].hasOwnProperty(k)) continue;
        if (k === 'id') continue;
        row[k] = data[i][k];
      }
      batch.push(row);
      if (batch.length >= 500 || i === data.length - 1) {
        var insRes = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(batch)
        });
        if (!insRes.ok) {
          var sbErr = await insRes.text();
          var sampleKeys = batch.length > 0 ? Object.keys(batch[0]).join(',') : '(empty)';
          return res.status(insRes.status).json({ 
            error: 'INSERT ' + table + ' 失败: ' + insRes.status,
            supabase_error: sbErr,
            sample_keys: sampleKeys,
            batch_size: batch.length
          });
        }
        batch = [];
      }
    }

    // 验证：重新读取确认数据已写入
    var verifyRes = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?select=count', {
      headers: headers
    });
    var verifyCount = 0;
    if (verifyRes.ok) {
      var vc = await verifyRes.json();
      verifyCount = vc[0] ? vc[0].count : 0;
    }
    return res.status(200).json({ ok: true, table: table, inserted: data.length, verified_count: verifyCount });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
