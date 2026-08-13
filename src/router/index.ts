import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
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

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.initialized) await auth.init()

  if (to.meta.public) {
    if (to.name === 'login' && auth.session) return '/dashboard'
    return true
  }

  if (!auth.session) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
