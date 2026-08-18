import type { VercelRequest } from '@vercel/node';
import { getAdminClient } from './db';
import { Errors } from './error';

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

function extractToken(req: VercelRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

// 验证 JWT（经 Supabase Auth），并加载用户角色与权限。
// 这是每个业务 API 的入口：Authentication -> Authorization。
export async function requireAuth(req: VercelRequest): Promise<AuthContext> {
  const token = extractToken(req);
  if (!token) throw Errors.unauthorized('未登录或缺少令牌');

  const supabase = getAdminClient();
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData.user) {
    throw Errors.unauthorized('登录已失效，请重新登录');
  }
  const userId = authData.user.id;

  // 加载 profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, display_name')
    .eq('id', userId)
    .maybeSingle();

  // 加载角色：查询失败必须显性报错，禁止静默当成"无角色"（否则会误报 403 无权限）
  const roles: string[] = [];
  const { data: userRoles, error: userRolesErr } = await supabase
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId);
  if (userRolesErr) throw new Error('加载用户角色失败: ' + userRolesErr.message);
  const roleIds = (userRoles || []).map((r) => r.role_id);
  if (roleIds.length) {
    const { data: roleData, error: roleErr } = await supabase
      .from('roles')
      .select('name')
      .in('id', roleIds);
    if (roleErr) throw new Error('加载角色定义失败: ' + roleErr.message);
    for (const r of roleData || []) if (r.name) roles.push(r.name);
  }

  // 加载权限
  const permissions = new Set<string>();
  if (roleIds.length) {
    const { data: rpData, error: rpErr } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .in('role_id', roleIds);
    if (rpErr) throw new Error('加载角色权限失败: ' + rpErr.message);
    const permIds = (rpData || []).map((r) => r.permission_id);
    if (permIds.length) {
      const { data: permData, error: permErr } = await supabase
        .from('permissions')
        .select('code')
        .in('id', permIds);
      if (permErr) throw new Error('加载权限定义失败: ' + permErr.message);
      for (const p of permData || []) if (p.code) permissions.add(p.code);
    }
  }

  return {
    userId,
    email: authData.user.email || profile?.email || '',
    displayName: (profile as any)?.display_name || '',
    roles,
    permissions: Array.from(permissions),
  };
}
