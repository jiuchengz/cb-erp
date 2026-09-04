<template>
  <div v-if="layoutReady" class="layout">
    <aside class="sidebar glass-panel" :class="{ open: drawerOpen }">
      <div class="brand">
        <div class="brand-icon">
          <img v-if="site.logo" :src="site.logo" alt="logo" class="brand-logo" />
          <template v-else>E</template>
        </div>
        <div class="brand-text">
          <div class="brand-name">跨境电商 ERP</div>
          <div class="brand-sub">v2 · 管理系统</div>
        </div>
      </div>
      <nav>
        <router-link v-for="item in visibleSoloMenus" :key="item.path" :to="item.path" class="solo-link" @click="closeDrawer">
          <span class="mico"><component :is="item.icon" /></span>
          <span class="mlabel">{{ item.label }}</span>
        </router-link>
        <div v-for="group in visibleMenuGroups" :key="group.title" class="menu-group" :class="{ open: group.open }">
          <div class="group-title" @click="toggleGroup(group)">
            <span class="mico"><component :is="group.icon" /></span>
            <span class="mlabel">{{ group.title }}</span>
            <span class="garrow"><el-icon><arrow-down /></el-icon></span>
          </div>
          <div class="group-items">
            <template v-for="item in group.children" :key="item.path">
              <router-link v-if="permsPass(item.perms)" :to="item.path" @click="closeDrawer">
                <span class="mico"><component :is="item.icon" /></span>
                <span class="mlabel">{{ item.label }}</span>
              </router-link>
            </template>
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
        </div>
        <div class="header-right">
          <span class="topbar-clock" :title="'系统时区：' + tzLabel">{{ nowText }}<span class="clock-tz">{{ tzLabel }}</span></span>
          <button class="topbar-btn" :title="isDark ? '切换浅色模式' : '切换暗色模式'" @click="toggleDarkMode">
            <el-icon><component :is="darkIcon" /></el-icon>
          </button>
          <button v-if="auth.hasPermission('system.logs')" class="topbar-btn" title="日志" @click="goLogs">
            <el-icon><document /></el-icon>
            <span v-if="localLogs.length" class="log-badge">{{ localLogs.length }}</span>
          </button>
          <el-dropdown trigger="click" @command="onUserCommand">
            <span class="user-trigger">
              <span v-if="userAvatar" class="user-avatar"><img :src="userAvatar" alt="头像" /></span>
              <span v-else class="user-avatar user-avatar-fallback">{{ userInitial }}</span>
              <span class="user">{{ userDisplayName }}</span>
              <el-icon class="arrow"><arrow-down /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人中心</el-dropdown-item>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, Delete, Document, Menu, Moon, Sunny, HomeFilled, Goods, Box, Sell, Van, Switch, ShoppingCart, Service, TrendCharts, User, Notebook, Setting, Tools } from '@element-plus/icons-vue'
import { setSystemSettings, getSystemTz, DEFAULT_TIMEZONES, fetchExchangeRates } from '@/utils/system'
import { useAuthStore } from '@/stores/auth'
import { useSiteStore } from '@/stores/site'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { supabaseStorageKey } from '@/services/supabase'
import { addLog, getLogs, type OpLogEntry } from '@/utils/log'
import { createIdleWatcher, IDLE_TIMEOUT_MS } from '@/utils/idle-logout'

const auth = useAuthStore()
const site = useSiteStore()
const router = useRouter()
const route = useRoute()

// 恢复会话并加载角色权限：刷新后必须调用 init()，否则 roles/permissions 为空导致按钮不显示
// 登录态校验（双保险，主拦截在路由守卫）：init 完成前不渲染界面，确认无 session 时强制跳登录页
const layoutReady = ref(false)
auth.init().finally(() => {
  layoutReady.value = true
  if (!auth.user) {
    router.replace('/login')
  }
})

// 菜单项权限：perms 为空数组表示无需权限（任何登录用户可见）；
// 非空数组时用户须拥有其中任意一项权限才显示该菜单
const soloMenus = [
  { path: '/dashboard', label: '首页概览', icon: HomeFilled, perms: [] as string[] },
  { path: '/analysis', label: '经营分析', icon: TrendCharts, perms: ['products.read', 'inventory.read', 'sales.read', 'shipment.read', 'procurement.read', 'transfer.read', 'after_sales.read'] }
]

const menuGroups = reactive([
  {
    title: '商品中心',
    icon: Goods,
    open: true,
    children: [
      { path: '/products', label: '商品管理', icon: Goods, perms: ['products.read'] },
      { path: '/product-total', label: '商品总表', icon: Goods, perms: ['product_total.read'] },
      { path: '/cost-profit', label: '成本利润', icon: Goods, perms: ['cost_profit.read'] }
    ]
  },
  {
    title: '仓储物流',
    icon: Switch,
    open: true,
    children: [
      { path: '/inventory', label: '库存查询', icon: Box, perms: ['inventory.read'] },
      { path: '/stocktakes', label: '库存盘点', icon: Box, perms: ['stocktake.read'] },
      { path: '/procurement', label: '拿货管理', icon: ShoppingCart, perms: ['procurement.read'] },
      { path: '/transfers', label: '海外调拨', icon: Switch, perms: ['transfer.read'] }
    ]
  },
  {
    title: '销售中心',
    icon: Sell,
    open: true,
    children: [
      { path: '/sales', label: '销售订单', icon: Sell, perms: ['sales.read'] },
      { path: '/shipments', label: '物流发货', icon: Van, perms: ['shipment.read'] },
      { path: '/after-sales', label: '售后管理', icon: Service, perms: ['after_sales.read'] },
      { path: '/replenishment', label: '补货管理', icon: TrendCharts, perms: ['replenishment.read'] }
    ]
  },
  {
    title: '系统管理',
    icon: Setting,
    open: true,
    children: [
      { path: '/users', label: '成员管理', icon: User, perms: ['system.users'] },
      { path: '/logs', label: '操作日志', icon: Notebook, perms: ['system.logs'] },
      { path: '/settings', label: '系统设置', icon: Setting, perms: ['system.settings','system.backup','system.logo','system.appearance','system.roles','system.permissions','system.warehouses','system.usage','system.audit'] },
      { path: '/recycle-bin', label: '回收站', icon: Delete, perms: ['system.recycle'] }
    ]
  }
])

// 菜单权限判断：无权限码（空数组）直接可见；否则命中任一权限码即可见
function permsPass(perms: string[]): boolean {
  if (!perms || perms.length === 0) return true
  return perms.some((p) => auth.permissions.includes(p))
}

// 过滤后的可见菜单：组内任一子项命中即显示（业务组/系统管理组均按子项权限码独立显隐，不再设整组门禁）
const visibleSoloMenus = computed(() => soloMenus.filter((m) => permsPass(m.perms)))
const visibleMenuGroups = computed(() =>
  menuGroups.filter((g) => {
    if (g.groupPerms && !permsPass(g.groupPerms)) return false
    return g.children.some((c) => permsPass(c.perms))
  })
)

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

/* ---------- 顶栏时钟：按系统时区显示当前时间 ---------- */
const nowText = ref('')
const tzLabel = ref('')
let clockTimer: number | undefined
let rateTimer: number | undefined
function tzDisplayName(tz: string): string {
  const hit = DEFAULT_TIMEZONES.find((t) => t.tz === tz)
  return hit ? hit.label : tz
}
function updateClock() {
  const d = new Date()
  try {
    tzLabel.value = tzDisplayName(getSystemTz())
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: getSystemTz(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(d)
    const map: Record<string, string> = {}
    parts.forEach((p) => (map[p.type] = p.value))
    nowText.value = `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`
  } catch {
    /* 时区非法时回退默认格式化 */
    nowText.value = d?.toString?.() || ''
    tzLabel.value = getSystemTz()
  }
}

/* ---------- 暗色模式 ---------- */
const isDark = ref(false)
const darkIcon = computed(() => (isDark.value ? Sunny : Moon))
function applyDark(v: boolean) {
  isDark.value = v
  const html = document.documentElement
  html.classList.toggle('dark', v)
  // 手动切换明暗时清空背景内联变量，回退到各模式的默认背景（浅色默认 / html.dark 深色默认），
  // 避免浅背景+浅文字或深背景+深文字导致不可读
  const root = html.style
  root.removeProperty('--bg-c1')
  root.removeProperty('--bg-c2')
  root.removeProperty('--bg-c3')
  root.removeProperty('--bg-c4')
  root.removeProperty('--glow-c1')
  root.removeProperty('--glow-c2')
  root.removeProperty('--bg-angle')
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

/* ---------- 空闲自动退出（3 小时无操作） ---------- */
const idleWatcher = createIdleWatcher(IDLE_TIMEOUT_MS, async () => {
  addLog('info', '自动退出', auth.user?.email || '')
  ElMessage.warning('长时间无操作，已自动退出登录')
  // 先强制清除本地会话缓存，确保路由守卫放行到 /login（避免残留 refresh_token 触发会话恢复被重定向回首页）
  try {
    localStorage.removeItem(supabaseStorageKey)
  } catch {
    /* ignore */
  }
  await auth.signOut()
  router.replace('/login')
})
onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
  refreshLocalLogs()
  idleWatcher.start()
  updateClock()
  clockTimer = window.setInterval(updateClock, 1000)
  rateTimer = window.setInterval(fetchExchangeRates, 4 * 60 * 60 * 1000) // 每4小时静默刷新汇率
  loadSystemSettings()
})
onBeforeUnmount(() => {
  idleWatcher.stop()
  if (clockTimer) window.clearInterval(clockTimer)
  if (rateTimer) window.clearInterval(rateTimer)
})

/* ---------- 加载系统设置：设置全局时区/币种缓存 ---------- */
async function loadSystemSettings() {
  try {
    const { data } = await api.get('/system-settings')
    const d = data?.data || data || {}
    const s = d.settings || {}
    const tz = s.default_timezone
    const cur = s.default_currency
    if (tz?.tz && cur?.code && cur?.symbol) {
      setSystemSettings(tz.tz, cur.code, cur.symbol)
    }
    updateClock() // 系统设置加载完成后立即按新时区刷新顶栏时钟
    fetchExchangeRates() // 拉取实时汇率缓存，金额展示按汇率换算
  } catch {
    // 系统设置加载失败时保持默认（America/Mexico_City / MXN），不影响页面渲染
  }
}

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

// 右上角显示姓名（优先 display_name，缺省回退邮箱）+ 头像
const userDisplayName = computed(() => auth.user?.user_metadata?.name || auth.user?.email || '')
const userAvatar = computed(() => auth.user?.user_metadata?.avatar || '')
const userInitial = computed(() => (userDisplayName.value || '?').trim().charAt(0).toUpperCase())

function onUserCommand(cmd: string) {
  if (cmd === 'profile') {
    router.push('/profile')
  } else if (cmd === 'password') {
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
.brand-icon { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, #38bdf8, #818cf8); display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 17px; box-shadow: 0 8px 20px rgba(99,102,241,.4); flex-shrink: 0; overflow: hidden; }
.brand-logo { width: 100%; height: 100%; object-fit: contain; }
.brand-name { font-size: 14px; font-weight: 700; color: var(--ink); white-space: nowrap; }
.brand-sub { font-size: 10px; color: var(--ink-3); margin-top: 2px; }
.sidebar nav { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; }
.sidebar nav .solo-link, .sidebar nav .group-title, .sidebar nav .group-items a { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; font-size: 14px; color: var(--ink-2); transition: all .22s ease; border: 1px solid transparent; text-decoration: none; cursor: pointer; user-select: none; }
.sidebar nav .solo-link .mico, .sidebar nav .group-title .mico, .sidebar nav .group-items a .mico { display: inline-flex; align-items: center; justify-content: center; width: 20px; font-size: 16px; flex-shrink: 0; }
.sidebar nav .solo-link:hover, .sidebar nav .group-title:hover, .sidebar nav .group-items a:hover { background: rgba(255,255,255,.35); color: var(--ink); transform: translateX(2px); }
.sidebar nav .solo-link.router-link-active, .sidebar nav .group-items a.router-link-active { background: rgba(255,255,255,.72); color: var(--ink); border-color: transparent; box-shadow: 0 8px 24px rgba(70,90,160,.12), inset 0 1px 0 #fff; font-weight: 600; }
html.dark .sidebar nav .solo-link:hover, html.dark .sidebar nav .group-title:hover, html.dark .sidebar nav .group-items a:hover { background: rgba(255,255,255,.10); color: var(--ink); }
html.dark .sidebar nav .solo-link.router-link-active, html.dark .sidebar nav .group-items a.router-link-active { background: rgba(255,255,255,.16); color: var(--ink); box-shadow: 0 8px 24px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.08); }
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
html.dark .hamburger { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); color: var(--ink-2); }
html.dark .hamburger:hover { background: rgba(255,255,255,.14); color: var(--accent); }

/* 顶栏时钟 */
.topbar-clock { display: inline-flex; align-items: center; padding: 7px 14px; font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; border: 1px solid rgba(255,255,255,0.35); border-radius: 999px; background: rgba(255,255,255,.45); user-select: none; }
html.dark .topbar-clock { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); color: var(--ink-2); }
.topbar-clock .clock-tz { margin-left: 10px; padding-left: 10px; border-left: 1px solid rgba(15,23,42,.14); font-size: 12px; color: var(--ink-3); }
html.dark .topbar-clock .clock-tz { border-left-color: rgba(255,255,255,.16); }

/* 顶栏按钮 */
.topbar-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border: 1px solid rgba(255,255,255,0.35); border-radius: 12px; background: rgba(255,255,255,.55); color: var(--ink-2); cursor: pointer; font-size: 16px; transition: all .2s ease; }
.topbar-btn:hover { background: rgba(255,255,255,.85); color: var(--accent); transform: translateY(-1px); }
html.dark .topbar-btn { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); color: var(--ink-2); }
html.dark .topbar-btn:hover { background: rgba(255,255,255,.14); color: var(--accent); }
.log-badge { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; line-height: 16px; text-align: center; font-size: 11px; color: #fff; background: #e5484d; border-radius: 8px; }

.user-trigger { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; padding: 5px 12px 5px 6px; border: 1px solid rgba(255,255,255,0.35); border-radius: 999px; background: rgba(255,255,255,.55); outline: none; transition: background .2s ease; }
.user-trigger:hover { background: rgba(255,255,255,.85); }
html.dark .user-trigger { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); }
html.dark .user-trigger:hover { background: rgba(255,255,255,.14); }
.user-avatar { width: 28px; height: 28px; border-radius: 50%; overflow: hidden; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
.user-avatar img { width: 100%; height: 100%; object-fit: cover; }
.user-avatar-fallback { background: linear-gradient(135deg, #38bdf8, #818cf8); color: #fff; font-size: 14px; font-weight: 700; }
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
  .topbar-clock { display: none; }
  .user-trigger .user { display: none; }
  .user-trigger { padding: 7px 11px; }
}
</style>
