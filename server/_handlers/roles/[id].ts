import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

// 系统内置角色（种子数据创建），不可编辑/删除
const SYSTEM_ROLES = new Set(['super_admin', 'admin', 'manager', 'operator']);

const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(256).nullable().optional(),
  permissions: z.array(z.string().min(1).max(100)).optional(),
});

// 前后端字段归一：role_permissions -> 顶层 permissions:[code]，并标记 is_system
function normalizeRole(row: any) {
  const perms = (row.role_permissions || []).map((rp: any) => rp.permissions?.code).filter(Boolean);
  return {
    ...row,
    permissions: perms,
    is_system: SYSTEM_ROLES.has(row.name),
  };
}

async function fetchRole(supabase: any, id: string) {
  const { data, error } = await supabase
    .from('roles')
    .select('*, role_permissions(permission_id, permissions(code))')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') throw Errors.notFound('角色不存在');
    throw error;
  }
  return data;
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
      const before = await fetchRole(supabase, id);
      if (SYSTEM_ROLES.has(before.name)) throw Errors.badRequest('内置角色不可修改');

      // 名称唯一（排除自身）
      let newName = before.name;
      if (body.name !== undefined) {
        newName = body.name;
        const { data: dup, error: dupErr } = await supabase
          .from('roles')
          .select('id')
          .eq('name', newName)
          .neq('id', id)
          .maybeSingle();
        if (dupErr) throw dupErr;
        if (dup) throw Errors.conflict('角色名称已存在');
      }

      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.description !== undefined) patch.description = body.description ?? null;
      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await supabase.from('roles').update(patch).eq('id', id);
        if (upErr) {
          if (upErr.code === '23505') throw Errors.conflict('角色名称已存在');
          throw upErr;
        }
      }

      if (body.permissions !== undefined) {
        const permIds = await resolvePermissionIds(supabase, body.permissions);
        const { error: delErr } = await supabase.from('role_permissions').delete().eq('role_id', id);
        if (delErr) throw delErr;
        if (permIds.length > 0) {
          const rows = permIds.map((permission_id) => ({ role_id: id, permission_id }));
          const { error: insErr } = await supabase.from('role_permissions').insert(rows);
          if (insErr) throw insErr;
        }
      }

      const after = await fetchRole(supabase, id);
      await writeAudit(ctx, req, 'update', 'role', id, before, after);
      return res.status(200).json({ data: normalizeRole(after) });
    }

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'user.manage');
      const before = await fetchRole(supabase, id);
      if (SYSTEM_ROLES.has(before.name)) throw Errors.badRequest('内置角色不可删除');
      const { error: delErr } = await supabase.from('roles').delete().eq('id', id);
      if (delErr) throw delErr;
      await writeAudit(ctx, req, 'delete', 'role', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
