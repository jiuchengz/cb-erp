<template>
  <div class="layout">
    <aside class="sidebar glass-panel" :class="{ open: drawerOpen }">
      <div class="brand">
        <div class="brand-icon">E</div>
        <div class="brand-text">
          <div class="brand-name">跨境电商 ERP</div>
          <div class="brand-sub">v2 · 管理系统</div>
        </div>
      </div>
      <nav>
        <router-link v-for="item in soloMenus" :key="item.path" :to="item.path" class="solo-link" @click="closeDrawer">
          <span class="mico"><component :is="item.icon" /></span>
          <span class="mlabel">{{ item.label }}</span>
        </router-link>
        <div v-for="group in menuGroups" :key="group.title" class="menu-group" :class="{ open: group.open }">
          <div class="group-title" @click="toggleGroup(group)">
            <span class="mico"><component :is="group.icon" /></span>
            <span class="mlabel">{{ group.title }}</span>
            <span class="garrow"><el-icon><arrow-down /></el-icon></span>
          </div>
          <div class="group-items">
            <router-link v-for="item in group.children" :key="item.path" :to="item.path" @click="closeDrawer">
              <span class="mico"><component :is="item.icon" /></span>
              <span class="mlabel">{{ item.label }}</span>
            </router-link>
          </div>
        </div>
      </nav>
    </aside>
    <div v-if="drawerOpen" class="drawer-mask" @click="closeDrawer"></div>
    <div class="main">
      <header class="topbar glass-panel">
        <div class="header-left">
          <button class="hamburger" :title="drawerOpen ? '收起菜单' : '展开菜单'" @click="toggleDrawer">
            <el-icon><menu /></el-icon>
          </button>
          <!-- 全局搜索：可折叠，Ctrl/⌘K 聚焦 -->
          <div class="global-search" :class="{ expanded: searchExpanded }">
            <el-icon class="search-icon" @click="expandSearch"><search /></el-icon>
            <input
              ref="searchInput"
              v-model="globalSearch"
              type="text"
              placeholder="搜索商品 SKU / 名称 / 条形码…"
              @keyup.enter="onGlobalSearch"
              @blur="collapseSearch"
            />
            <span class="shortcut">Ctrl K</span>
          </div>
        </div>
        <div class="header-right">
          <button class="topbar-btn" :title="isDark ? '切换浅色模式' : '切换暗色模式'" @click="toggleDarkMode">
            <el-icon><component :is="darkIcon" /></el-icon>
          </button>
          <button class="topbar-btn" title="日志" @click="goLogs">
            <el-icon><document /></el-icon>
            <span v-if="localLogs.length" class="log-badge">{{ localLogs.length }}</span>
          </button>
          <el-dropdown trigger="click" @command="onUserCommand">
            <span class="user-trigger">
              <span class="user">{{ auth.user?.email }}</span>
              <el-icon class="arrow"><arrow-down /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="signout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>

    <!-- 修改密码弹窗 -->
    <el-dialog v-model="pwdDialogVisible" title="修改密码" width="420px" append-to-body>
      <el-form :model="pwdForm" label-width="90px" size="default" @submit.prevent>
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.oldPassword" type="password" placeholder="请输入原密码" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPassword" type="password" placeholder="请输入新密码（至少 6 位）" show-password />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="pwdForm.confirmPassword" type="password" placeholder="请再次输入新密码" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="danger" plain size="default" style="float: left" @click="onSignOut">退出登录</el-button>
        <el-button size="default" @click="pwdDialogVisible = false">取消</el-button>
        <el-button type="primary" size="default" :loading="pwdSaving" @click="onChangePassword">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, Document, Menu, Moon, Search, Sunny, HomeFilled, Goods, Box, Sell, Van, Switch, ShoppingCart, Service, TrendCharts, User, Notebook, Setting } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { addLog, getLogs, type OpLogEntry } from '@/utils/log'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

// 恢复会话并加载角色权限：刷新后必须调用 init()，否则 roles/permissions 为空导致按钮不显示
auth.init()

const soloMenus = [
  { path: '/dashboard', label: '首页', icon: HomeFilled }
]

const menuGroups = reactive([
  {
    title: '商品中心',
    icon: Goods,
    open: true,
    children: [
      { path: '/products', label: '商品', icon: Goods },
      { path: '/inventory', label: '库存', icon: Box }
    ]
  },
  {
    title: '销售中心',
    icon: Sell,
    open: true,
    children: [
      { path: '/sales', label: '销售', icon: Sell },
      { path: '/shipments', label: '发货', icon: Van },
      { path: '/after-sales', label: '售后', icon: Service },
      { path: '/replenishment', label: '补货', icon: TrendCharts }
    ]
  },
  {
    title: '供应链',
    icon: Switch,
    open: true,
    children: [
      { path: '/procurement', label: '采购', icon: ShoppingCart },
      { path: '/transfers', label: '调拨', icon: Switch }
    ]
  },
  {
    title: '系统管理',
    icon: Setting,
    open: true,
    children: [
      { path: '/users', label: '用户', icon: User },
      { path: '/logs', label: '日志', icon: Notebook },
      { path: '/settings', label: '设置', icon: Setting }
    ]
  }
])

function toggleGroup(group: { open: boolean }) {
  group.open = !group.open
}

/* ---------- 抽屉菜单（手机端） ---------- */
const drawerOpen = ref(false)
function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value
}
function closeDrawer() {
  drawerOpen.value = false
}

/* ---------- 暗色模式 ---------- */
const isDark = ref(false)
const darkIcon = computed(() => (isDark.value ? Sunny : Moon))
function applyDark(v: boolean) {
  isDark.value = v
  document.documentElement.classList.toggle('dark', v)
  try {
    localStorage.setItem('cb_dark_mode', v ? '1' : '0')
  } catch {
    /* ignore */
  }
}
function toggleDarkMode() {
  applyDark(!isDark.value)
  addLog(isDark.value ? 'info' : 'info', isDark.value ? '切换为暗色模式' : '切换为浅色模式')
}

/* ---------- 全局搜索 ---------- */
const searchInput = ref<HTMLInputElement>()
const globalSearch = ref('')
const searchExpanded = ref(false)
function expandSearch() {
  searchExpanded.value = true
  nextTick(() => searchInput.value?.focus())
}
function collapseSearch() {
  // 保留展开态：仅当输入框失焦且无内容时收起
  if (!globalSearch.value.trim()) {
    searchExpanded.value = false
  }
}
function onGlobalSearch() {
  const kw = globalSearch.value.trim()
  if (!kw) return
  router.push({ path: '/products', query: { search: kw } })
  globalSearch.value = ''
  searchExpanded.value = false
  addLog('info', '全局搜索', kw)
}
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    expandSearch()
  }
}
onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
  refreshLocalLogs()
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

/* ---------- 日志入口 ---------- */
const localLogs = ref<OpLogEntry[]>(getLogs())

function refreshLocalLogs() {
  localLogs.value = getLogs()
}
function goLogs() {
  router.push('/logs')
}

/* ---------- 用户菜单 ---------- */
const pwdDialogVisible = ref(false)
const pwdSaving = ref(false)
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

function onUserCommand(cmd: string) {
  if (cmd === 'password') {
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPassword = ''
    pwdDialogVisible.value = true
  } else if (cmd === 'signout') {
    onSignOut()
  }
}

async function onChangePassword() {
  if (!pwdForm.oldPassword) {
    ElMessage.warning('请输入原密码')
    return
  }
  if (!pwdForm.newPassword) {
    ElMessage.warning('请输入新密码')
    return
  }
  if (pwdForm.newPassword.length < 6) {
    ElMessage.warning('新密码长度不能少于 6 位')
    return
  }
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    ElMessage.error('两次输入的新密码不一致')
    return
  }
  pwdSaving.value = true
  try {
    await api.post('/auth/password', {
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword
    })
    addLog('success', '修改密码', '密码修改成功')
    ElMessage.success('密码修改成功，请重新登录')
    pwdDialogVisible.value = false
    await onSignOut()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '密码修改失败')
  } finally {
    pwdSaving.value = false
  }
}

async function onSignOut() {
  addLog('info', '退出登录', auth.user?.email || '')
  await auth.signOut()
  router.push('/login')
}
</script>

<style scoped>
.layout { display: flex; height: 100%; gap: 22px; padding: 22px; overflow: hidden; }

/* 玻璃面板 */
.glass-panel {
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  border: none;
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight);
  border-radius: var(--radius-lg);
}

.sidebar { width: 200px; display: flex; flex-direction: column; padding: 20px 12px; overflow: hidden; flex-shrink: 0; box-shadow: 0 20px 50px -18px rgba(40, 60, 120, 0.20), inset 0 1px 0 var(--glass-highlight); }
html.dark .sidebar { box-shadow: 0 20px 50px -18px rgba(0, 0, 0, 0.42), inset 0 1px 0 var(--glass-highlight); }
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 16px; }
.brand-icon { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, #38bdf8, #818cf8); display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 17px; box-shadow: 0 8px 20px rgba(99,102,241,.4); flex-shrink: 0; }
.brand-name { font-size: 14px; font-weight: 700; color: var(--ink); white-space: nowrap; }
.brand-sub { font-size: 10px; color: var(--ink-3); margin-top: 2px; }
.sidebar nav { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; }
.sidebar nav .solo-link, .sidebar nav .group-title, .sidebar nav .group-items a { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; font-size: 14px; color: var(--ink-2); transition: all .22s ease; border: 1px solid transparent; text-decoration: none; cursor: pointer; user-select: none; }
.sidebar nav .solo-link .mico, .sidebar nav .group-title .mico, .sidebar nav .group-items a .mico { display: inline-flex; align-items: center; justify-content: center; width: 20px; font-size: 16px; flex-shrink: 0; }
.sidebar nav .solo-link:hover, .sidebar nav .group-title:hover, .sidebar nav .group-items a:hover { background: rgba(255,255,255,.35); color: var(--ink); transform: translateX(2px); }
.sidebar nav .solo-link.router-link-active, .sidebar nav .group-items a.router-link-active { background: rgba(255,255,255,.72); color: var(--ink); border-color: transparent; box-shadow: 0 8px 24px rgba(70,90,160,.12), inset 0 1px 0 #fff; font-weight: 600; }
.sidebar nav .group-title .gname { flex: 1; }
.sidebar nav .group-title .garrow { display: inline-flex; align-items: center; justify-content: center; font-size: 11px; color: var(--ink-3); transition: transform .25s ease; flex-shrink: 0; }
.sidebar nav .menu-group.open .group-title .garrow { transform: rotate(180deg); }
.sidebar nav .group-items { max-height: 0; overflow: hidden; transition: max-height .3s ease; }
.sidebar nav .menu-group.open .group-items { max-height: 320px; }
.sidebar nav .group-items a { padding-left: 42px; font-size: 13.5px; }
.sidebar nav .group-items a .mico { font-size: 14px; width: 18px; }

/* 手机端抽屉遮罩 */
.drawer-mask { position: fixed; inset: 0; z-index: 90; background: rgba(10,15,30,.35); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }
.layout:has(.drawer-mask) { position: relative; }

.main { flex: 1; display: flex; flex-direction: column; gap: 22px; overflow: hidden; min-width: 0; border-radius: var(--radius-lg); }
.topbar { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 22px; flex-shrink: 0; }
.header-left { display: flex; align-items: center; min-width: 0; }
.header-right { display: flex; align-items: center; gap: 12px; }
.hamburger { display: none; align-items: center; justify-content: center; width: 38px; height: 38px; border: 1px solid rgba(255,255,255,0.35); border-radius: 12px; background: rgba(255,255,255,.55); color: var(--ink-2); cursor: pointer; font-size: 17px; flex-shrink: 0; margin-right: 8px; }
.hamburger:hover { background: rgba(255,255,255,.85); color: var(--accent); }

/* 全局搜索框 */
.global-search { display: flex; align-items: center; gap: 8px; width: 46px; overflow: hidden; padding: 0 12px; height: 36px; border: 1px solid rgba(255,255,255,0.4); border-radius: 999px; background: rgba(255,255,255,.55); transition: width .25s ease; }
.global-search.expanded { width: 320px; }
.global-search .search-icon { font-size: 15px; color: var(--ink-3); cursor: pointer; flex-shrink: 0; }
.global-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--ink); font-size: 13px; }
.global-search input::placeholder { color: var(--ink-3); }
.global-search .shortcut { flex-shrink: 0; font-size: 11px; color: var(--ink-3); background: rgba(255,255,255,.6); border-radius: 6px; padding: 2px 7px; }

/* 顶栏按钮 */
.topbar-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border: 1px solid rgba(255,255,255,0.35); border-radius: 12px; background: rgba(255,255,255,.55); color: var(--ink-2); cursor: pointer; font-size: 16px; transition: all .2s ease; }
.topbar-btn:hover { background: rgba(255,255,255,.85); color: var(--accent); transform: translateY(-1px); }
.log-badge { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; line-height: 16px; text-align: center; font-size: 11px; color: #fff; background: #e5484d; border-radius: 8px; }

.user-trigger { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; padding: 7px 12px; border: 1px solid rgba(255,255,255,0.35); border-radius: 999px; background: rgba(255,255,255,.55); outline: none; transition: background .2s ease; }
.user-trigger:hover { background: rgba(255,255,255,.85); }
.user { font-size: 14px; color: var(--ink); }
.arrow { font-size: 12px; color: var(--ink-3); }
.content { flex: 1; overflow: auto; padding: 2px 2px 2px 0; }

/* ===== 响应式三端适配 ===== */
/* ---- 平板（<=1024px）：侧边栏收窄为图标栏 ---- */
@media (max-width: 1024px) {
  .layout { gap: 14px; padding: 14px; }
  .sidebar { width: 76px; padding: 18px 10px; }
  .sidebar .brand { justify-content: center; padding: 4px 0 16px; }
  .sidebar .brand-text { display: none; }
  .sidebar nav .solo-link, .sidebar nav .group-title, .sidebar nav .group-items a { justify-content: center; gap: 0; padding: 12px 0; font-size: 0; }
  .sidebar nav .solo-link .mico, .sidebar nav .group-title .mico, .sidebar nav .group-items a .mico { font-size: 18px; width: auto; }
  .sidebar nav .solo-link:hover, .sidebar nav .group-title:hover, .sidebar nav .group-items a:hover { transform: none; }
  .sidebar nav .group-title .garrow { display: none; }
  .sidebar nav .group-items a { padding-left: 0; }
  .sidebar nav .group-items a .mico { font-size: 18px; width: auto; }
  .main { gap: 14px; }
  .topbar { padding: 12px 16px; min-height: 58px; }
  .global-search.expanded { width: 240px; }
  .user-trigger .user { max-width: 120px; }
}

/* ---- 手机（<=700px）：侧边栏变抽屉 + 汉堡按钮 ---- */
@media (max-width: 700px) {
  .layout { display: block; padding: 10px; }
  .sidebar { position: fixed; left: -300px; top: 0; bottom: 0; width: 260px; z-index: 100; border-radius: 0 28px 28px 0; transition: left .28s ease; padding: 20px 14px; }
  .sidebar.open { left: 0; }
  .sidebar .brand { justify-content: flex-start; padding: 4px 10px 16px; }
  .sidebar .brand-text { display: block; }
  .sidebar nav .solo-link, .sidebar nav .group-title, .sidebar nav .group-items a { justify-content: flex-start; gap: 10px; font-size: 14px; padding: 11px 12px; }
  .sidebar nav .solo-link .mico, .sidebar nav .group-title .mico, .sidebar nav .group-items a .mico { font-size: 16px; width: 20px; }
  .sidebar nav .group-title .garrow { display: inline-flex; }
  .sidebar nav .group-items a { padding-left: 42px; font-size: 13.5px; }
  .sidebar nav .group-items a .mico { font-size: 14px; width: 18px; }
  .main { height: 100%; gap: 10px; }
  .topbar { padding: 10px 12px; min-height: 52px; }
  .hamburger { display: inline-flex; }
  .global-search { display: none; }
  .user-trigger .user { display: none; }
  .user-trigger { padding: 7px 11px; }
}
</style>
