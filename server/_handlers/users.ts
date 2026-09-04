import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';
import { normalizeUserRoles } from './users/[id]';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(6).max(72),
  role_ids: z.array(z.string().uuid()).optional(),
  // 用户直接绑定的可见仓库 id（仓库级行级隔离：用户维度）
  warehouse_ids: z.array(z.string().uuid()).optional(),
});

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

    if (req.method === 'POST') {
      requirePermission(ctx, 'user.manage');
      const body = parse(createSchema, req.body || {});
      const supabase = getAdminClient();

      // 1) Auth 层创建用户（service_role）
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
      });
      if (authErr) {
        if (authErr.status === 409 || /already.*registered/i.test(authErr.message || '')) {
          throw Errors.conflict('该邮箱已被注册');
        }
        throw authErr;
      }
      const newId = authData.user?.id;
      if (!newId) throw new Error('创建 Auth 用户失败');

      // 2) profiles upsert（profiles 主键即 auth.users.id，upsert 保证幂等）
      const { error: profileErr } = await supabase
        .from('profiles')
        .upsert({ id: newId, email: body.email, display_name: body.name, is_active: true });
      if (profileErr) throw profileErr;

      // 3) 角色分配
      if (body.role_ids && body.role_ids.length > 0) {
        const rows = body.role_ids.map((role_id) => ({ user_id: newId, role_id }));
        const { error: roleErr } = await supabase.from('user_roles').insert(rows);
        if (roleErr) throw roleErr;
      }

      // 4) 仓库绑定
      if (body.warehouse_ids !== undefined && body.warehouse_ids.length > 0) {
        const whIds = await resolveWarehouseIds(supabase, body.warehouse_ids);
        await replaceUserWarehouses(supabase, newId, whIds);
      }

      const after = await getProfileWithRoles(supabase, newId);
      await writeAudit(ctx, req, 'create', 'user', newId, null, after);
      return res.status(201).json({ data: after });
    }

    if (req.method === 'GET') {
      requirePermission(ctx, 'system.users');
      const q = parse(paginationSchema, req.query);
      const supabase = getAdminClient();
      let query: any = supabase
        .from('profiles')
        .select('*, user_roles(role_id, roles(id, name)), user_warehouses(warehouse_id)', { count: 'exact' });
      const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
      if (email) query = query.ilike('email', `%${email}%`);
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return res.status(200).json({ data: (data || []).map(normalizeUserRoles), total: count ?? 0, page: q.page, pageSize: q.pageSize });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
