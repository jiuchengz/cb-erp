import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { requirePermission } from '../_lib/rbac';
import { parse, uuidSchema } from '../_lib/validation';
import { getAdminClient } from '../_lib/db';
import { writeAudit } from '../_lib/audit';
import { handleError, Errors } from '../_lib/error';
import { rateLimit } from '../_lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const id = parse(uuidSchema, req.query.id);
    const supabase = getAdminClient();

    if (req.method === 'DELETE') {
      requirePermission(ctx, 'inventory.write');
      const { data: before, error: getErr } = await supabase.from('inventory').select('*').eq('id', id).single();
      if (getErr) {
        if (getErr.code === 'PGRST116') throw Errors.notFound('库存记录不存在');
        throw getErr;
      }
      if ((before.quantity || 0) !== 0 || (before.reserved_quantity || 0) !== 0) {
        throw Errors.conflict('仅允许删除数量为 0 的库存记录');
      }
      const { error } = await supabase.from('inventory').delete().eq('id', id);
      if (error) throw error;
      await writeAudit(ctx, req, 'delete', 'inventory', id, before, null);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
