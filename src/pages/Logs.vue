<template>
  <div class="page">
    <div class="page-header">
      <h2>日志</h2>
      <div>
        <el-button v-if="logTab === 'local'" :disabled="!filteredLocal.length" @click="clearLocalLogs">
          清空本地日志
        </el-button>
        <el-button v-if="logTab === 'server'" :loading="serverLoading" @click="loadServerLogs">刷新</el-button>
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
        <el-table :data="filteredLocal" border stripe>
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
        <el-table v-loading="serverLoading" :data="serverLogs" border stripe>
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ formatServerTime(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="动作" width="120">
            <template #default="{ row }">
              <el-tag :type="serverActionTag(row.action)" size="small">{{ row.action }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="对象" min-width="200">
            <template #default="{ row }">{{ row.resource_type }} #{{ row.resource_id ?? '-' }}</template>
          </el-table-column>
          <el-table-column prop="user_email" label="操作人" min-width="200" show-overflow-tooltip />
        </el-table>
        <div v-if="!serverLogs.length && !serverLoading && !serverError" class="log-empty">暂无服务端审计日志</div>
        <el-pagination
          v-if="serverTotal > serverPageSize"
          background
          layout="total, prev, pager, next"
          :total="serverTotal"
          v-model:current-page="serverPage"
          :page-size="serverPageSize"
          style="margin-top: 16px; justify-content: flex-end"
          @current-change="loadServerLogs"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'
import { clearLogs, getLogs, type OpLogEntry } from '../utils/log'

const logTab = ref<'local' | 'server'>('local')

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
const serverPageSize = 50
const serverLoading = ref(false)
const serverError = ref('')

function onTabChange(name: string | number) {
  if (name === 'server') loadServerLogs()
}

async function loadServerLogs() {
  serverLoading.value = true
  serverError.value = ''
  try {
    const { data } = await api.get('/audit-logs', {
      params: { page: serverPage.value, pageSize: serverPageSize },
    })
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
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.log-filter {
  margin-bottom: 12px;
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
