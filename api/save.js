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
      'Prefer': 'return=representation'
    };

    // 1. 备份现有数据（防止 INSERT 失败导致全表清空）
    var oldRows = [];
    var oldRes = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?select=*', {
      headers: headers
    });
    if (oldRes.ok) {
      oldRows = await oldRes.json();
    }

    // 2. 规范化：剔除服务端生成字段，统一所有行的键集合（消除 PGRST102）
    var SERVER_FIELDS = { 'id': true, 'created_at': true };
    var allKeys = [];
    var seenKeys = {};
    for (var i = 0; i < data.length; i++) {
      for (var k in data[i]) {
        if (!data[i].hasOwnProperty(k)) continue;
        if (SERVER_FIELDS[k]) continue;
        if (!seenKeys[k]) { seenKeys[k] = true; allKeys.push(k); }
      }
    }

    var normalized = [];
    for (var i = 0; i < data.length; i++) {
      var row = {};
      for (var j = 0; j < allKeys.length; j++) {
        var key = allKeys[j];
        row[key] = (data[i][key] === undefined) ? null : data[i][key];
      }
      normalized.push(row);
    }

    // 3. 删除旧数据
    var delRes = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=gt.0', {
      method: 'DELETE',
      headers: headers
    });

    if (!delRes.ok && delRes.status !== 404) {
      return res.status(delRes.status).json({ error: 'DELETE ' + table + ' 失败: ' + delRes.status });
    }

    // 4. INSERT 新数据（已规范化键）
    if (!normalized.length) {
      return res.status(200).json({ ok: true, table: table, deleted: true, inserted: 0 });
    }

    var batch = [];
    for (var i = 0; i < normalized.length; i++) {
      batch.push(normalized[i]);
      if (batch.length >= 500 || i === normalized.length - 1) {
        var insRes = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(batch)
        });
        if (!insRes.ok) {
          // INSERT 失败：回滚，恢复备份数据
          var sbErr = await insRes.text();
          if (oldRows.length) {
            for (var b = 0; b < oldRows.length; b += 500) {
              var chunk = oldRows.slice(b, b + 500);
              var restoreRows = chunk.map(function(r) {
                var nr = {};
                for (var rk in r) {
                  if (SERVER_FIELDS[rk]) continue;
                  nr[rk] = r[rk];
                }
                return nr;
              });
              try {
                await fetch(SUPABASE_URL + '/rest/v1/' + table, {
                  method: 'POST',
                  headers: headers,
                  body: JSON.stringify(restoreRows)
                });
              } catch (e) {}
            }
          }
          return res.status(insRes.status).json({
            error: 'INSERT ' + table + ' 失败: ' + insRes.status + '（已回滚旧数据）',
            supabase_error: sbErr,
            sample_keys: normalized.length > 0 ? allKeys.join(',') : '(empty)',
            batch_size: batch.length
          });
        }
        batch = [];
      }
    }

    // 5. 验证
    var verifyRes = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?select=count', {
      headers: headers
    });
    var verifyCount = 0;
    if (verifyRes.ok) {
      var vc = await verifyRes.json();
      verifyCount = vc[0] ? vc[0].count : 0;
    }
    return res.status(200).json({ ok: true, table: table, inserted: normalized.length, verified_count: verifyCount });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
