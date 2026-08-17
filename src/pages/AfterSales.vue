<template>
  <div class="page">
    <div class="page-header">
      <h2>售后管理</h2>
      <div>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增售后单</el-button>
      </div>
    </div>

    <div class="filters">
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 160px" @change="load">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column prop="order_no" label="售后单号" min-width="160" />
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag>{{ typeLabel(row.type) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="仓库" min-width="140">
        <template #default="{ row }">{{ warehouseName(row.warehouse_id) }}</template>
      </el-table-column>
      <el-table-column prop="reason" label="原因" min-width="160" show-overflow-tooltip />
      <el-table-column prop="result" label="处理结果" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.result || '-' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="170">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.id)">详情</el-button>
          <el-button v-if="canWrite && nextStatuses(row.status).length" link type="primary" @click="openFlow(row)">
            流转
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      background
      layout="total, sizes, prev, pager, next"
      :total="total"
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :page-sizes="[20, 50, 100]"
      @current-change="load"
      @size-change="onSizeChange"
    />

    <el-dialog v-model="createVisible" title="新增售后单" width="860px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="售后单号" required>
          <el-input v-model="form.order_no" placeholder="唯一售后单号" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="form.type" style="width: 200px">
            <el-option label="退货" value="return" />
            <el-option label="换货" value="exchange" />
            <el-option label="退款" value="refund" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联销售单">
          <el-select v-model="form.sales_order_id" filterable clearable placeholder="可选" style="width: 100%">
            <el-option v-for="s in salesOrders" :key="s.id" :label="s.order_no" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库">
          <el-select v-model="form.warehouse_id" clearable placeholder="退货入库仓库(可选)" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="form.reason" type="textarea" :rows="2" maxlength="256" />
        </el-form-item>
        <el-form-item label="处理结果">
          <el-input v-model="form.result" type="textarea" :rows="2" maxlength="512" placeholder="处理结果（可选）" />
        </el-form-item>
        <el-form-item label="商品明细" required>
          <div class="items-editor">
            <div v-for="(it, idx) in form.items" :key="idx" class="item-row">
              <el-select v-model="it.product_id" filterable placeholder="商品" style="width: 400px">
                <el-option v-for="p in products" :key="p.id" :label="`${p.sku} - ${p.name}`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.quantity" :min="1" :precision="0" placeholder="数量" style="width: 140px" />
              <el-button link type="danger" @click="removeItem(idx)">删除</el-button>
            </div>
            <el-button size="small" @click="addItem">添加明细</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="售后单详情" width="760px">
      <el-descriptions v-if="detail" :column="2" border>
        <el-descriptions-item label="售后单号">{{ detail.order_no }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ typeLabel(detail.type) }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        <el-descriptions-item label="仓库">{{ warehouseName(detail.warehouse_id) }}</el-descriptions-item>
        <el-descriptions-item label="关联销售单ID" :span="2">{{ detail.sales_order_id || '-' }}</el-descriptions-item>
        <el-descriptions-item label="原因" :span="2">{{ detail.reason || '-' }}</el-descriptions-item>
        <el-descriptions-item label="处理结果" :span="2">
          <el-input
            v-if="canWrite"
            v-model="detail.result"
            type="textarea"
            :rows="2"
            maxlength="512"
            placeholder="填写处理结果"
            @change="saveResult(detail)"
          />
          <span v-else>{{ detail.result || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="创建时间" :span="2">{{ formatDate(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="detail" :data="detail.after_sale_items || []" border stripe size="small" style="margin-top: 12px">
        <el-table-column prop="product_id" label="商品ID" min-width="240" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="100" align="right" />
      </el-table>
    </el-dialog>

    <el-dialog v-model="flowVisible" title="状态流转" width="420px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="当前状态">
          <el-tag>{{ statusLabel(flowRow?.status) }}</el-tag>
        </el-form-item>
        <el-form-item label="目标状态" required>
          <el-select v-model="flowTarget" style="width: 100%">
            <el-option v-for="s in nextStatuses(flowRow?.status)" :key="s" :label="statusLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="flowVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitFlow">确认流转</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../services/api'
import { useAuthStore } from '../stores/auth'
import { exportTable, todayStr } from '../utils/export'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('after_sales.write'))

const AFTER_SALES_FLOW: Record<string, string[]> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
}

const statusOptions = [
  { label: '待处理', value: 'PENDING' },
  { label: '已通过', value: 'APPROVED' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已驳回', value: 'REJECTED' },
]

const statusMap: Record<string, { label: string; type: string }> = {
  PENDING: { label: '待处理', type: 'info' },
  APPROVED: { label: '已通过', type: 'primary' },
  PROCESSING: { label: '处理中', type: 'warning' },
  COMPLETED: { label: '已完成', type: 'success' },
  REJECTED: { label: '已驳回', type: 'danger' },
}

function statusLabel(s: string) {
  return statusMap[s]?.label || s
}
function statusType(s: string) {
  return statusMap[s]?.type || 'info'
}
function nextStatuses(s?: string) {
  return (s && AFTER_SALES_FLOW[s]) || []
}
function typeLabel(t: string) {
  return { return: '退货', exchange: '换货', refund: '退款' }[t] || t
}
function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, status: '' })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/after-sales', { params: query })
    rows.value = data.data ?? []
    total.value = data.total ?? 0
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function onSizeChange() {
  query.page = 1
  load()
}

const products = ref<any[]>([])
const warehouses = ref<any[]>([])
const salesOrders = ref<any[]>([])
function warehouseName(id: string) {
  if (!id) return '-'
  return warehouses.value.find((w) => w.id === id)?.name || id
}
async function loadOptions() {
  try {
    const [prodRes, whRes, saleRes] = await Promise.all([
      api.get('/products', { params: { page: 1, pageSize: 200 } }),
      api.get('/warehouses'),
      api.get('/sales', { params: { page: 1, pageSize: 200 } }),
    ])
    products.value = prodRes.data.data ?? []
    warehouses.value = (whRes.data.data ?? []).filter((w: any) => w.wh_type === 'domestic')
    salesOrders.value = saleRes.data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  order_no: '',
  type: 'return',
  sales_order_id: '',
  warehouse_id: '',
  reason: '',
  result: '',
  items: [] as any[],
})

function addItem() {
  form.items.push({ product_id: '', quantity: 1 })
}
function removeItem(idx: number) {
  form.items.splice(idx, 1)
}

function openCreate() {
  form.order_no = ''
  form.type = 'return'
  form.sales_order_id = ''
  form.warehouse_id = ''
  form.reason = ''
  form.result = ''
  form.items = []
  addItem()
  createVisible.value = true
}

async function save() {
  if (!form.order_no.trim()) {
    ElMessage.warning('请填写售后单号')
    return
  }
  const items = form.items.filter((it) => it.product_id)
  if (!items.length) {
    ElMessage.warning('请至少添加一条商品明细')
    return
  }
  const payload: any = {
    order_no: form.order_no,
    type: form.type,
    reason: form.reason,
    items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity })),
  }
  if (form.result) payload.result = form.result
  if (form.sales_order_id) payload.sales_order_id = form.sales_order_id
  if (form.warehouse_id) payload.warehouse_id = form.warehouse_id
  saving.value = true
  try {
    await api.post('/after-sales', payload)
    ElMessage.success('创建成功')
    createVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const detailVisible = ref(false)
const detail = ref<any>(null)
async function openDetail(id: string) {
  try {
    const { data } = await api.get(`/after-sales/${id}`)
    detail.value = data.data
    detailVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载详情失败')
  }
}

const flowVisible = ref(false)
const flowRow = ref<any>(null)
const flowTarget = ref('')
function openFlow(row: any) {
  flowRow.value = row
  const next = nextStatuses(row.status)
  flowTarget.value = next[0] ?? ''
  flowVisible.value = true
}

async function submitFlow() {
  if (!flowRow.value || !flowTarget.value) return
  saving.value = true
  try {
    await api.patch(`/after-sales/${flowRow.value.id}`, { status: flowTarget.value })
    ElMessage.success('状态更新成功')
    flowVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '状态更新失败')
  } finally {
    saving.value = false
  }
}

const selected = ref<any[]>([])
function onSelectionChange(rows: any[]) {
  selected.value = rows
}

// 处理结果内联保存：PATCH /after-sales/[id]
async function saveResult(row: any) {
  try {
    const { data } = await api.patch(`/after-sales/${row.id}`, { result: row.result || '' })
    if (data?.data) Object.assign(row, data.data)
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
    load()
  }
}

const exporting = ref(false)
function exportRows() {
  const columns = [
    { key: 'order_no', label: '售后单号' },
    { key: 'type', label: '类型', value: (r: any) => typeLabel(r.type) },
    { key: 'warehouse_id', label: '仓库', value: (r: any) => warehouseName(r.warehouse_id) },
    { key: 'reason', label: '原因' },
    { key: 'result', label: '处理结果', value: (r: any) => r.result || '-' },
    { key: 'status', label: '状态', value: (r: any) => statusLabel(r.status) },
    { key: 'created_at', label: '创建时间', value: (r: any) => formatDate(r.created_at) },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `售后列表_${todayStr()}.xlsx`)
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selected.value.length} 个售后单吗？此操作不可恢复。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const ids = selected.value.map((r) => r.id)
  let ok = 0
  let fail = 0
  for (const id of ids) {
    try {
      await api.delete(`/after-sales/${id}`)
      ok++
    } catch {
      fail++
    }
  }
  ElMessage.success(`删除完成：成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
  selected.value = []
  load()
}

onMounted(() => {
  load()
  loadOptions()
})
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
.items-editor {
  width: 100%;
}
.item-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
</style>
