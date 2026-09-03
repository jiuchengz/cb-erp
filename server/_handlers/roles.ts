import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

// 系统内置角色（种子数据创建），不可编辑/删除
const SYSTEM_ROLES = new Set(['super_admin', 'admin', 'manager', 'operator']);

const createSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(256).nullable().optional(),
  permissions: z.array(z.string().min(1).max(100)).optional(),
  // 角色绑定的可见仓库 id（仓库级行级隔离）
  warehouses: z.array(z.string().uuid()).optional(),
});

// 前后端字段归一：role_permissions -> 顶层 permissions:[code]；
// role_warehouses -> 顶层 warehouse_ids:[仓库id]；并标记 is_system
function normalizeRole(row: any) {
  const perms = (row.role_permissions || []).map((rp: any) => rp.permissions?.code).filter(Boolean);
  const whIds = (row.role_warehouses || []).map((rw: any) => rw.warehouse_id).filter(Boolean);
  const { role_warehouses, ...rest } = row;
  return {
    ...rest,
    permissions: perms,
    warehouse_ids: whIds,
    is_system: SYSTEM_ROLES.has(row.name),
  };
}

// 校验权限 code 均为合法权限，返回 permissions 表 id 列表
async function resolvePermissionIds(supabase: any, codes: string[]) {
  if (!codes || codes.length === 0) return [] as string[];
  const { data, error } = await supabase
    .from('permissions')
    .select('id, code')
    .in('code', codes);
  if (error) throw error;
  const found = data || [];
  const foundCodes = new Set(found.map((p: any) => p.code));
  const missing = codes.filter((c) => !foundCodes.has(c));
  if (missing.length > 0) throw Errors.badRequest(`权限不存在：${missing.join(', ')}`);
  return found.map((p: any) => p.id);
}

// 校验仓库 id 均存在，返回合法 id 列表
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

// 全量覆盖写角色的仓库绑定（role_warehouses）
async function replaceRoleWarehouses(supabase: any, roleId: string, warehouseIds: string[]) {
  const { error: delErr } = await supabase.from('role_warehouses').delete().eq('role_id', roleId);
  if (delErr) throw delErr;
  if (warehouseIds.length > 0) {
    const rows = warehouseIds.map((warehouse_id) => ({ role_id: roleId, warehouse_id }));
    const { error: insErr } = await supabase.from('role_warehouses').insert(rows);
    if (insErr) throw insErr;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'user.read');
      const supabase = getAdminClient();
      const { data, error } = await supabase
        .from('roles')
        .select('*, role_permissions(permission_id, permissions(code)), role_warehouses(warehouse_id)')
        .order('name', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ data: (data || []).map(normalizeRole) });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'user.manage');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      // 名称唯一
      const { data: existing, error: exErr } = await supabase
        .from('roles')
        .select('id')
        .eq('name', body.name)
        .maybeSingle();
      if (exErr) throw exErr;
      if (existing) throw Errors.conflict('角色名称已存在');

      const permIds = await resolvePermissionIds(supabase, body.permissions || []);
      const whIds = await resolveWarehouseIds(supabase, body.warehouses || []);

      const { data: created, error: insErr } = await supabase
        .from('roles')
        .insert({ name: body.name, description: body.description ?? null })
        .select()
        .single();
      if (insErr) {
        if (insErr.code === '23505') throw Errors.conflict('角色名称已存在');
        throw insErr;
      }

      if (permIds.length > 0) {
        const rows = permIds.map((permission_id) => ({ role_id: created.id, permission_id }));
        const { error: rpErr } = await supabase.from('role_permissions').insert(rows);
        if (rpErr) throw rpErr;
      }
      if (whIds.length > 0) {
        await replaceRoleWarehouses(supabase, created.id, whIds);
      }

      const { data: full, error: fullErr } = await supabase
        .from('roles')
        .select('*, role_permissions(permission_id, permissions(code)), role_warehouses(warehouse_id)')
        .eq('id', created.id)
        .single();
      if (fullErr) throw fullErr;
      await writeAudit(ctx, req, 'create', 'role', created.id, null, full);
      return res.status(201).json({ data: normalizeRole(full) });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
