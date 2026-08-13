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
  const initialized = ref(false)
  let authListenerRegistered = false

  async function init() {
    if (initialized.value) return
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      session.value = data.session
      user.value = data.session?.user ?? null
      if (data.session) await loadProfile()
    } finally {
      initialized.value = true
    }

    if (!authListenerRegistered) {
      authListenerRegistered = true
      supabase.auth.onAuthStateChange((_event, nextSession) => {
        session.value = nextSession
        user.value = nextSession?.user ?? null
        if (!nextSession) {
          roles.value = []
          permissions.value = []
          return
        }
        // 避免在 Supabase auth 回调内部等待另一个 auth 调用。
        queueMicrotask(() => void loadProfile())
      })
    }
  }

  async function loadProfile() {
    roles.value = []
    permissions.value = []
    if (!user.value) return
    const { data } = await api.get('/me')
    roles.value = data.data?.roles ?? []
    permissions.value = data.data?.permissions ?? []
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
    return roles.value.includes('super_admin') || permissions.value.includes(perm)
  }

  return { session, user, roles, permissions, initialized, init, signIn, signOut, hasPermission }
})
