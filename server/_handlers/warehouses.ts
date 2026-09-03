import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, applyWarehouseFilter } from './_lib/rbac';
import { parse } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError, Errors } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const createSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  address: z.string().max(300).nullable().optional(),
  wh_type: z.enum(['domestic', 'overseas']).optional().default('domestic'),
  warehouse_kind: z.enum(['head', 'sub', 'overseas']).optional(),
  store: z.string().max(100).nullable().optional(),
});

// warehouse_kind 与 wh_type 双向同步：head/sub -> domestic；overseas -> overseas
function deriveWhType(kind: string): 'domestic' | 'overseas' {
  return kind === 'overseas' ? 'overseas' : 'domestic';
}
function deriveKind(whType: string | undefined): 'head' | 'sub' | 'overseas' {
  return whType === 'overseas' ? 'overseas' : 'sub';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);

    if (req.method === 'GET') {
      requirePermission(ctx, 'inventory.read');
      const supabase = getAdminClient();
      // 仓库级隔离：普通账号仅能查看其角色绑定仓库；super_admin 看全部
      const q = supabase.from('warehouses').select('*').order('created_at', { ascending: true });
      const { data, error } = await applyWarehouseFilter(q, ctx, 'id');
      if (error) throw error;
      return res.status(200).json({ data: data || [] });
    }

    if (req.method === 'POST') {
      requirePermission(ctx, 'inventory.write');
      const body = parse(createSchema, req.body || {});
      // 两列同步：传 kind 则推导 wh_type；未传 kind 则由 wh_type 推导 kind（默认 domestic -> sub）
      const kind: 'head' | 'sub' | 'overseas' = body.warehouse_kind ?? deriveKind(body.wh_type);
      const whType = deriveWhType(kind);
      const supabase = getAdminClient();
      const { data, error } = await supabase
        .from('warehouses')
        .insert({
          code: body.code,
          name: body.name,
          address: body.address ?? null,
          wh_type: whType,
          warehouse_kind: kind,
          store: typeof body.store === 'string' ? (body.store.trim() || null) : (body.store ?? null),
        })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') throw Errors.conflict(`仓库编码已存在：${body.code}`);
        throw error;
      }
      await writeAudit(ctx, req, 'create', 'warehouse', data.id, null, data);
      return res.status(201).json({ data });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
