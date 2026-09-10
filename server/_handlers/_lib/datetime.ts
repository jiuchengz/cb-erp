// 服务端日期工具：按系统默认时区（system_settings.default_timezone）折算"业务日期"。
// 口径与前端 src/utils/system.ts 的 cachedTz 保持一致（读取失败时回落同一默认时区）。
const FALLBACK_TZ = 'America/Mexico_City';

// 读取系统默认时区（system_settings.value 形如 { tz, label, country }；兼容纯字符串）
export async function getSystemTimezone(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'default_timezone')
      .maybeSingle();
    const v: any = data?.value;
    const tz = typeof v === 'string' ? v : v?.tz;
    if (typeof tz === 'string' && tz) return tz;
  } catch (e) {
    console.error('[datetime] 读取系统默认时区失败，回落默认时区:', e);
  }
  return FALLBACK_TZ;
}

// 把 timestamptz / ISO 字符串折算为指定时区的 YYYY-MM-DD；无法解析时回落 UTC 日期部分。
export function datePartInTz(value: unknown, tz: string): string | null {
  if (!value) return null;
  const iso = String(value);
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10) || null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return iso.slice(0, 10) || null;
  }
}
