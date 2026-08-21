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
        <el-button v-if="canWrite" @click="openTypeDialog">类型管理</el-button>
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
      <el-table-column label="商品名称" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ firstItem(row)?.products?.name || '-' }}</template>
      </el-table-column>
      <el-table-column label="图片" width="90">
        <template #default="{ row }">
          <img
            v-if="isImageUrl(firstItem(row)?.products?.image_text)"
            :src="firstItem(row)?.products?.image_text"
            class="item-img"
            referrerpolicy="no-referrer"
            @error="onImgError($event)"
          />
          <span v-else>-</span>
        </template>
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
            <el-option v-for="t in afterSaleTypes" :key="t.value" :label="t.name" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联销售单">
          <el-select v-model="form.sales_order_id" filterable clearable placeholder="可选" style="width: 100%">
            <el-option v-for="s in salesOrders" :key="s.id" :label="s.order_no" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库">
          <el-select v-model="form.warehouse_id" clearable placeholder="退货入库仓库(可选)" style="width: 100%">
            <el-option-group v-if="domesticWh.length" label="国内仓库">
              <el-option v-for="w in domesticWh" :key="w.id" :label="w.name" :value="w.id" />
            </el-option-group>
            <el-option-group v-if="overseasWh.length" label="海外仓">
              <el-option v-for="w in overseasWh" :key="w.id" :label="w.name" :value="w.id" />
            </el-option-group>
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
              <el-input v-model="it.link_id" placeholder="输入链ID" style="width: 200px" @change="resolveItem(it)" />
              <template v-if="it.product_name">
                <span class="item-name">{{ it.product_name }}</span>
                <img
                  v-if="isImageUrl(it.product_image)"
                  :src="it.product_image"
                  class="item-thumb"
                  referrerpolicy="no-referrer"
                  @error="it.product_image = ''"
                />
              </template>
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
        <el-table-column label="图片" width="80">
          <template #default="{ row }">
            <img
              v-if="isImageUrl(row.products?.image_text)"
              :src="row.products?.image_text"
              class="item-thumb"
              referrerpolicy="no-referrer"
              @error="onImgError($event)"
            />
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="链ID" min-width="140">
          <template #default="{ row }">{{ row.products?.link_id || '-' }}</template>
        </el-table-column>
        <el-table-column label="商品名称" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.products?.name || '-' }}</template>
        </el-table-column>
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

    <!-- 售后类型管理弹窗 -->
    <el-dialog v-model="typeVisible" title="售后类型管理" width="680px" destroy-on-close>
      <el-table :data="afterSaleTypes" border stripe size="small" max-height="340">
        <el-table-column prop="sort_order" label="排序" width="70" />
        <el-table-column prop="value" label="类型标识" min-width="120" />
        <el-table-column prop="name" label="类型名称" min-width="130" />
        <el-table-column label="退货入库" width="100">
          <template #default="{ row }">
            <el-tag :type="row.need_stock_in ? 'success' : 'info'">{{ row.need_stock_in ? '是' : '否' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editType(row)">编辑</el-button>
            <el-button link type="danger" @click="removeType(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="type-form">
        <el-input v-model="typeForm.value" placeholder="标识(英文/数字,保存后不可改)" style="width: 200px" :disabled="!!typeEditingId" />
        <el-input v-model="typeForm.name" placeholder="类型名称(必填)" style="width: 150px" />
        <el-checkbox v-model="typeForm.need_stock_in">退货入库</el-checkbox>
        <el-input v-model="typeForm.sort_order" placeholder="排序(数字)" style="width: 110px" />
        <el-button type="primary" :loading="typeSaving" @click="saveType">{{ typeEditingId ? '保存修改' : '新增类型' }}</el-button>
        <el-button v-if="typeEditingId" @click="resetTypeForm">取消编辑</el-button>
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
const canWrite = computed(() => auth.hasPermission('after_sales.write'))

const AFTER_SALES_FLOW: Record<string, string[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'PLATFORM_INTERVENED'],
  APPROVED: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['COMPLETED', 'PLATFORM_INTERVENED'],
  COMPLETED: ['PLATFORM_INTERVENED'],
  REJECTED: [],
  PLATFORM_INTERVENED: ['COMPLETED', 'REJECTED'],
}

const statusOptions = [
  { label: '待处理', value: 'PENDING' },
  { label: '已完成', value: 'APPROVED' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已取消', value: 'REJECTED' },
  { label: '平台已介入', value: 'PLATFORM_INTERVENED' },
]

const statusMap: Record<string, { label: string; type: string }> = {
  PENDING: { label: '待处理', type: 'info' },
  APPROVED: { label: '已完成', type: 'success' },
  PROCESSING: { label: '处理中', type: 'warning' },
  COMPLETED: { label: '已完成', type: 'success' },
  REJECTED: { label: '已取消', type: 'danger' },
  PLATFORM_INTERVENED: { label: '平台已介入', type: 'warning' },
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
  return afterSaleTypes.value.find((x) => x.value === t)?.name || t || '-'
}
function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, status: '' })

// 售后类型字典（动态从 /api/after-sale-types 加载，value + name + need_stock_in）
const afterSaleTypes = ref<any[]>([])
async function loadAfterSaleTypes() {
  try {
    const { data } = await api.get('/after-sale-types')
    afterSaleTypes.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载售后类型失败')
  }
}

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
const domesticWh = computed(() => warehouses.value.filter((w: any) => w.wh_type === 'domestic'))
const overseasWh = computed(() => warehouses.value.filter((w: any) => w.wh_type === 'overseas'))
function warehouseName(id: string) {
  if (!id) return '-'
  return warehouses.value.find((w) => w.id === id)?.name || id
}
async function loadAll(url: string): Promise<any[]> {
  const all: any[] = []
  let page = 1
  const pageSize = 200
  while (true) {
    const res = await api.get(url, { params: { page, pageSize } })
    const list = res.data.data ?? []
    all.push(...list)
    const total = res.data.total ?? 0
    if (all.length >= total || list.length < pageSize) break
    page++
  }
  return all
}
async function loadAllProducts(): Promise<any[]> {
  return loadAll('/products')
}
async function loadOptions() {
  try {
    const whRes = await api.get('/warehouses')
    products.value = await loadAllProducts()
    warehouses.value = whRes.data.data ?? []
    salesOrders.value = await loadAll('/sales')
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
  form.items.push({ link_id: '', product_id: '', product_name: '', product_image: '', quantity: 1 })
}
function removeItem(idx: number) {
  form.items.splice(idx, 1)
}

// 根据输入的链ID匹配商品，回填商品ID/名称/图片
function resolveItem(it: any) {
  const linkId = (it.link_id || '').trim()
  const p = products.value.find((x) => x.link_id === linkId)
  if (p) {
    it.product_id = p.id
    it.product_name = p.name
    it.product_image = p.image_text || ''
  } else {
    it.product_id = ''
    it.product_name = ''
    it.product_image = ''
    if (linkId) ElMessage.warning(`未找到链ID：${linkId}`)
  }
}

function firstItem(row: any) {
  return (row.after_sale_items || [])[0] || {}
}

function isImageUrl(v: unknown): v is string {
  if (!v || typeof v !== 'string') return false
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:image/')
}

function onImgError(e: Event) {
  const img = e.target as HTMLImageElement
  img.src =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="100%" height="100%" fill="#f0f2f5"/><text x="50%" y="50%" fill="#c0c4cc" font-size="10" text-anchor="middle" dominant-baseline="middle">无图片</text></svg>'
    )
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

// ===== 售后类型管理 =====
const typeVisible = ref(false)
const typeSaving = ref(false)
const typeEditingId = ref('')
const typeForm = reactive({ value: '', name: '', need_stock_in: false, sort_order: 0 })

function resetTypeForm() {
  typeEditingId.value = ''
  typeForm.value = ''
  typeForm.name = ''
  typeForm.need_stock_in = false
  typeForm.sort_order = 0
}

function openTypeDialog() {
  resetTypeForm()
  loadAfterSaleTypes()
  typeVisible.value = true
}

function editType(row: any) {
  typeEditingId.value = row.id
  typeForm.value = row.value
  typeForm.name = row.name
  typeForm.need_stock_in = !!row.need_stock_in
  typeForm.sort_order = row.sort_order ?? 0
}

async function saveType() {
  if (!typeForm.name.trim()) {
    ElMessage.warning('请填写类型名称')
    return
  }
  if (!typeEditingId.value && !typeForm.value.trim()) {
    ElMessage.warning('请填写类型标识')
    return
  }
  typeSaving.value = true
  try {
    const payload: any = {
      name: typeForm.name.trim(),
      need_stock_in: !!typeForm.need_stock_in,
      sort_order: typeForm.sort_order ?? 0,
    }
    if (typeEditingId.value) {
      await api.patch(`/after-sale-types/${typeEditingId.value}`, payload)
      ElMessage.success('修改成功')
    } else {
      await api.post('/after-sale-types', { value: typeForm.value.trim(), ...payload })
      ElMessage.success('新增成功')
    }
    resetTypeForm()
    loadAfterSaleTypes()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    typeSaving.value = false
  }
}

async function removeType(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除售后类型「${row.name}」吗？`, '删除售后类型', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/after-sale-types/${row.id}`)
    ElMessage.success('删除成功')
    loadAfterSaleTypes()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
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
    { key: 'item_name', label: '商品名称', value: (r: any) => firstItem(r)?.products?.name || '-' },
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
  loadAfterSaleTypes()
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
.item-name {
  font-size: 13px;
  color: #303133;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid #ebeef5;
}
.item-img {
  width: 60px;
  height: 60px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid #ebeef5;
}
.type-form {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
  flex-wrap: wrap;
}
</style>
