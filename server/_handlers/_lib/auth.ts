import type { VercelRequest } from '@vercel/node';
import { getAdminClient } from './db';
import { Errors } from './error';

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  roles: string[];
  permissions: string[];
  // 可见仓库集：由该账号直接绑定的 user_warehouses 得出（用户维度）。
  // super_admin 不受仓库限制，返回 null 表示"全量可见"。
  warehouseIds: string[] | null;
}

function extractToken(req: VercelRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export interface UserAccess {
  roles: string[];
  permissions: string[];
  warehouseIds: string[] | null;
}

// 实例级权限缓存：60 秒 TTL。
// Supabase 冷启动/连接初期偶发返回空数组（非报错），若每次都直查，
// 第一个冷启动请求仍可能拿到空结果；缓存命中后后续请求不再依赖数据库抖动。
const accessCache = new Map<string, { expireAt: number; roles: string[]; permissions: string[]; warehouseIds: string[] | null }>();
const CACHE_TTL_MS = 60 * 1000;

// 单次完整加载：user_roles -> roles -> role_permissions -> permissions，以及
// user_warehouses -> 可见仓库（用户维度）。
// 查询失败必须显性报错，禁止静默当成"无角色"（否则会误报 403 无权限）。
// 仓库隔离口径：super_admin 返回 warehouseIds=null（全量可见，不受仓库限制）；
// 其余账号可见仓库 = 其 user_warehouses 直接绑定集（可为空数组 = 无可见仓库）。
// 兼容降级：user_warehouses 表尚未部署（迁移未执行）时，仓库维度降级为全量空集，
// 不阻断认证；业务侧需待迁移完成后才有隔离效果。
async function loadUserAccessOnce(supabase: any, userId: string): Promise<UserAccess> {
  const roles: string[] = [];
  const permissionsSet = new Set<string>();
  const warehouseSet = new Set<string>();

  // 嵌套关联查询：一次拿到 user_roles + 角色名（替代原来 4 次串行查询）
  const { data: userRoles, error: userRolesErr } = await supabase
    .from('user_roles')
    .select('role_id, roles(name)')
    .eq('user_id', userId);
  if (userRolesErr) throw new Error('加载用户角色失败: ' + userRolesErr.message);

  const roleIds = (userRoles || []).map((r: any) => r.role_id);
  let isSuperAdmin = false;
  for (const r of userRoles || []) {
    const name = r.roles?.name;
    if (name) {
      roles.push(name);
      if (name === 'super_admin') isSuperAdmin = true;
    }
  }

  // super_admin 不需要仓库绑定：null 表示全量；普通账号按 user_warehouses 直接绑定加载
  if (!isSuperAdmin) {
    const { data: uwData, error: uwErr } = await supabase
      .from('user_warehouses')
      .select('warehouse_id')
      .eq('user_id', userId);
    // 迁移未上线（表不存在等）时降级为空集，不阻断认证
    if (!uwErr) {
      for (const uw of uwData || []) {
        if (uw?.warehouse_id) warehouseSet.add(uw.warehouse_id);
      }
    } else {
      console.warn('[auth] user_warehouses load skipped (migration not applied?):', uwErr.message);
    }
  }

  if (roleIds.length) {
    // 嵌套关联查询：一次拿到 role_permissions + 权限码
    const { data: rpData, error: rpErr } = await supabase
      .from('role_permissions')
      .select('permission_id, permissions(code)')
      .in('role_id', roleIds);
    if (rpErr) throw new Error('加载角色权限失败: ' + rpErr.message);
    for (const rp of rpData || []) {
      const code = rp.permissions?.code;
      if (code) permissionsSet.add(code);
    }
  }

  return {
    roles,
    permissions: Array.from(permissionsSet),
    // super_admin 不需要仓库绑定：null 表示全量
    warehouseIds: isSuperAdmin ? null : Array.from(warehouseSet),
  };
}

// 加载用户角色与权限（带缓存 + 空结果抖动退避重试）。
// 只要最终拿到任意角色或权限即视为成功；整段查询（不止 user_roles）
// 在冷启动初期都可能偶发返回空数组，因此对完整加载结果做多次退避重试，
// 覆盖最长约 5s 抖动窗口，仍为空才判定"无角色"。
export async function loadUserAccess(supabase: any, userId: string): Promise<UserAccess> {
  const cached = accessCache.get(userId);
  if (cached && cached.expireAt > Date.now()) {
    return { roles: cached.roles, permissions: cached.permissions, warehouseIds: cached.warehouseIds };
  }

  const retryDelays = [0, 1000, 3000, 6000];
  let last: UserAccess = { roles: [], permissions: [], warehouseIds: [] };
  for (const delay of retryDelays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    last = await loadUserAccessOnce(supabase, userId);
    if (last.roles.length > 0 || last.permissions.length > 0) break;
  }

  // 关键：只有拿到非空结果才写缓存。空结果绝不缓存——
  // Vercel 多实例下某实例冷启动查库偶发返回空，若把空结果缓存 60s，
  // 会把瞬时抖动放大成持续 403；不缓存则下一个请求会重新查库纠正。
  if (last.roles.length > 0 || last.permissions.length > 0) {
    accessCache.set(userId, {
      expireAt: Date.now() + CACHE_TTL_MS,
      roles: last.roles,
      permissions: last.permissions,
      warehouseIds: last.warehouseIds,
    });
  }
  return last;
}

// 验证 JWT（经 Supabase Auth），并加载用户角色与权限。
// 这是每个业务 API 的入口：Authentication -> Authorization。
export async function requireAuth(req: VercelRequest): Promise<AuthContext> {
  const token = extractToken(req);
  if (!token) throw Errors.unauthorized('未登录或缺少令牌');

  // 强制重建干净 service_role client：登录 handler 的 signInWithPassword 会污染共享 client
  // （写入用户 session），若复用会被 RLS 按 authenticated 身份过滤，导致权限查询全空 → 403。
  const supabase = getAdminClient(true);
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData.user) {
    throw Errors.unauthorized('登录已失效，请重新登录');
  }
  const userId = authData.user.id;

  // 加载 profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, display_name, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  // 加载角色与权限（带缓存 + 空结果抖动退避重试，见 loadUserAccess）
  const { roles, permissions, warehouseIds } = await loadUserAccess(supabase, userId);

  return {
    userId,
    email: authData.user.email || profile?.email || '',
    displayName: (profile as any)?.display_name || '',
    avatarUrl: (profile as any)?.avatar_url || '',
    roles,
    permissions: Array.from(permissions),
    warehouseIds,
  };
}
