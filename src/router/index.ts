import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { supabase, supabaseStorageKey } from '@/services/supabase'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/Login.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/pages/Dashboard.vue')
      },
      {
        path: 'products',
        name: 'products',
        component: () => import('@/pages/Products.vue')
      },
      {
        path: 'inventory',
        name: 'inventory',
        component: () => import('@/pages/Inventory.vue')
      },
      {
        path: 'sales',
        name: 'sales',
        component: () => import('@/pages/Sales.vue')
      },
      {
        path: 'shipments',
        name: 'shipments',
        component: () => import('@/pages/Shipments.vue')
      },
      {
        path: 'transfers',
        name: 'transfers',
        component: () => import('@/pages/Transfers.vue')
      },
      {
        path: 'procurement',
        name: 'procurement',
        component: () => import('@/pages/Procurement.vue')
      },
      {
        path: 'after-sales',
        name: 'after-sales',
        component: () => import('@/pages/AfterSales.vue')
      },
      {
        path: 'replenishment',
        name: 'replenishment',
        component: () => import('@/pages/Replenishment.vue')
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/pages/Users.vue')
      },
      {
        path: 'logs',
        name: 'logs',
        component: () => import('@/pages/Logs.vue')
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/pages/Settings.vue')
      }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 快速判断 localStorage 中是否存在未过期的会话缓存（同步，避免每次导航都发网络请求）
function hasLocalSession(): boolean {
  try {
    const raw = localStorage.getItem(supabaseStorageKey)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (parsed?.expires_at && parsed.expires_at * 1000 < Date.now()) return false
    return true
  } catch {
    return false
  }
}

// 全局登录守卫：业务路由必须登录后才能访问
router.beforeEach(async (to) => {
  const isPublic = to.meta.public === true || to.path === '/login'
  if (isPublic) {
    // 已登录用户访问登录页 → 直接回首页
    if (hasLocalSession()) {
      const { data } = await supabase.auth.getSession()
      if (data.session) return '/dashboard'
    }
    return true
  }

  // 非公开路由：必须有有效 session
  if (hasLocalSession()) {
    const { data } = await supabase.auth.getSession()
    if (data.session) return true
    // 本地有缓存但 getSession 为空 → 尝试用 refresh_token 恢复
    const { data: refreshed } = await supabase.auth.refreshSession()
    if (refreshed.session) return true
  }
  // 未登录 / 会话失效：一律回登录页
  return '/login'
})

export default router
