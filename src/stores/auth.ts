import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'

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
    const { data } = await supabase
      .from('profiles')
      .select('roles(roles(name)), user_roles(roles(role_permissions(permissions(name))))')
      .eq('id', user.value.id)
      .single()
    if (data) {
      roles.value = []
      permissions.value = []
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
