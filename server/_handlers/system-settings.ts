import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission } from './_lib/rbac';
import { parse } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

const TIMEZONES = [
  { tz: 'America/Mexico_City', label: '墨西哥城 (UTC-6)', country: '墨西哥' },
  { tz: 'America/New_York', label: '纽约 (UTC-5)', country: '美国' },
  { tz: 'America/Los_Angeles', label: '洛杉矶 (UTC-8)', country: '美国' },
  { tz: 'America/Sao_Paulo', label: '圣保罗 (UTC-3)', country: '巴西' },
  { tz: 'Europe/London', label: '伦敦 (UTC+0)', country: '英国' },
  { tz: 'Europe/Paris', label: '巴黎 (UTC+1)', country: '法国' },
  { tz: 'Europe/Berlin', label: '柏林 (UTC+1)', country: '德国' },
  { tz: 'Europe/Madrid', label: '马德里 (UTC+1)', country: '西班牙' },
  { tz: 'Asia/Shanghai', label: '北京/上海 (UTC+8)', country: '中国' },
  { tz: 'Asia/Hong_Kong', label: '香港 (UTC+8)', country: '中国香港' },
  { tz: 'Asia/Tokyo', label: '东京 (UTC+9)', country: '日本' },
  { tz: 'Asia/Seoul', label: '首尔 (UTC+9)', country: '韩国' },
  { tz: 'Asia/Singapore', label: '新加坡 (UTC+8)', country: '新加坡' },
  { tz: 'Asia/Dubai', label: '迪拜 (UTC+4)', country: '阿联酋' },
  { tz: 'Asia/Bangkok', label: '曼谷 (UTC+7)', country: '泰国' },
  { tz: 'Australia/Sydney', label: '悉尼 (UTC+10)', country: '澳大利亚' },
  { tz: 'America/Santiago', label: '圣地亚哥 (UTC-4)', country: '智利' },
  { tz: 'America/Bogota', label: '波哥大 (UTC-5)', country: '哥伦比亚' },
  { tz: 'America/Lima', label: '利马 (UTC-5)', country: '秘鲁' },
  { tz: 'America/Argentina/Buenos_Aires', label: '布宜诺斯艾利斯 (UTC-3)', country: '阿根廷' },
];

const CURRENCIES = [
  { code: 'MXN', symbol: 'MX$', name: '墨西哥比索' },
  { code: 'USD', symbol: '$', name: '美元' },
  { code: 'CNY', symbol: '¥', name: '人民币' },
  { code: 'EUR', symbol: '€', name: '欧元' },
  { code: 'GBP', symbol: '£', name: '英镑' },
  { code: 'JPY', symbol: '¥', name: '日元' },
  { code: 'BRL', symbol: 'R$', name: '巴西雷亚尔' },
  { code: 'CAD', symbol: 'C$', name: '加元' },
  { code: 'AUD', symbol: 'A$', name: '澳元' },
  { code: 'COP', symbol: 'COL$', name: '哥伦比亚比索' },
  { code: 'CLP', symbol: 'CLP$', name: '智利比索' },
  { code: 'ARS', symbol: 'AR$', name: '阿根廷比索' },
  { code: 'PEN', symbol: 'S/', name: '秘鲁索尔' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'system.manage');
      const { data, error } = await supabase.from('system_settings').select('*');
      if (error) throw error;
      const map: Record<string, any> = {};
      (data || []).forEach((row: any) => {
        map[row.key] = row.value;
      });
      return res.status(200).json({
        data: {
          timezones: TIMEZONES,
          currencies: CURRENCIES,
          settings: map,
        },
      });
    }

    if (req.method === 'PUT') {
      requirePermission(ctx, 'system.manage');
      const schema = z.object({
        default_timezone: z.string().min(1).max(64).optional(),
        default_currency: z.string().min(1).max(8).optional(),
        soft_delete_enabled: z.boolean().optional(),
      });
      const body = parse(schema, req.body || {});
      const userId = ctx.userId || null;
      const writes: Promise<unknown>[] = [];
      if (body.default_timezone !== undefined) {
        const tz = TIMEZONES.find((t) => t.tz === body.default_timezone);
        if (!tz) throw new Error('Unsupported timezone: ' + body.default_timezone);
        writes.push(
          supabase.from('system_settings').upsert({
            key: 'default_timezone',
            value: tz,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          })
        );
      }
      if (body.default_currency !== undefined) {
        const cur = CURRENCIES.find((c) => c.code === body.default_currency);
        if (!cur) throw new Error('Unsupported currency: ' + body.default_currency);
        writes.push(
          supabase.from('system_settings').upsert({
            key: 'default_currency',
            value: cur,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          })
        );
      }
      if (body.soft_delete_enabled !== undefined) {
        writes.push(
          supabase.from('system_settings').upsert({
            key: 'soft_delete_enabled',
            value: { enabled: body.soft_delete_enabled },
            updated_at: new Date().toISOString(),
            updated_by: userId,
          })
        );
      }
      await Promise.all(writes);
      await writeAudit(ctx, req, 'update', 'system_settings', null, null, { ...body });
      const { data, error } = await supabase.from('system_settings').select('*');
      if (error) throw error;
      const map: Record<string, any> = {};
      (data || []).forEach((row: any) => {
        map[row.key] = row.value;
      });
      return res.status(200).json({ data: { timezones: TIMEZONES, currencies: CURRENCIES, settings: map } });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
