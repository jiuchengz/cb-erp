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
    // Test 1: Query user
    var userUrl = SUPABASE_URL + '/rest/v1/users?username=eq.superadmin&select=*';
    var userRes = await fetch(userUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      }
    });

    var users = userRes.ok ? await userRes.json() : [];
    var user = users && users.length > 0 ? users[0] : null;

    // Test 2: Check env vars
    return res.status(200).json({
      env: {
        has_url: !!SUPABASE_URL,
        has_key: !!SUPABASE_KEY,
        has_service: !!SUPABASE_SERVICE_KEY,
        has_jwt_secret: !!process.env.JWT_SECRET,
        has_supabase_jwt: !!process.env.SUPABASE_JWT_SECRET
      },
      query_ok: userRes.ok,
      query_status: userRes.status,
      users_count: users ? users.length : 0,
      user: user ? {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        has_password: 'password' in user,
        has_password_hash: 'password_hash' in user,
        keys: Object.keys(user)
      } : null
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
