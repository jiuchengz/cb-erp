import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { supabase, supabaseStorageKey } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth'

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
        path: 'analysis',
        name: 'analysis',
        component: () => import('@/pages/Analysis.vue'),
        meta: { requiresPerm: ['products.read', 'inventory.read', 'sales.read', 'shipment.read', 'procurement.read', 'transfer.read', 'after_sales.read'] }
      },
      {
        path: 'tools-page',
        name: 'tools',
        component: () => import('@/pages/Tools.vue')
      },
      {
        path: 'products',
        name: 'products',
        component: () => import('@/pages/Products.vue'),
        meta: { requiresPerm: ['products.read'] }
      },
      {
        path: 'product-total',
        name: 'product-total',
        component: () => import('@/pages/ProductTotal.vue'),
        meta: { requiresPerm: ['product_total.read'] }
      },
      {
        path: 'inventory',
        name: 'inventory',
        component: () => import('@/pages/Inventory.vue'),
        meta: { requiresPerm: ['inventory.read'] }
      },
      {
        path: 'stocktakes',
        name: 'stocktakes',
        component: () => import('@/pages/Stocktake.vue'),
        meta: { requiresPerm: ['stocktake.read'] }
      },
      {
        path: 'cost-profit',
        name: 'cost-profit',
        component: () => import('@/pages/CostProfit.vue'),
        meta: { requiresPerm: ['cost_profit.read'] }
      },
      {
        path: 'sales',
        name: 'sales',
        component: () => import('@/pages/Sales.vue'),
        meta: { requiresPerm: ['sales.read'] }
      },
      {
        path: 'shipments',
        name: 'shipments',
        component: () => import('@/pages/Shipments.vue'),
        meta: { requiresPerm: ['shipment.read'] }
      },
      {
        path: 'transfers',
        name: 'transfers',
        component: () => import('@/pages/Transfers.vue'),
        meta: { requiresPerm: ['transfer.read'] }
      },
      {
        path: 'procurement',
        name: 'procurement',
        component: () => import('@/pages/Procurement.vue'),
        meta: { requiresPerm: ['procurement.read'] }
      },
      {
        path: 'after-sales',
        name: 'after-sales',
        component: () => import('@/pages/AfterSales.vue'),
        meta: { requiresPerm: ['after_sales.read'] }
      },
      {
        path: 'replenishment',
        name: 'replenishment',
        component: () => import('@/pages/Replenishment.vue'),
        meta: { requiresPerm: ['replenishment.read'] }
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/pages/Users.vue'),
        // 成员管理属系统管理整组：菜单整组需 system.manage 才出现，直链同样要求 system.manage（requiresGroupGate），页面内操作再按 user.read / user.manage 细分
        meta: { requiresPerm: ['system.users'] }
      },
      {
        path: 'logs',
        name: 'logs',
        component: () => import('@/pages/Logs.vue'),
        meta: { requiresPerm: ['system.logs'] }
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/pages/Settings.vue'),
        // 系统设置属系统管理整组，仅 system.manage 可进入；页内各 tab 再按功能权限码单独显隐
        meta: { requiresPerm: ['system.settings','system.backup','system.logo','system.appearance','system.roles','system.permissions','system.warehouses','system.usage','system.audit'] }
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/pages/Profile.vue')
      },
      {
        path: 'recycle-bin',
        name: 'recycle-bin',
        component: () => import('@/pages/RecycleBin.vue'),
        // 回收站属系统管理整组，仅 system.manage 可进入
        meta: { requiresPerm: ['system.recycle'] }
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

// 全局守卫：登录校验 + 菜单对应业务路由的权限校验
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
  if (!hasLocalSession()) {
    return '/login'
  }
  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    // 本地有缓存但 getSession 为空 → 尝试用 refresh_token 恢复
    const { data: refreshed } = await supabase.auth.refreshSession()
    if (!refreshed.session) return '/login'
  }

  // 已登录：确保权限已加载（MainLayout 也可能并发 init，store 内做了幂等）
  const authStore = useAuthStore()
  if (authStore.permissions.length === 0 && authStore.user) {
    try {
      await authStore.init()
    } catch {
      return '/login'
    }
  }

  // 整组门禁校验：requiresGroupGate 存在且非空时，用户必须拥有其中全部权限（如系统管理整组=system.manage，防止菜单外直链绕过）
  const requiresGroupGate = to.meta.requiresGroupGate as string[] | undefined
  if (requiresGroupGate && requiresGroupGate.length > 0) {
    const gateOk = requiresGroupGate.every((p) => authStore.permissions.includes(p))
    if (!gateOk) return '/dashboard'
  }

  // 业务路由权限校验：requiresPerm 存在且非空时，用户须拥有其中任意一项
  const requiresPerm = to.meta.requiresPerm as string[] | undefined
  if (requiresPerm && requiresPerm.length > 0) {
    const ok = requiresPerm.some((p) => authStore.permissions.includes(p))
    if (!ok) return '/dashboard'
  }
  return true
})

export default router
