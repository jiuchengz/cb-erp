<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">跨境电商 ERP v2</div>
      <nav>
        <router-link v-for="item in menus" :key="item.path" :to="item.path">
          {{ item.label }}
        </router-link>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="header-left">
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
          <button class="topbar-btn" title="操作日志" @click="openLogPanel">
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
      <div v-if="auth.debug" class="debug-bar">{{ auth.debug }}</div>
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

    <!-- 操作日志浮动面板 -->
    <el-drawer v-model="logPanelVisible" title="操作日志" size="420px" append-to-body>
      <el-tabs v-model="logTab">
        <el-tab-pane :label="`本地日志 (${localLogs.length})`" name="local">
          <div class="log-toolbar">
            <el-button size="small" @click="clearLocalLogs">清空本地日志</el-button>
          </div>
          <div class="log-list">
            <div v-for="(log, i) in localLogs" :key="'l' + i" class="log-entry">
              <span class="log-time">{{ log.time }}</span>
              <el-tag :type="logTypeTag(log.type)" size="small">{{ logTypeLabel(log.type) }}</el-tag>
              <span class="log-msg">{{ log.msg }}</span>
              <span v-if="log.detail" class="log-detail">{{ log.detail }}</span>
            </div>
            <div v-if="!localLogs.length" class="log-empty">暂无本地操作日志</div>
          </div>
        </el-tab-pane>
        <el-tab-pane :label="`服务端审计日志 (${serverTotal})`" name="server">
          <div class="log-toolbar">
            <el-button size="small" :loading="serverLoading" @click="loadServerLogs">刷新</el-button>
          </div>
          <div v-if="serverError" class="log-error">{{ serverError }}</div>
          <div class="log-list">
            <div v-for="(log, i) in serverLogs" :key="'s' + i" class="log-entry">
              <span class="log-time">{{ formatServerTime(log.created_at) }}</span>
              <el-tag :type="serverActionTag(log.action)" size="small">{{ log.action }}</el-tag>
              <span class="log-msg">{{ log.resource_type }} #{{ log.resource_id ?? '-' }}</span>
              <span v-if="log.user_email" class="log-detail">{{ log.user_email }}</span>
            </div>
            <div v-if="!serverLogs.length && !serverLoading && !serverError" class="log-empty">暂无服务端审计日志</div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, Document, Moon, Search, Sunny } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { addLog, clearLogs, getLogs, type OpLogEntry } from '@/utils/log'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

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
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

/* ---------- 操作日志面板 ---------- */
const logPanelVisible = ref(false)
const logTab = ref<'local' | 'server'>('local')
const localLogs = ref<OpLogEntry[]>([])
const serverLogs = ref<any[]>([])
const serverTotal = ref(0)
const serverLoading = ref(false)
const serverError = ref('')

function refreshLocalLogs() {
  localLogs.value = getLogs()
}
function openLogPanel() {
  logPanelVisible.value = true
  logTab.value = 'local'
  refreshLocalLogs()
}
watch(logTab, (t) => {
  if (t === 'server') loadServerLogs()
})
watch(logPanelVisible, (v) => {
  if (v) refreshLocalLogs()
})

function clearLocalLogs() {
  clearLogs()
  refreshLocalLogs()
  ElMessage.success('本地日志已清空')
}
function logTypeTag(t: OpLogEntry['type']) {
  return t === 'success' ? 'success' : t === 'warn' ? 'warning' : t === 'error' ? 'danger' : 'info'
}
function logTypeLabel(t: OpLogEntry['type']) {
  return t === 'success' ? '成功' : t === 'warn' ? '警告' : t === 'error' ? '错误' : '信息'
}
async function loadServerLogs() {
  serverLoading.value = true
  serverError.value = ''
  try {
    const { data } = await api.get('/audit-logs', { params: { page: 1, pageSize: 50 } })
    serverLogs.value = data.data ?? []
    serverTotal.value = data.total ?? 0
  } catch (e: any) {
    serverError.value = e?.response?.data?.error?.message || '加载审计日志失败（可能需要 system.manage 权限）'
  } finally {
    serverLoading.value = false
  }
}
function formatServerTime(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}
function serverActionTag(action: string) {
  if (action?.toLowerCase().includes('create') || action?.toLowerCase().includes('insert')) return 'success'
  if (action?.toLowerCase().includes('delete') || action?.toLowerCase().includes('remove')) return 'danger'
  return 'info'
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
.layout { display: flex; height: 100%; }
.sidebar { width: 220px; background: var(--color-sidebar); color: #fff; display: flex; flex-direction: column; }
.logo { padding: 20px; font-size: 18px; font-weight: 600; }
.sidebar nav { display: flex; flex-direction: column; }
.sidebar nav a { padding: 12px 20px; color: #c9cdd4; }
.sidebar nav a:hover, .sidebar nav a.router-link-active { background: rgba(255,255,255,.08); color: #fff; }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar { height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 20px; background: var(--color-header-bg); border-bottom: 1px solid var(--color-border-light); }
.header-left { display: flex; align-items: center; min-width: 0; }
.header-right { display: flex; align-items: center; gap: 12px; }
.debug-bar { padding: 8px 20px; background: #fff7e6; color: #8a5b00; border-bottom: 1px solid #ffd591; font-size: 13px; line-height: 1.5; word-break: break-all; }
html.dark .debug-bar { background: #3a2f14; color: #e6c97a; border-bottom-color: #5a4a20; }

/* 全局搜索框 */
.global-search { display: flex; align-items: center; gap: 6px; width: 42px; overflow: hidden; padding: 0 8px; height: 32px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-input-bg); transition: width .25s ease; }
.global-search.expanded { width: 320px; }
.global-search .search-icon { font-size: 15px; color: var(--color-muted); cursor: pointer; flex-shrink: 0; }
.global-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--color-text); font-size: 13px; }
.global-search input::placeholder { color: var(--color-muted); }
.global-search .shortcut { flex-shrink: 0; font-size: 11px; color: var(--color-muted); background: var(--color-fill); border-radius: 4px; padding: 1px 5px; }

/* 顶栏按钮 */
.topbar-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-input-bg); color: var(--color-text); cursor: pointer; font-size: 16px; }
.topbar-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.log-badge { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; line-height: 16px; text-align: center; font-size: 11px; color: #fff; background: #e5484d; border-radius: 8px; }

.user-trigger { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-input-bg); outline: none; }
.user { font-size: 14px; color: var(--color-text); }
.arrow { font-size: 12px; color: var(--color-muted); }
.content { flex: 1; padding: 20px; overflow: auto; }

/* 日志面板 */
.log-toolbar { margin-bottom: 10px; }
.log-list { max-height: 60vh; overflow: auto; }
.log-entry { padding: 8px 10px; border: 1px solid var(--color-border-light); border-radius: 6px; margin-bottom: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
.log-time { color: var(--color-muted); font-size: 12px; width: 100%; }
.log-msg { color: var(--color-text); }
.log-detail { color: var(--color-muted); width: 100%; font-size: 12px; }
.log-empty { text-align: center; color: var(--color-muted); padding: 30px 0; font-size: 13px; }
.log-error { color: #e5484d; font-size: 13px; padding: 10px; background: var(--color-fill); border-radius: 6px; margin-bottom: 10px; }
</style>
