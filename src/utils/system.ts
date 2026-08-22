// 全局时区/币种工具：按系统默认设置统一格式化时间与货币
export interface TimezoneOption {
  tz: string
  label: string
  country: string
}

export interface CurrencyOption {
  code: string
  symbol: string
  name: string
}

export const DEFAULT_TIMEZONES: TimezoneOption[] = [
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
]

export const DEFAULT_CURRENCIES: CurrencyOption[] = [
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
]

// 系统设置缓存（前端会话级）
let cachedTz = 'America/Mexico_City'
let cachedCurrency = 'MXN'
let cachedCurrencySymbol = 'MX$'

export function setSystemSettings(tz: string, currencyCode: string, symbol: string) {
  cachedTz = tz || cachedTz
  cachedCurrency = currencyCode || cachedCurrency
  cachedCurrencySymbol = symbol || cachedCurrencySymbol
}

export function getSystemTz(): string {
  return cachedTz
}

export function getCurrencyCode(): string {
  return cachedCurrency
}

export function getCurrencySymbol(): string {
  return cachedCurrencySymbol
}

/**
 * 将 ISO 时间戳按系统默认时区格式化为完整时间
 */
export function formatDateTime(v: string | number | Date | null | undefined): string {
  if (!v) return ''
  try {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return String(v)
    return d.toLocaleString('zh-CN', { timeZone: cachedTz, hour12: false })
  } catch {
    return String(v)
  }
}

/**
 * 按系统默认时区格式化日期（yyyy-MM-dd）
 */
export function formatDateOnly(v: string | number | Date | null | undefined): string {
  if (!v) return ''
  try {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return String(v)
    const p = (n: number) => String(n).padStart(2, '0')
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: cachedTz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
    const map: Record<string, string> = {}
    parts.forEach((x) => (map[x.type] = x.value))
    return `${map.year}-${map.month}-${map.day}`
  } catch {
    return String(v)
  }
}

/**
 * 获取系统默认时区下的"今天"字符串（yyyy-MM-dd）
 */
export function todayStrInTz(): string {
  return formatDateOnly(new Date())
}

/**
 * 格式化金额：按系统默认币种符号
 */
export function formatMoney(v: number | string | null | undefined, digits = 2): string {
  const n = Number(v ?? 0)
  if (Number.isNaN(n)) return getCurrencySymbol() + '0.00'
  return getCurrencySymbol() + n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * 将 yyyy-MM-dd 字符串在当前时区解释为当天 UTC 起始（用于查询范围）
 */
export function dateStrToUtc(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toISOString()
}
