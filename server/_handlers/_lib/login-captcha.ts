import type { SupabaseClient } from '@supabase/supabase-js';

// 登录机器人验证（Cloudflare Turnstile）开关：
//   1) 默认开启（enabled = true）：登录页渲染并校验 Turnstile；
//   2) 关闭后最长维持 24 小时（disabled_until = 关闭时刻 + 24h）；
//   3) 「到期自动恢复」不依赖定时任务：任何一次读取发现已到期（或到期时间缺失/非法、
//      超出 24 小时上限）都会自动视为「开启」并把结果回写，保证状态自愈；
//   4) 关闭期间超级管理员可随时手动恢复开启；
//   5) 读写统一走服务端 service_role（绕过 RLS），仅 super_admin 可通过 API 操作。
export const MAX_DISABLE_MS = 24 * 60 * 60 * 1000;

const TABLE = 'login_captcha_toggle';

export interface LoginCaptchaState {
  /** true = 登录需要人机验证（默认）；false = 授权窗口内免验证 */
  enabled: boolean;
  /** 关闭状态的自动恢复时间点（ISO 字符串）；开启时为 null */
  disabledUntil: string | null;
}

// 读取开关状态（含到期自愈回写）。
// 表/行缺失（065 迁移尚未执行）时按「默认开启」处理，不阻断登录。
export async function readLoginCaptchaState(supabase: SupabaseClient): Promise<LoginCaptchaState> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('enabled, disabled_until')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;

  if (!data || data.enabled !== false) {
    return { enabled: true, disabledUntil: null };
  }

  const now = Date.now();
  const untilMs = data.disabled_until ? Date.parse(String(data.disabled_until)) : NaN;
  const maxUntilMs = now + MAX_DISABLE_MS;

  // 已到期 / 到期时间缺失或非法 / 超 24 小时上限 → 一律「视为开启并回写」
  if (!Number.isFinite(untilMs) || untilMs <= now || untilMs > maxUntilMs) {
    const next: LoginCaptchaState =
      Number.isFinite(untilMs) && untilMs > maxUntilMs
        ? { enabled: false, disabledUntil: new Date(maxUntilMs).toISOString() }
        : { enabled: true, disabledUntil: null };
    await writeLoginCaptchaState(supabase, next.enabled, next.disabledUntil, null);
    return next;
  }

  return { enabled: false, disabledUntil: new Date(untilMs).toISOString() };
}

// 写入开关状态（单行表，id 恒为 1）。
export async function writeLoginCaptchaState(
  supabase: SupabaseClient,
  enabled: boolean,
  disabledUntil: string | null,
  updatedBy: string | null,
): Promise<LoginCaptchaState> {
  const disabled = enabled ? null : disabledUntil;
  const { error } = await supabase.from(TABLE).upsert(
    {
      id: 1,
      enabled,
      disabled_until: disabled,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
  return { enabled, disabledUntil: disabled };
}

// 登录 handler 专用：任何异常一律按「开启」处理（默认安全，宁可多校验一次）。
export async function isLoginCaptchaEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    return (await readLoginCaptchaState(supabase)).enabled;
  } catch (e) {
    console.warn('[login-captcha] 读取开关失败，按开启处理:', (e as Error)?.message || e);
    return true;
  }
}
