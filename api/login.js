var jwt = require('jsonwebtoken');
var bcrypt = require('bcryptjs');

var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
var SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
var JWT_SECRET = process.env.JWT_SECRET;
var SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

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
    var username = body.username;
    var password = body.password;

    if (!username || !password) {
      return res.status(400).json({ error: '缺少用户名或密码' });
    }

    // 查询用户
    var userUrl = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username) + '&select=*';
    var userRes = await fetch(userUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      }
    });

    if (!userRes.ok) {
      return res.status(500).json({ error: '查询用户失败: ' + userRes.status });
    }

    var users = await userRes.json();
    if (!users || users.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    var user = users[0];
    var passwordValid = false;

    // 检查是否有 password_hash
    if (user.password_hash) {
      passwordValid = bcrypt.compareSync(password, user.password_hash);
    } else if (user.password) {
      // 兼容旧明文密码
      passwordValid = (password === user.password);
      if (passwordValid) {
        // 自动升级为 bcrypt 哈希
        var hash = bcrypt.hashSync(password, 10);
        var patchUrl = SUPABASE_URL + '/rest/v1/users?id=eq.' + user.id;
        await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ password_hash: hash })
        });
      }
    }

    if (!passwordValid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成 Supabase JWT
    var supabaseJwt = jwt.sign(
      { sub: user.id, username: user.username, role: 'authenticated' },
      SUPABASE_JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 生成应用 JWT
    var appJwt = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role || 'operator' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(200).json({
      token: supabaseJwt,
      app_token: appJwt,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role || 'operator',
        avatar: user.avatar || ''
      }
    });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: '服务器内部错误' });
  }
};
