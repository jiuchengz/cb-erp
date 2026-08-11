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

  try {
    var results = {};

    // Test 1: anon key
    var r1 = await fetch(SUPABASE_URL + '/rest/v1/users?username=eq.superadmin&select=*', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    });
    results.anon = { ok: r1.ok, status: r1.status, count: 0, body: null };
    if (r1.ok) { var b = await r1.json(); results.anon.count = b.length; results.anon.body = b; }

    // Test 2: service role key
    var r2 = await fetch(SUPABASE_URL + '/rest/v1/users?username=eq.superadmin&select=*', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY }
    });
    results.service = { ok: r2.ok, status: r2.status, count: 0, body: null };
    if (r2.ok) { var b2 = await r2.json(); results.service.count = b2.length; results.service.body = b2; }

    // Test 3: count all users
    var r3 = await fetch(SUPABASE_URL + '/rest/v1/users?select=count', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY, 'Prefer': 'count=exact' }
    });
    results.count_all = { ok: r3.ok, status: r3.status, count: r3.headers.get('content-range') || 'N/A' };

    // Test 4: check if users table exists at all
    var r4 = await fetch(SUPABASE_URL + '/rest/v1/', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY }
    });
    results.schema = { ok: r4.ok, status: r4.status };

    return res.status(200).json({
      env: {
        has_url: !!SUPABASE_URL,
        has_key: !!SUPABASE_KEY,
        has_service: !!SUPABASE_SERVICE_KEY,
        has_jwt: !!process.env.JWT_SECRET,
        has_sb_jwt: !!process.env.SUPABASE_JWT_SECRET
      },
      results: results
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
