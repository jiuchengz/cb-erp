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
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'
import { formatDateTime as sysFormatDateTime } from '../utils/system'
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
const serverPageSize = ref(200)
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

/* ---------- 服务端审计日志：动作 / 对象中文化 ---------- */
// 动作英文 -> 中文（未登记的动作回退展示原文，不丢信息）
const ACTION_LABELS: Record<string, string> = {
  create: '新增',
  update: '更新',
  delete: '删除',
  login: '登录',
  logout: '登出',
  import: '导入',
  export: '导出',
  update_profile: '更新资料',
  adjust_inventory: '库存调整',
  batch_delete: '批量删除',
  batch_edit: '批量编辑',
  batch_stock: '批量改库存',
  restore: '恢复',
  purge: '彻底删除',
  audit: '审核',
  snapshot: '生成快照',
  export_backup: '导出备份',
  update_site_logo: '更新站点标识',
}

// 对象英文 -> 中文（未登记的对象回退展示原文）
const RESOURCE_LABELS: Record<string, string> = {
  product: '商品',
  shipment: '发货单',
  purchase_order: '采购单',
  sales_order: '销售单',
  inventory: '库存',
  stocktake: '盘点单',
  transfer: '调拨单',
  after_sale: '售后单',
  replenishment_order: '补货单',
  daily_sales: '日销',
  warehouse: '仓库',
  user: '用户',
  role: '角色',
  forwarder: '货代',
  system_settings: '系统设置',
  system_setting: '系统设置',
  auth: '登录',
}

function actionLabel(action: string | null | undefined): string {
  const key = String(action || '').trim()
  if (!key) return '-'
  return ACTION_LABELS[key] || ACTION_LABELS[key.toLowerCase()] || key
}

function resourceLabel(type: string | null | undefined): string {
  const key = String(type || '').trim()
  if (!key) return '-'
  return RESOURCE_LABELS[key] || RESOURCE_LABELS[key.toLowerCase()] || key
}

function resourceText(row: any): string {
  const label = resourceLabel(row?.resource_type)
  const id = row?.resource_id ? String(row.resource_id) : ''
  return id ? `${label} #${id}` : label
}

// 操作人：优先账号邮箱；历史记录缺邮箱时回退账号 ID 短值；两者都没有显示 "-"
function actorText(row: any): string {
  const email = String(row?.user_email || '').trim()
  if (email) return email
  const uid = String(row?.user_id || '').trim()
  return uid ? uid.slice(0, 8) : '-'
}
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
