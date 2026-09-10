import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, supabaseStorageKey } from '@/services/supabase'
import { api } from '@/services/api'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const user = ref<User | null>(null)
  const roles = ref<string[]>([])
  const permissions = ref<string[]>([])
  // 可见仓库范围：null = 不受限（super_admin 全量）；string[] = 角色绑定仓库并集
  const warehouseIds = ref<string[] | null>(null)
  const profile = ref<any>(null)
  // init 幂等锁：路由守卫与 MainLayout 可能并发触发，避免重复调 /auth/me
  let initInFlight: Promise<void> | null = null
  async function init() {
    if (initInFlight) return initInFlight
    initInFlight = doInit().finally(() => {
      initInFlight = null
    })
    return initInFlight
  }
  async function doInit() {
    console.log('[auth:init] 开始, ts=' + new Date().toISOString())
    // 诊断：init 前 localStorage 中 session 键是否存在
    let rawSession = null
    try { rawSession = localStorage.getItem(supabaseStorageKey) } catch (e) { console.warn('[auth:init] 读取localStorage异常:', e) }
    console.log('[auth:init] localStorage键[' + supabaseStorageKey + ']:', rawSession ? '存在,长度=' + rawSession.length : '不存在')
    if (rawSession) {
      try {
        const parsed = JSON.parse(rawSession)
        console.log('[auth:init] 存储session概要: expires_at=' + parsed?.expires_at + ' now=' + Math.floor(Date.now()/1000) + ' 是否过期=' + (parsed?.expires_at ? (parsed.expires_at < Date.now()/1000 ? '是' : '否') : '未知(无expires_at)'))
      } catch (e) { console.warn('[auth:init] 解析存储session失败:', e) }
    }
    let { data } = await supabase.auth.getSession()
    console.log('[auth:init] getSession 结果:', data.session ? '有session' : 'session为空')
    if (!data.session) {
      console.log('[auth:init] 尝试 refreshSession...')
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
      if (refreshErr) {
        console.error('[auth:init] refreshSession 失败:', refreshErr?.message || refreshErr)
      } else {
        data = refreshed
        console.log('[auth:init] refreshSession 成功:', refreshed.session ? '有session' : '仍为空')
      }
    }
    session.value = data.session
    user.value = data.session?.user ?? null
    console.log('[auth:init] user 赋值结果:', user.value ? 'user有值(' + (user.value.email || 'no-email') + ')' : 'user为null')
    if (data.session) {
      await loadProfile()
    } else {
      console.warn('[auth:init] 无session，跳过 loadProfile')
    }
  }

  async function loadProfile() {
    if (!user.value) {
      console.warn('[auth:loadProfile] user为null，提前返回')
      return
    }
    try {
      // 确保 access_token 有效：getUser() 会校验当前会话 token，过期则自动刷新
      console.log('[auth:loadProfile] 开始, ts=' + new Date().toISOString())
      const { data: fresh } = await supabase.auth.getUser()
      console.log('[auth:loadProfile] getUser 结果:', fresh.user ? 'user有效' : 'user无效(将refreshSession)')
      if (!fresh.user) {
        const { error: refreshErr } = await supabase.auth.refreshSession()
        if (refreshErr) console.warn('[auth] refreshSession 失败:', refreshErr)
        else console.log('[auth:loadProfile] refreshSession 成功')
      }
      console.log('[auth:loadProfile] 请求 /auth/me ...')
      const { data } = await api.get('/auth/me')
      roles.value = data.roles ?? []
      permissions.value = data.permissions ?? []
      warehouseIds.value = data.warehouseIds !== undefined ? data.warehouseIds : null
      profile.value = data.profile ?? null
      console.log('[auth:loadProfile] /auth/me 返回: roles=' + (data.roles ?? []).length + ' perms=' + (data.permissions ?? []).length)
      user.value = { ...user.value, email: data.user?.email, user_metadata: { ...(user.value?.user_metadata ?? {}), name: data.user?.name, avatar: data.user?.avatar } }
    } catch (e: any) {
      console.error('[auth] loadProfile 失败:', e)
      try {
        const { ElMessage } = await import('element-plus')
        ElMessage.error('权限加载失败: ' + (e?.response?.data?.error?.message || e?.message || '未知错误，请重新登录'))
      } catch { /* ignore */ }
    }
  }

  async function signIn(email: string, password: string, captchaToken = '') {
    // 登录走服务端代理：Turnstile 人机验证、限流、失败锁定均在服务端执行
    const { data } = await api.post('/auth/login', { email, password, captchaToken })
    if (!data.session) throw new Error('登录失败：未返回会话')
    const { error: setErr } = await supabase.auth.setSession(data.session)
    if (setErr) throw setErr
    session.value = data.session
    user.value = data.session?.user ?? null
    roles.value = data.roles ?? []
    permissions.value = data.permissions ?? []
    warehouseIds.value = data.warehouseIds !== undefined ? data.warehouseIds : null
    profile.value = data.profile ?? null
    user.value = { ...(user.value ?? {}), email: data.user?.email, user_metadata: { ...(user.value?.user_metadata ?? {}), name: data.user?.name, avatar: data.user?.avatar } } as any
  }

  async function signOut() {
    // 1. 同步清除本地会话缓存与内存状态（不依赖网络，立即退出登录态）。
    //    原先先 await supabase.auth.signOut()：其内部会向服务端发起 /logout 网络请求，
    //    网络慢/断开时 Promise 长时间 pending，导致调用方（如空闲自动退出）后续跳转登录页永不执行。
    try {
      localStorage.removeItem(supabaseStorageKey)
    } catch {
      /* ignore */
    }
    session.value = null
    user.value = null
    roles.value = []
    permissions.value = []
    warehouseIds.value = null
    profile.value = null
    // 2. 通知 Supabase 服务端销毁会话（fire-and-forget，失败不影响本地登出与页面跳转）
    supabase.auth.signOut().catch(() => {
      /* ignore */
    })
    // 3. 退出时清理本地业务日志，避免敏感信息残留在浏览器
    try {
      const { clearLogs } = await import('@/utils/log')
      clearLogs()
    } catch {
      /* ignore */
    }
  }

  function hasPermission(perm: string): boolean {
    return permissions.value.includes(perm)
  }

  // 是否不受仓库范围限制（super_admin / warehouseIds 为 null 时全量可见）
  function hasFullWarehouseAccess(): boolean {
    return warehouseIds.value === null
  }

  // 个人中心保存后同步本地用户信息（姓名/头像），右上角即时生效
  function applyProfile(p: { name?: string; avatar?: string | null }) {
    const meta = { ...(user.value?.user_metadata ?? {}) }
    if (p.name !== undefined) meta.name = p.name
    if (p.avatar !== undefined) meta.avatar = p.avatar || ''
    if (user.value) {
      user.value = { ...user.value, user_metadata: meta }
    }
    if (profile.value) {
      if (p.name !== undefined) profile.value.display_name = p.name
      if (p.avatar !== undefined) profile.value.avatar_url = p.avatar || null
    }
  }

  return { session, user, roles, permissions, warehouseIds, profile, init, signIn, signOut, hasPermission, hasFullWarehouseAccess, applyProfile }
})
