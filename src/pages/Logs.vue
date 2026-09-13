<template>
  <div class="page">
    <div class="page-header">
      <h2>日志</h2>
      <div>
        <el-button v-if="logTab === 'local'" :disabled="!filteredLocal.length" @click="clearLocalLogs">
          清空本地日志
        </el-button>
        <el-button v-if="logTab === 'server'" :loading="serverLoading" @click="loadServerLogs">刷新</el-button>
        <el-button v-if="logTab === 'visit'" :loading="visitLoading" @click="loadVisits">刷新</el-button>
      </div>
    </div>

    <el-tabs v-model="logTab" @tab-change="onTabChange">
      <el-tab-pane :label="`本地日志 (${localLogs.length})`" name="local">
        <div class="log-filter">
          <el-select v-model="typeFilter" placeholder="类型" clearable style="width: 140px">
            <el-option label="信息" value="info" />
            <el-option label="成功" value="success" />
            <el-option label="警告" value="warn" />
            <el-option label="错误" value="error" />
          </el-select>
        </div>
        <el-table :resizable="false" :data="filteredLocal" border stripe>
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ row.time }}</template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <el-tag :type="logTypeTag(row.type)" size="small">{{ logTypeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="msg" label="操作" min-width="180" show-overflow-tooltip />
          <el-table-column prop="detail" label="详情" min-width="220" show-overflow-tooltip />
        </el-table>
        <div v-if="!filteredLocal.length" class="log-empty">暂无本地操作日志</div>
      </el-tab-pane>

      <el-tab-pane :label="`服务端审计日志 (${serverTotal})`" name="server">
        <div v-if="serverError" class="log-error">{{ serverError }}</div>
        <el-table :resizable="false" v-loading="serverLoading" :data="serverLogs" border stripe>
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ formatServerTime(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="动作" width="120">
            <template #default="{ row }">
              <el-tag :type="serverActionTag(row.action)" size="small">{{ actionLabel(row.action) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="对象" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ resourceText(row) }}</template>
          </el-table-column>
          <el-table-column label="IP" width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.ip || '-' }}</template>
          </el-table-column>
          <el-table-column label="操作人" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ actorText(row) }}</template>
          </el-table-column>
        </el-table>
        <div v-if="!serverLogs.length && !serverLoading && !serverError" class="log-empty">暂无服务端审计日志</div>
        <div class="pagination-bar">
          <span class="pagination-total">当前页共 {{ serverLogs.length }} 条</span>
          <el-pagination
            v-if="serverTotal > serverPageSize"
            background
            layout="total, prev, pager, next"
            :total="serverTotal"
            v-model:current-page="serverPage"
            :page-size="serverPageSize"
            @current-change="loadServerLogs"
          />
          <el-select v-model="serverPageSize" class="page-size-select" @change="serverPage = 1; loadServerLogs()">
            <el-option label="100条/页" :value="100" />
            <el-option label="200条/页" :value="200" />
            <el-option label="500条/页" :value="500" />
          </el-select>
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="auth.hasPermission('system.visit')" :label="`访问记录 (${visitTotal})`" name="visit">
        <div class="filters">
          <el-input
            v-model="visitQuery.ip"
            placeholder="IP 地址"
            clearable
            style="width: 160px"
            @keyup.enter="loadVisits"
            @clear="loadVisits"
          />
          <el-input
            v-model="visitQuery.path"
            placeholder="访问路径"
            clearable
            style="width: 170px"
            @keyup.enter="loadVisits"
            @clear="loadVisits"
          />
          <el-date-picker
            v-model="visitRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 260px"
            @change="onVisitRangeChange"
          />
          <el-button type="primary" @click="loadVisits">查询</el-button>
          <el-button @click="resetVisitFilters">重置</el-button>
        </div>
        <el-table :resizable="false" v-loading="visitLoading" :data="visitRows" border stripe>
          <el-table-column prop="created_at" label="时间" min-width="170">
            <template #default="{ row }">{{ formatServerTime(row.created_at) }}</template>
          </el-table-column>
          <el-table-column prop="ip" label="IP" min-width="140" />
          <el-table-column label="访客标识" width="130">
            <template #default="{ row }">
              <el-tooltip v-if="row.visitor_id" :content="String(row.visitor_id)" placement="top">
                <span class="visit-visitor">{{ visitorShort(row.visitor_id) }}</span>
              </el-tooltip>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="IP 归属地" min-width="240">
            <template #default="{ row }">{{ locationText(row) }}</template>
          </el-table-column>
          <el-table-column label="页面" min-width="180">
            <template #default="{ row }">
              <div class="visit-page">
                <span>{{ pageLabel(row.path) }}</span>
                <span class="visit-path">{{ row.path }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="账号" min-width="200">
            <template #default="{ row }">
              <el-tag v-if="!row.user_email" size="small" type="info">访客</el-tag>
              <span v-else>{{ row.user_email }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="device" label="设备" min-width="200" show-overflow-tooltip />
        </el-table>
        <div class="pagination-bar">
          <span class="pagination-total">当前页共 {{ visitRows.length }} 条</span>
          <el-pagination
            background
            layout="total, prev, pager, next"
            :total="visitTotal"
            v-model:current-page="visitQuery.page"
            :page-size="visitQuery.pageSize"
            @current-change="loadVisits"
          />
          <el-select v-model="visitQuery.pageSize" class="page-size-select" @change="onVisitSizeChange">
            <el-option label="100条/页" :value="100" />
            <el-option label="200条/页" :value="200" />
          </el-select>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'
import { formatDateTime as sysFormatDateTime } from '../utils/system'
import { clearLogs, getLogs, type OpLogEntry } from '../utils/log'
import { actionLabel, resourceText, actorText } from '../utils/audit-labels'
import { useAuthStore } from '../stores/auth'
import { pageLabel, locationText, visitorShort } from '../utils/visit-tracker'

const auth = useAuthStore()
// 默认落在有权限的 tab：无 system.logs 但持有 system.visit 时直接展示访问记录
const logTab = ref<'local' | 'server' | 'visit'>(
  auth.hasPermission('system.logs') || !auth.hasPermission('system.visit') ? 'local' : 'visit'
)

/* ---------- 本地日志 ---------- */
const localLogs = ref<OpLogEntry[]>(getLogs())
const typeFilter = ref('')

const filteredLocal = computed(() => {
  if (!typeFilter.value) return localLogs.value
  return localLogs.value.filter((l) => l.type === typeFilter.value)
})

function clearLocalLogs() {
  clearLogs()
  localLogs.value = getLogs()
  ElMessage.success('本地日志已清空')
}

function logTypeTag(t: OpLogEntry['type']) {
  return t === 'success' ? 'success' : t === 'warn' ? 'warning' : t === 'error' ? 'danger' : 'info'
}
function logTypeLabel(t: OpLogEntry['type']) {
  return t === 'success' ? '成功' : t === 'warn' ? '警告' : t === 'error' ? '错误' : '信息'
}

/* ---------- 服务端审计日志 ---------- */
const serverLogs = ref<any[]>([])
const serverTotal = ref(0)
const serverPage = ref(1)
const serverPageSize = ref(200)
const serverLoading = ref(false)
const serverError = ref('')

function onTabChange(name: string | number) {
  if (name === 'server') loadServerLogs()
  if (name === 'visit' && auth.hasPermission('system.visit')) loadVisits()
}

async function loadServerLogs() {
  serverLoading.value = true
  serverError.value = ''
  try {
    const { data } = await api.get('/audit-logs', {
      params: { page: serverPage.value, pageSize: serverPageSize.value },
    })
    serverLogs.value = data.data ?? []
    serverTotal.value = data.total ?? 0
  } catch (e: any) {
    serverError.value = e?.response?.data?.error?.message || '加载操作日志失败（可能需要 system.logs 权限）'
  } finally {
    serverLoading.value = false
  }
}

function formatServerTime(v: string) {
  return sysFormatDateTime(v)
}
function serverActionTag(action: string) {
  if (action?.toLowerCase().includes('create') || action?.toLowerCase().includes('insert')) return 'success'
  if (action?.toLowerCase().includes('delete') || action?.toLowerCase().includes('remove')) return 'danger'
  return 'info'
}

/* 服务端审计日志的动作 / 对象中文化改由 ../utils/audit-labels 统一提供（与「系统设置 - 审计日志」共用同一份映射） */

/* ---------- 访问记录（来访 IP）：仅 system.visit（super_admin）可见 ---------- */
const visitRows = ref<any[]>([])
const visitTotal = ref(0)
const visitLoading = ref(false)
const visitRange = ref<string[] | null>(null)
const visitQuery = reactive({ page: 1, pageSize: 100, ip: '', path: '' })

async function loadVisits() {
  visitLoading.value = true
  try {
    const params: Record<string, any> = { ...visitQuery }
    const r = visitRange.value
    if (Array.isArray(r) && r.length === 2 && r[0] && r[1]) {
      // 按浏览器本地日期取当天 00:00:00 ~ 23:59:59.999 的时间边界
      params.date_from = new Date(`${r[0]}T00:00:00`).toISOString()
      params.date_to = new Date(`${r[1]}T23:59:59.999`).toISOString()
    }
    const { data } = await api.get('/visits', { params })
    visitRows.value = data.data ?? []
    visitTotal.value = data.total ?? 0
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载访问记录失败')
  } finally {
    visitLoading.value = false
  }
}

function onVisitRangeChange() {
  visitQuery.page = 1
  loadVisits()
}

function onVisitSizeChange() {
  visitQuery.page = 1
  loadVisits()
}

function resetVisitFilters() {
  visitQuery.ip = ''
  visitQuery.path = ''
  visitRange.value = null
  visitQuery.page = 1
  loadVisits()
}

// 进入页面时若默认（或按权限）落在服务端日志 / 访问记录，需主动加载一次（tab-change 不触发）
onMounted(() => {
  if (logTab.value === 'server') loadServerLogs()
  if (logTab.value === 'visit') loadVisits()
})
</script>

<style scoped>
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}
.pagination-bar .el-pagination {
  margin-top: 0;
}
.pagination-total {
  font-size: 14px;
  color: var(--el-text-color-secondary, #606266);
}
.page-size-select {
  width: 120px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.log-filter {
  margin-bottom: 12px;
}
.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.visit-page {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}
.visit-path {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.visit-visitor {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  cursor: default;
}
.log-empty {
  text-align: center;
  color: var(--color-muted);
  padding: 30px 0;
  font-size: 13px;
}
.log-error {
  color: #e5484d;
  font-size: 13px;
  padding: 10px;
  background: var(--color-fill);
  border-radius: 6px;
  margin-bottom: 10px;
}
</style>
