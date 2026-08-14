<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">跨境电商 ERP</div>
      <nav>
        <router-link v-for="item in menus" :key="item.path" :to="item.path">
          {{ item.label }}
        </router-link>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <span class="user">{{ auth.user?.email }}</span>
        <button @click="onSignOut">退出</button>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()

// 恢复会话并加载角色权限：刷新后必须调用 init()，否则 roles/permissions 为空导致按钮不显示
auth.init()

const menus = [
  { path: '/dashboard', label: '首页' },
  { path: '/products', label: '商品' },
  { path: '/inventory', label: '库存' },
  { path: '/sales', label: '销售' },
  { path: '/shipments', label: '发货' },
  { path: '/transfers', label: '调拨' },
  { path: '/procurement', label: '采购' },
  { path: '/after-sales', label: '售后' },
  { path: '/replenishment', label: '补货' },
  { path: '/users', label: '用户' },
  { path: '/settings', label: '设置' }
]

async function onSignOut() {
  await auth.signOut()
  router.push('/login')
}
</script>

<style scoped>
.layout { display: flex; height: 100%; }
.sidebar { width: 220px; background: var(--color-sidebar); color: #fff; display: flex; flex-direction: column; }
.logo { padding: 20px; font-size: 18px; font-weight: 600; }
.sidebar nav { display: flex; flex-direction: column; }
.sidebar nav a { padding: 12px 20px; color: #c9cdd4; }
.sidebar nav a:hover, .sidebar nav a.router-link-active { background: rgba(255,255,255,.08); color: #fff; }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar { height: 56px; display: flex; align-items: center; justify-content: flex-end; gap: 16px; padding: 0 20px; background: #fff; border-bottom: 1px solid #e5e6eb; }
.topbar button { padding: 6px 14px; border: 1px solid #dcdfe6; background: #fff; border-radius: 4px; cursor: pointer; }
.content { flex: 1; padding: 20px; overflow: auto; }
</style>
