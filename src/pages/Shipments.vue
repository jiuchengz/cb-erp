<template>
  <div class="page">
    <div class="page-header">
      <h2>发货管理</h2>
      <div>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" @click="openForwarderDialog">货代管理</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增发货单</el-button>
      </div>
    </div>

    <div class="filters">
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 160px" @change="load">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-select v-model="query.cargo_status" placeholder="货物状态" clearable style="width: 160px" @change="load">
        <el-option v-for="s in cargoStatusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-select v-model="query.bill_check_status" placeholder="账单核对" clearable style="width: 160px" @change="load">
        <el-option v-for="s in billCheckStatusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column prop="tracking_no" label="运单号" min-width="150" />
      <el-table-column prop="carrier" label="承运商" min-width="120" />
      <el-table-column label="货代" min-width="130">
        <template #default="{ row }">
          <el-select
            v-if="canWrite"
            :model-value="row.forwarder_id || ''"
            placeholder="未指定"
            clearable
            size="small"
            style="width: 120px"
            @update:model-value="onChangeForwarder(row, $event)"
          >
            <el-option v-for="f in forwarders" :key="f.id" :label="f.name" :value="f.id" />
          </el-select>
          <span v-else>{{ row.forwarders?.name || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="货物状态" width="140">
        <template #default="{ row }">
          <el-select
            v-if="canWrite"
            :model-value="row.cargo_status"
            size="small"
            :style="{ backgroundColor: cargoColor(row.cargo_status) }"
            @update:model-value="onChangeCargo(row, $event)"
          >
            <el-option v-for="s in cargoStatusOptions" :key="s.value" :label="s.label" :value="s.value">
              <span class="dot" :style="{ backgroundColor: cargoColor(s.value) }" />
              <span>{{ s.label }}</span>
            </el-option>
          </el-select>
          <el-tag v-else :type="cargoType(row.cargo_status)">{{ cargoLabel(row.cargo_status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="入仓情况" min-width="130">
        <template #default="{ row }">
          <el-select
            v-if="canWrite"
            :model-value="row.warehouse_status || ''"
            placeholder="未填"
            clearable
            filterable
            allow-create
            size="small"
            style="width: 120px"
            @update:model-value="onChangeWarehouseStatus(row, $event)"
          >
            <el-option v-for="s in warehouseStatusOptions" :key="s" :label="s" :value="s" />
          </el-select>
          <span v-else>{{ row.warehouse_status || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="实际入仓数量" width="140">
        <template #default="{ row }">
          <el-input-number
            v-if="canWrite"
            :model-value="row.actual_warehouse_qty"
            :min="0"
            :precision="0"
            controls-position="right"
            size="small"
            style="width: 130px"
            placeholder="未填"
            @change="(v: number | undefined) => onChangeActualQty(row, v)"
          />
          <span v-else>{{ row.actual_warehouse_qty ?? '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="异常情况及罚金" min-width="160">
        <template #default="{ row }">
          <el-input
            v-if="canWrite"
            :model-value="row.abnormal_penalty ?? ''"
            placeholder="如 标签不符-罚$50"
            size="small"
            style="width: 150px"
            @change="(v: string) => onChangeAbnormal(row, v)"
          />
          <span v-else>{{ row.abnormal_penalty || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="账单运费核对" min-width="180">
        <template #default="{ row }">
          <div class="bill-check">
            <el-select
              v-if="canWrite"
              :model-value="row.bill_check_status"
              size="small"
              style="width: 110px"
              @update:model-value="onChangeBillCheck(row, $event)"
            >
              <el-option v-for="s in billCheckStatusOptions" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
            <el-tag v-else size="small">{{ billCheckLabel(row.bill_check_status) }}</el-tag>
            <span v-if="row.bill_check_time" class="check-time">{{ formatDateOnly(row.bill_check_time) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="预约时间" min-width="170">
        <template #default="{ row }">
          <el-date-picker
            v-if="canWrite"
            :model-value="row.appointment_time || null"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="选择时间"
            size="small"
            style="width: 160px"
            @change="(v: string) => onChangeAppointment(row, v)"
          />
          <span v-else>{{ row.appointment_time ? formatDate(row.appointment_time) : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="160">
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

    <el-dialog v-model="createVisible" title="新增发货单" width="860px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="运单号" required>
          <el-input v-model="form.tracking_no" placeholder="唯一运单号" />
        </el-form-item>
        <el-form-item label="承运商">
          <el-input v-model="form.carrier" placeholder="可选" />
        </el-form-item>
        <el-form-item label="货代">
          <el-select v-model="form.forwarder_id" clearable filterable placeholder="选择货代(可选)" style="width: 100%">
            <el-option v-for="f in activeForwarders" :key="f.id" :label="f.name" :value="f.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="商品明细" required>
          <div class="items-editor">
            <div v-for="(it, idx) in form.items" :key="idx" class="item-row">
              <el-select v-model="it.product_id" filterable placeholder="商品" style="width: 280px">
                <el-option v-for="p in products" :key="p.id" :label="`${p.sku} - ${p.name}`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.quantity" :min="1" :precision="0" placeholder="数量" style="width: 120px" />
              <el-select v-model="it.sales_order_id" filterable clearable placeholder="关联销售单(可选)" style="width: 220px">
                <el-option v-for="s in salesOrders" :key="s.id" :label="s.order_no" :value="s.id" />
              </el-select>
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

    <el-dialog v-model="detailVisible" title="发货单详情" width="760px">
      <el-descriptions v-if="detail" :column="2" border>
        <el-descriptions-item label="运单号">{{ detail.tracking_no }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        <el-descriptions-item label="承运商">{{ detail.carrier || '-' }}</el-descriptions-item>
        <el-descriptions-item label="货代">{{ detail.forwarders?.name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="货物状态">{{ cargoLabel(detail.cargo_status) }}</el-descriptions-item>
        <el-descriptions-item label="入仓情况">{{ detail.warehouse_status || '-' }}</el-descriptions-item>
        <el-descriptions-item label="实际入仓数量">{{ detail.actual_warehouse_qty ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="异常情况及罚金">{{ detail.abnormal_penalty || '-' }}</el-descriptions-item>
        <el-descriptions-item label="账单运费核对">{{ billCheckLabel(detail.bill_check_status) }}</el-descriptions-item>
        <el-descriptions-item label="核对时间">{{ detail.bill_check_time ? formatDate(detail.bill_check_time) : '-' }}</el-descriptions-item>
        <el-descriptions-item label="预约时间">{{ detail.appointment_time ? formatDate(detail.appointment_time) : '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="detail" :data="detail.shipment_items || []" border stripe size="small" style="margin-top: 12px">
        <el-table-column prop="product_id" label="商品ID" min-width="240" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="100" align="right" />
        <el-table-column prop="sales_order_id" label="关联销售单ID" min-width="240" show-overflow-tooltip />
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

    <!-- 货代管理弹窗 -->
    <el-dialog v-model="forwarderVisible" title="货代管理" width="680px" destroy-on-close>
      <el-table :data="forwarders" border stripe size="small" max-height="360">
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="contact" label="联系人" width="120">
          <template #default="{ row }">{{ row.contact || '-' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="电话" width="140">
          <template #default="{ row }">{{ row.phone || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editForwarder(row)">编辑</el-button>
            <el-button link :type="row.is_active ? 'warning' : 'success'" @click="toggleForwarder(row)">
              {{ row.is_active ? '停用' : '启用' }}
            </el-button>
            <el-button link type="danger" @click="removeForwarder(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="fw-form">
        <el-input v-model="fwForm.name" placeholder="货代名称(必填)" style="width: 170px" />
        <el-input v-model="fwForm.contact" placeholder="联系人" style="width: 110px" />
        <el-input v-model="fwForm.phone" placeholder="电话" style="width: 130px" />
        <el-input v-model="fwForm.remark" placeholder="备注" style="width: 160px" />
        <el-button type="primary" :loading="fwSaving" @click="saveForwarder">{{ fwEditingId ? '保存修改' : '新增货代' }}</el-button>
        <el-button v-if="fwEditingId" @click="resetFwForm">取消编辑</el-button>
      </div>
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
const canWrite = computed(() => auth.hasPermission('shipment.write'))

const SHIPMENT_FLOW: Record<string, string[]> = {
  PENDING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
}

const statusOptions = [
  { label: '待发货', value: 'PENDING' },
  { label: '已发出', value: 'SHIPPED' },
  { label: '运输中', value: 'IN_TRANSIT' },
  { label: '已送达', value: 'DELIVERED' },
  { label: '已取消', value: 'CANCELLED' },
]

const statusMap: Record<string, { label: string; type: string }> = {
  PENDING: { label: '待发货', type: 'info' },
  SHIPPED: { label: '已发出', type: 'primary' },
  IN_TRANSIT: { label: '运输中', type: 'warning' },
  DELIVERED: { label: '已送达', type: 'success' },
  CANCELLED: { label: '已取消', type: 'danger' },
}

const cargoStatusOptions = [
  { label: '已入仓', value: 'in_warehouse' },
  { label: '运输中', value: 'transporting' },
  { label: '已到港', value: 'arrived_port' },
  { label: '已清关', value: 'cleared' },
]

const cargoColorMap: Record<string, string> = {
  in_warehouse: '#67c23a',
  transporting: '#e6a23c',
  arrived_port: '#409eff',
  cleared: '#909399',
}

function cargoLabel(s: string) {
  return cargoStatusOptions.find((o) => o.value === s)?.label || s || '-'
}
function cargoColor(s: string) {
  return cargoColorMap[s] || '#909399'
}
function cargoType(s: string) {
  return s === 'in_warehouse' ? 'success' : s === 'transporting' ? 'warning' : s === 'arrived_port' ? 'primary' : 'info'
}

const warehouseStatusOptions = ['已入仓', '部分入仓', '预约中', '待入仓']

const billCheckStatusOptions = [
  { label: '待确认', value: 'pending' },
  { label: '已核对', value: 'confirmed' },
  { label: '差异确认', value: 'difference_confirmed' },
  { label: '差异待确认', value: 'difference_pending' },
]

function billCheckLabel(s: string) {
  return billCheckStatusOptions.find((o) => o.value === s)?.label || s || '-'
}

function statusLabel(s: string) {
  return statusMap[s]?.label || s
}
function statusType(s: string) {
  return statusMap[s]?.type || 'info'
}
function nextStatuses(s?: string) {
  return (s && SHIPMENT_FLOW[s]) || []
}
function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}
function formatDateOnly(v: string) {
  if (!v) return ''
  const d = new Date(v)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, status: '', cargo_status: '', bill_check_status: '' })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/shipments', { params: query })
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

async function patchShipment(row: any, payload: Record<string, unknown>) {
  try {
    const { data } = await api.patch(`/shipments/${row.id}`, payload)
    Object.assign(row, data.data)
    return true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败')
    load()
    return false
  }
}

function onChangeForwarder(row: any, v: string) {
  patchShipment(row, { forwarder_id: v || null })
}
function onChangeCargo(row: any, v: string) {
  patchShipment(row, { cargo_status: v })
}
function onChangeWarehouseStatus(row: any, v: string) {
  patchShipment(row, { warehouse_status: v || null })
}
function onChangeActualQty(row: any, v: number | undefined) {
  patchShipment(row, { actual_warehouse_qty: v ?? null })
}
function onChangeAbnormal(row: any, v: string) {
  patchShipment(row, { abnormal_penalty: v || null })
}
function onChangeBillCheck(row: any, v: string) {
  patchShipment(row, { bill_check_status: v })
}
function onChangeAppointment(row: any, v: string) {
  patchShipment(row, { appointment_time: v || null })
}

const products = ref<any[]>([])
const salesOrders = ref<any[]>([])
const forwarders = ref<any[]>([])
const activeForwarders = computed(() => forwarders.value.filter((f) => f.is_active))

async function loadOptions() {
  try {
    const [prodRes, saleRes, fwRes] = await Promise.all([
      api.get('/products', { params: { page: 1, pageSize: 200 } }),
      api.get('/sales', { params: { page: 1, pageSize: 200 } }),
      api.get('/forwarders', { params: { page: 1, pageSize: 200 } }),
    ])
    products.value = prodRes.data.data ?? []
    salesOrders.value = saleRes.data.data ?? []
    forwarders.value = fwRes.data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  tracking_no: '',
  carrier: '',
  forwarder_id: '',
  items: [] as any[],
})

function addItem() {
  form.items.push({ product_id: '', quantity: 1, sales_order_id: '' })
}
function removeItem(idx: number) {
  form.items.splice(idx, 1)
}

function openCreate() {
  form.tracking_no = ''
  form.carrier = ''
  form.forwarder_id = ''
  form.items = []
  addItem()
  createVisible.value = true
}

async function save() {
  if (!form.tracking_no.trim()) {
    ElMessage.warning('请填写运单号')
    return
  }
  const items = form.items.filter((it) => it.product_id)
  if (!items.length) {
    ElMessage.warning('请至少添加一条商品明细')
    return
  }
  const payload: any = {
    tracking_no: form.tracking_no,
    items: items.map((it) => ({
      product_id: it.product_id,
      quantity: it.quantity,
      sales_order_id: it.sales_order_id || undefined,
    })),
  }
  if (form.carrier.trim()) payload.carrier = form.carrier.trim()
  if (form.forwarder_id) payload.forwarder_id = form.forwarder_id
  saving.value = true
  try {
    await api.post('/shipments', payload)
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
    const { data } = await api.get(`/shipments/${id}`)
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
    await api.patch(`/shipments/${flowRow.value.id}`, { status: flowTarget.value })
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

const exporting = ref(false)
function exportRows() {
  const columns = [
    { key: 'tracking_no', label: '运单号' },
    { key: 'carrier', label: '承运商' },
    { key: 'forwarder', label: '货代', value: (r: any) => r.forwarders?.name || '' },
    { key: 'status', label: '状态', value: (r: any) => statusLabel(r.status) },
    { key: 'cargo_status', label: '货物状态', value: (r: any) => cargoLabel(r.cargo_status) },
    { key: 'warehouse_status', label: '入仓情况', value: (r: any) => r.warehouse_status || '' },
    { key: 'actual_warehouse_qty', label: '实际入仓数量', value: (r: any) => r.actual_warehouse_qty ?? '' },
    { key: 'abnormal_penalty', label: '异常情况及罚金', value: (r: any) => r.abnormal_penalty || '' },
    { key: 'bill_check_status', label: '账单运费核对', value: (r: any) => billCheckLabel(r.bill_check_status) },
    { key: 'bill_check_time', label: '核对时间', value: (r: any) => (r.bill_check_time ? formatDate(r.bill_check_time) : '') },
    { key: 'appointment_time', label: '预约时间', value: (r: any) => (r.appointment_time ? formatDate(r.appointment_time) : '') },
    { key: 'created_at', label: '创建时间', value: (r: any) => formatDate(r.created_at) },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `发货列表_${todayStr()}.xlsx`)
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
      `确定删除选中的 ${selected.value.length} 个发货单吗？此操作不可恢复。`,
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
      await api.delete(`/shipments/${id}`)
      ok++
    } catch {
      fail++
    }
  }
  ElMessage.success(`删除完成：成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
  selected.value = []
  load()
}

// ===== 货代管理 =====
const forwarderVisible = ref(false)
const fwSaving = ref(false)
const fwEditingId = ref('')
const fwForm = reactive({ name: '', contact: '', phone: '', remark: '' })

function resetFwForm() {
  fwEditingId.value = ''
  fwForm.name = ''
  fwForm.contact = ''
  fwForm.phone = ''
  fwForm.remark = ''
}

function openForwarderDialog() {
  resetFwForm()
  loadForwarders()
  forwarderVisible.value = true
}

async function loadForwarders() {
  try {
    const { data } = await api.get('/forwarders', { params: { page: 1, pageSize: 200 } })
    forwarders.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载货代失败')
  }
}

function editForwarder(row: any) {
  fwEditingId.value = row.id
  fwForm.name = row.name
  fwForm.contact = row.contact || ''
  fwForm.phone = row.phone || ''
  fwForm.remark = row.remark || ''
}

async function saveForwarder() {
  if (!fwForm.name.trim()) {
    ElMessage.warning('请填写货代名称')
    return
  }
  fwSaving.value = true
  try {
    const payload = {
      name: fwForm.name.trim(),
      contact: fwForm.contact.trim() || null,
      phone: fwForm.phone.trim() || null,
      remark: fwForm.remark.trim() || null,
    }
    if (fwEditingId.value) {
      await api.patch(`/forwarders/${fwEditingId.value}`, payload)
      ElMessage.success('修改成功')
    } else {
      await api.post('/forwarders', payload)
      ElMessage.success('新增成功')
    }
    resetFwForm()
    loadForwarders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    fwSaving.value = false
  }
}

async function toggleForwarder(row: any) {
  try {
    await api.patch(`/forwarders/${row.id}`, { is_active: !row.is_active })
    ElMessage.success(row.is_active ? '已停用' : '已启用')
    loadForwarders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '操作失败')
  }
}

async function removeForwarder(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除货代「${row.name}」吗？`, '删除货代', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/forwarders/${row.id}`)
    ElMessage.success('删除成功')
    loadForwarders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
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
.bill-check {
  display: flex;
  align-items: center;
  gap: 6px;
}
.check-time {
  font-size: 11px;
  color: #67c23a;
  white-space: nowrap;
}
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 6px;
}
.fw-form {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
  align-items: center;
  flex-wrap: wrap;
}
</style>
