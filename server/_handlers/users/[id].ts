import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { SYSTEM_MANAGE_EXPAND } from '../_lib/permissions';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

const updateSchema = z.object({
  // 邮箱/密码走 Supabase Auth（service_role），其余字段走 profiles
  email: z.string().email().optional(),
  name: z.string().min(1).max(100).optional(),
  password: z.string().min(6).max(72).optional(),
  is_active: z.boolean().optional(),
  role_ids: z.array(z.string().uuid()).optional(),
  // 用户直接绑定的可见仓库 id（仓库级行级隔离：用户维度）
  warehouse_ids: z.array(z.string().uuid()).optional(),
});

// 与后端管理入口相关、不允许自我移除的权限。
// 058 拆分后 system.manage 已拆为 11 个 system.* 子码，须一并纳入保护，
// 否则用户把自己降级成不含任何 system.* 的角色时会被放行，导致管理入口锁死。
const MANAGE_CODES = ['user.manage', 'system.manage', ...SYSTEM_MANAGE_EXPAND];

async function collectRoleCodes(supabase: any, roleIds: string[]) {
  if (!roleIds || roleIds.length === 0) return [] as string[];
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permissions(code)')
    .in('role_id', roleIds);
  if (error) throw error;
  return (data || []).map((rp: any) => rp.permissions?.code).filter(Boolean) as string[];
}

// 前后端字段归一：
// user_roles(role_id, roles) -> 顶层 roles: [{id, name}]（前端读 row.roles）
// user_warehouses(warehouse_id) -> 顶层 warehouse_ids: [仓库id]（前端读 row.warehouse_ids）
// display_name -> name（前端读 row.name 渲染姓名列/编辑回填）
export function normalizeUserRoles(row: any) {
  const userRoles = row?.user_roles || [];
  const userWarehouses = row?.user_warehouses || [];
  const rolesArr = userRoles.map((ur: any) => ur?.roles).filter(Boolean);
  const { user_roles, user_warehouses, ...rest } = row || {};
  return {
    ...rest,
    name: row?.display_name ?? '',
    roles: rolesArr,
    warehouse_ids: userWarehouses.map((uw: any) => uw?.warehouse_id).filter(Boolean) as string[],
    is_super_admin: rolesArr.some((r: any) => r?.name === 'super_admin'),
  };
}

async function getProfileWithRoles(supabase: any, id: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, user_roles(role_id, roles(id, name)), user_warehouses(warehouse_id)')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') throw Errors.notFound('用户不存在');
    throw error;
  }
  return normalizeUserRoles(data);
}

// 校验仓库 id 均存在，返回去重后的合法 id 列表
async function resolveWarehouseIds(supabase: any, ids: string[]) {
  if (!ids || ids.length === 0) return [] as string[];
  const uniqueIds = Array.from(new Set(ids));
  const { data, error } = await supabase.from('warehouses').select('id').in('id', uniqueIds);
  if (error) throw error;
  const found = new Set((data || []).map((w: any) => w.id));
  const missing = uniqueIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw Errors.badRequest('存在无效仓库 ID');
  return uniqueIds;
}

// 全量覆盖写用户的仓库绑定（user_warehouses）
async function replaceUserWarehouses(supabase: any, userId: string, warehouseIds: string[]) {
  const { error: delErr } = await supabase.from('user_warehouses').delete().eq('user_id', userId);
  if (delErr) throw delErr;
  if (warehouseIds.length > 0) {
    const rows = warehouseIds.map((warehouse_id) => ({ user_id: userId, warehouse_id }));
    const { error: insErr } = await supabase.from('user_warehouses').insert(rows);
    if (insErr) throw insErr;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'PATCH') {
      requirePermission(ctx, 'user.manage');
      const body = parse(updateSchema, req.body || {});
      if (Object.keys(body).length === 0) throw Errors.badRequest('无更新字段');
      // 目标用户必须存在（并取当前角色供自我保护判断）
      const before = await getProfileWithRoles(supabase, id);

      // 1) Auth 层更新：邮箱 / 密码
      if (body.email !== undefined || body.password !== undefined) {
        const authPatch: Record<string, unknown> = {};
        if (body.email !== undefined) authPatch.email = body.email;
        if (body.password !== undefined) authPatch.password = body.password;
        const { error: authErr } = await supabase.auth.admin.updateUserById(id, authPatch);
        if (authErr) {
          if (authErr.status === 409 || /already.*exist/i.test(authErr.message || '')) {
            throw Errors.conflict('邮箱已被其他账号使用');
          }
          throw authErr;
        }
      }

      // 2) profiles 字段更新
      const profilePatch: Record<string, unknown> = {};
      if (body.name !== undefined) profilePatch.display_name = body.name;
      if (body.is_active !== undefined) profilePatch.is_active = body.is_active;
      if (Object.keys(profilePatch).length > 0) {
        const { error: profileErr } = await supabase.from('profiles').update(profilePatch).eq('id', id);
        if (profileErr) throw profileErr;
      }

      // 3) 角色更新：整表替换 user_roles
      if (body.role_ids !== undefined) {
        // 自我保护：编辑自己账号时，禁止移除全部管理权限（成员/系统管理子码），防止锁死管理入口
        if (id === ctx.userId && before.roles && before.roles.length > 0) {
          const beforeCodes = await collectRoleCodes(supabase, before.roles.map((r: any) => r.id));
          const afterCodes = await collectRoleCodes(supabase, body.role_ids);
          const beforeManage = beforeCodes.some((c) => MANAGE_CODES.includes(c));
          const afterManage = afterCodes.some((c) => MANAGE_CODES.includes(c));
          if (beforeManage && !afterManage) {
            throw Errors.badRequest('不能移除自己账号的全部管理权限，否则将失去管理入口');
          }
        }
        const { error: delErr } = await supabase.from('user_roles').delete().eq('user_id', id);
        if (delErr) throw delErr;
        if (body.role_ids.length > 0) {
          const rows = body.role_ids.map((role_id) => ({ user_id: id, role_id }));
          const { error: insErr } = await supabase.from('user_roles').insert(rows);
          if (insErr) throw insErr;
        }
      }

      // 4) 仓库绑定更新：整表替换 user_warehouses（super_admin 全量，前端不展示绑定）
      if (body.warehouse_ids !== undefined) {
        const whIds = await resolveWarehouseIds(supabase, body.warehouse_ids);
        await replaceUserWarehouses(supabase, id, whIds);
      }

      const after = await getProfileWithRoles(supabase, id);
      await writeAudit(ctx, req, 'update', 'user', id, null, after);
      return res.status(200).json({ data: after });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'user.manage');
      if (id === ctx.userId) throw Errors.badRequest('不能删除当前登录账号');
      const before = await getProfileWithRoles(supabase, id);
      const isSuperAdmin = (before.roles || []).some((r: any) => r?.name === 'super_admin');
      if (isSuperAdmin) throw Errors.badRequest('超级管理员不可删除');
      const { error: authErr } = await supabase.auth.admin.deleteUser(id);
      if (authErr) throw authErr;
      await writeAudit(ctx, req, 'delete', 'user', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
