import type { Router } from 'vue-router'
import { supabase } from '@/services/supabase'

// 访问记录采集（前端）：路由切换后上报一次页面访问，含登录页。
// 硬性约束：fire-and-forget，任何失败都不得影响主流程（不 await 页面、不弹提示）。
// 去重：同一标签页对同一路径 60s 内只上报一次；服务端再按「同访客 ID + 同路径」60s 去重（无访客 ID 时回退按 IP）。

const RECENT_KEY = 'cb_visit_recent'
const VISITOR_KEY = 'cb_visitor_id'
const CLIENT_DEDUP_MS = 60_000
const ENDPOINT = '/api/visit'

// 生成随机 UUID（优先 crypto.randomUUID，降级 getRandomValues，再降级时间戳+随机串）
function genUuid(): string {
  try {
    const c: any = typeof crypto !== 'undefined' ? crypto : undefined
    if (c && typeof c.randomUUID === 'function') return String(c.randomUUID())
    if (c && typeof c.getRandomValues === 'function') {
      const b = new Uint8Array(16)
      c.getRandomValues(b)
      b[6] = (b[6] & 0x0f) | 0x40
      b[8] = (b[8] & 0x3f) | 0x80
      const h = Array.from(b, (x: number) => x.toString(16).padStart(2, '0'))
      return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`
    }
  } catch {
    /* 降级 */
  }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// 匿名访客标识：localStorage 持久化的随机 UUID。
// 不含邮箱 / 手机号 / 设备指纹等任何个人信息，仅用于区分「同一浏览器访客」；清除浏览器数据即重置。
export function getVisitorId(): string {
  try {
    const v = localStorage.getItem(VISITOR_KEY)
    if (v && /^[0-9a-zA-Z-]{6,64}$/.test(v)) return v
    const nv = genUuid()
    localStorage.setItem(VISITOR_KEY, nv)
    return nv
  } catch {
    return ''
  }
}

// 列表展示用短值（缺失返回空串，由调用方显示 "-"）
export function visitorShort(v: string | null | undefined): string {
  const s = String(v || '').trim()
  return s ? s.slice(0, 8) : ''
}

// 路径 -> 中文页面名（仅用于展示；未知路径回退展示原始路径）
const PAGE_LABELS: Record<string, string> = {
  '/login': '登录页',
  '/dashboard': '仪表盘',
  '/analysis': '经营分析',
  '/tools-page': '工具箱',
  '/products': '商品管理',
  '/product-total': '商品总表',
  '/inventory': '库存查询',
  '/stocktakes': '库存盘点',
  '/cost-profit': '成本利润',
  '/sales': '销售管理',
  '/shipments': '发货管理',
  '/transfers': '调拨管理',
  '/procurement': '采购管理',
  '/after-sales': '售后管理',
  '/replenishment': '补货管理',
  '/users': '成员管理',
  '/logs': '操作日志',
  '/settings': '系统设置',
  '/profile': '个人中心',
  '/recycle-bin': '回收站',
}

const LABEL_KEYS = Object.keys(PAGE_LABELS).sort((a, b) => b.length - a.length)

export function pageLabel(path: string): string {
  const p = (path || '').split('?')[0].split('#')[0] || '/'
  if (PAGE_LABELS[p]) return PAGE_LABELS[p]
  for (const key of LABEL_KEYS) {
    if (p === key || p.startsWith(key + '/')) return PAGE_LABELS[key]
  }
  return p
}

export function locationText(row: { country?: string; region?: string; city?: string; isp?: string } | null | undefined): string {
  if (!row) return '未知'
  const place = [row.country, row.region, row.city].map((v) => String(v || '').trim()).filter(Boolean)
  const parts: string[] = []
  if (place.length) parts.push(Array.from(new Set(place)).join(' · '))
  if (row.isp && String(row.isp).trim()) parts.push(String(row.isp).trim())
  return parts.length ? parts.join(' | ') : '未知'
}

function readRecent(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function shouldSkip(path: string): boolean {
  const map = readRecent()
  const last = Number(map[path] || 0)
  return !!last && Date.now() - last < CLIENT_DEDUP_MS
}

function markSent(path: string) {
  try {
    const map = readRecent()
    const cutoff = Date.now() - CLIENT_DEDUP_MS
    const cleaned: Record<string, number> = {}
    for (const [k, v] of Object.entries(map)) {
      if (Number(v) > cutoff) cleaned[k] = Number(v)
    }
    cleaned[path] = Date.now()
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(cleaned))
  } catch {
    /* 忽略存储异常 */
  }
}

async function report(path: string) {
  try {
    if (!path) return
    if (shouldSkip(path)) return
    markSent(path)

    let token = ''
    try {
      const { data } = await supabase.auth.getSession()
      token = data.session?.access_token || ''
    } catch {
      /* 无会话：按访客上报 */
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path,
        referer: typeof document !== 'undefined' ? document.referrer || '' : '',
        visitor_id: getVisitorId(),
      }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    /* 采集失败不影响主流程 */
  }
}

// 安装路由采集：每次导航完成后上报（含首次进入的登录页）
export function installVisitTracker(router: Router) {
  router.afterEach((to) => {
    void report(to.path)
  })
}
