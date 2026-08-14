import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'
import { api } from '@/services/api'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const user = ref<User | null>(null)
  const roles = ref<string[]>([])
  const permissions = ref<string[]>([])
  const debug = ref('init...')

  async function init() {
    console.log('[auth:init] 开始, ts=' + new Date().toISOString())
    debug.value = 'getSession...'
    let { data } = await supabase.auth.getSession()
    console.log('[auth:init] getSession 结果:', data.session ? '有session' : 'session为空')
    if (!data.session) {
      debug.value = 'session为空，尝试refreshSession'
      console.log('[auth:init] 尝试 refreshSession...')
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
      if (refreshErr) {
        console.error('[auth:init] refreshSession 失败:', refreshErr?.message || refreshErr)
        debug.value = 'session为空; refreshSession失败: ' + (refreshErr?.message || String(refreshErr))
      } else {
        data = refreshed
        debug.value = 'refreshSession成功'
        console.log('[auth:init] refreshSession 成功:', refreshed.session ? '有session' : '仍为空')
      }
    } else {
      debug.value = 'getSession有session'
    }
    session.value = data.session
    user.value = data.session?.user ?? null
    console.log('[auth:init] user 赋值结果:', user.value ? 'user有值(' + (user.value.email || 'no-email') + ')' : 'user为null')
    debug.value += user.value ? '; user有值(' + (user.value.email || 'no-email') + ')' : '; user为null'
    if (data.session) {
      await loadProfile()
    } else {
      debug.value += '; 无session跳过loadProfile'
      console.warn('[auth:init] 无session，跳过 loadProfile')
    }
  }

  async function loadProfile() {
    if (!user.value) {
      debug.value += '; loadProfile提前返回(user null)'
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
      debug.value += '; getUser ok'
      console.log('[auth:loadProfile] 请求 /auth/me ...')
      const { data } = await api.get('/auth/me')
      roles.value = data.roles ?? []
      permissions.value = data.permissions ?? []
      console.log('[auth:loadProfile] /auth/me 返回: roles=' + (data.roles ?? []).length + ' perms=' + (data.permissions ?? []).length)
      debug.value += '; /auth/me ok roles=' + (data.roles ?? []).length + ' perms=' + (data.permissions ?? []).length
      user.value = { ...user.value, email: data.user?.email, user_metadata: { ...(user.value?.user_metadata ?? {}), name: data.user?.name } }
    } catch (e: any) {
      console.error('[auth] loadProfile 失败:', e)
      debug.value += '; loadProfile异常: ' + (e?.response?.data?.error?.message || e?.message || String(e))
      try {
        const { ElMessage } = await import('element-plus')
        ElMessage.error('权限加载失败: ' + (e?.response?.data?.error?.message || e?.message || '未知错误，请重新登录'))
      } catch { /* ignore */ }
    }
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    session.value = data.session
    user.value = data.user
    await loadProfile()
  }

  async function signOut() {
    await supabase.auth.signOut()
    session.value = null
    user.value = null
    roles.value = []
    permissions.value = []
  }

  function hasPermission(perm: string): boolean {
    return permissions.value.includes(perm)
  }

  return { session, user, roles, permissions, debug, init, signIn, signOut, hasPermission }
})
