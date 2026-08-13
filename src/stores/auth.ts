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
    const uid = user.value.id
    roles.value = []
    permissions.value = []

    // 1. 用户角色：user_roles -> roles
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role_id, roles(name)')
      .eq('user_id', uid)

    const roleRows = (userRoles ?? []) as any[]
    const roleIds = roleRows.map(r => r.role_id).filter(Boolean) as string[]
    roles.value = roleRows.map(r => r.roles?.name).filter(Boolean) as string[]

    // 2. 角色权限：role_permissions -> permissions
    if (roleIds.length) {
      const { data: rolePerms } = await supabase
        .from('role_permissions')
        .select('permissions(code)')
        .in('role_id', roleIds)
      const codes = ((rolePerms ?? []) as any[]).map(r => r.permissions?.code).filter(Boolean) as string[]
      permissions.value = Array.from(new Set(codes))
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
