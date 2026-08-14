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

  async function init() {
    const { data } = await supabase.auth.getSession()
    session.value = data.session
    user.value = data.session?.user ?? null
    if (data.session) {
      await loadProfile()
    }
  }

  async function loadProfile() {
    if (!user.value) return
    try {
      // 确保 access_token 有效：getUser() 会校验当前会话 token，过期则自动刷新
      const { data: fresh } = await supabase.auth.getUser()
      if (!fresh.user) {
        const { error: refreshErr } = await supabase.auth.refreshSession()
        if (refreshErr) console.warn('[auth] refreshSession 失败:', refreshErr)
      }
      const { data } = await api.get('/auth/me')
      roles.value = data.roles ?? []
      permissions.value = data.permissions ?? []
      user.value = { ...user.value, email: data.user?.email, user_metadata: { ...(user.value?.user_metadata ?? {}), name: data.user?.name } }
    } catch (e: any) {
      console.error('[auth] loadProfile 失败:', e)
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

  return { session, user, roles, permissions, init, signIn, signOut, hasPermission }
})
