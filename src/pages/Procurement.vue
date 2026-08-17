<template>
  <div class="page">
    <div class="page-header">
      <h2>采购管理（拿货）</h2>
      <div>
        <el-button v-if="canWrite" @click="downloadTpl">下载模板</el-button>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量导入</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增拿货</el-button>
        <input ref="importFile" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onImportFile" />
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
      <el-table-column label="编码" min-width="140">
        <template #default="{ row }">{{ firstItem(row)?.products?.sku || '-' }}</template>
      </el-table-column>
      <el-table-column label="图片" min-width="200">
        <template #default="{ row }">
          <div class="prod-cell">
            <el-image
              v-if="firstItem(row)?.products?.image_text"
              :src="firstItem(row).products.image_text"
              :preview-src-list="[firstItem(row).products.image_text]"
              preview-teleported
              fit="cover"
              class="prod-thumb"
            />
            <div v-else class="prod-thumb placeholder">图</div>
            <span class="prod-name">{{ firstItem(row)?.products?.name || '-' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="产品编码" min-width="140">
        <template #default="{ row }">{{ firstItem(row)?.products?.code || '-' }}</template>
      </el-table-column>
      <el-table-column label="拿货数量" width="110" align="right">
        <template #default="{ row }">{{ firstItem(row)?.quantity ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="拿货日期" width="170">
        <template #default="{ row }">
          <el-date-picker
            v-if="canWrite"
            v-model="row.receive_date"
            type="date"
            value-format="YYYY-MM-DD"
            size="small"
            placeholder="选择日期"
            style="width: 140px"
            @change="(v: any) => updateReceiveDate(row, v)"
          />
          <span v-else>{{ row.receive_date || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.id)">详情</el-button>
          <el-button v-if="canWrite && nextStatuses(row.status).length" link type="primary" @click="openFlow(row)">
            流转
          </el-button>
          <el-button v-if="canWrite" link type="danger" @click="removeRow(row)">删除</el-button>
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

    <!-- 新增拿货弹窗 -->
    <el-dialog v-model="createVisible" title="新增拿货" width="520px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-form-item label="产品编码" required>
          <el-input
            v-model="form.product_code"
            placeholder="输入产品编码，名称/图片自动带出"
            @blur="lookupProduct"
          />
        </el-form-item>
        <el-form-item label="拿货数量" required>
          <el-input-number v-model="form.quantity" :min="1" :precision="0" style="width: 180px" />
        </el-form-item>
        <el-form-item label="拿货日期">
          <el-date-picker
            v-model="form.receive_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="默认当天"
            style="width: 180px"
          />
        </el-form-item>
        <el-form-item label="入库仓库" required>
          <el-select v-model="form.warehouse_id" placeholder="选择国内仓库" style="width: 100%">
            <el-option v-for="w in domesticWarehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
          <div v-if="domesticWarehouses.length === 0" style="color: #f56c6c; font-size: 12px; line-height: 1.5">
            暂无国内仓库，请先在「设置-仓库管理」创建国内仓库
          </div>
        </el-form-item>
        <el-form-item v-if="form.productInfo" label="匹配商品">
          <div class="match-box">
            <el-image
              v-if="form.productInfo.image_text"
              :src="form.productInfo.image_text"
              fit="cover"
              class="match-thumb"
            />
            <div v-else class="match-thumb placeholder">图</div>
            <div class="match-info">
              <div class="match-name">{{ form.productInfo.name }}</div>
              <div class="match-sub">编码：{{ form.productInfo.sku }} · 产品编码：{{ form.productInfo.code }}</div>
            </div>
          </div>
        </el-form-item>
        <el-form-item v-else-if="form.product_code && form.lookupMsg" label=" ">
          <span style="color: #f56c6c; font-size: 12px">{{ form.lookupMsg }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情弹窗（含创建时间） -->
    <el-dialog v-model="detailVisible" title="拿货详情" width="560px">
      <div v-if="detail" class="detail-wrap">
        <div class="match-box">
          <el-image
            v-if="firstItem(detail)?.products?.image_text"
            :src="firstItem(detail).products.image_text"
            fit="cover"
            class="match-thumb"
          />
          <div v-else class="match-thumb placeholder">图</div>
          <div class="match-info">
            <div class="match-name">{{ firstItem(detail)?.products?.name || '-' }}</div>
            <div class="match-sub">编码：{{ firstItem(detail)?.products?.sku || '-' }} · 产品编码：{{ firstItem(detail)?.products?.code || '-' }}</div>
          </div>
        </div>
        <el-descriptions :column="2" border style="margin-top: 14px">
          <el-descriptions-item label="拿货数量">{{ firstItem(detail)?.quantity ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="拿货日期">{{ detail.receive_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(detail.status)">{{ statusLabel(detail.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDate(detail.created_at) }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-dialog>

    <!-- 流转弹窗 -->
    <el-dialog v-model="flowVisible" title="状态流转" width="440px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="当前状态">
          <el-tag>{{ statusLabel(flowRow?.status) }}</el-tag>
        </el-form-item>
        <el-form-item label="目标状态" required>
          <el-select v-model="flowTarget" style="width: 100%">
            <el-option v-for="s in nextStatuses(flowRow?.status)" :key="s" :label="statusLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <div class="flow-note">流转为「已入库」后，拿货数量将自动计入对应产品的国内库存，并在库存流水（采购入库）中留痕。</div>
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
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum } from '../utils/import'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('procurement.write'))

const PURCHASE_FLOW: Record<string, string[]> = {
  ARRIVED: ['RECEIVED'],
  RECEIVED: [],
}

const statusOptions = [
  { label: '已到货', value: 'ARRIVED' },
  { label: '已入库', value: 'RECEIVED' },
]

const statusMap: Record<string, { label: string; type: string }> = {
  ARRIVED: { label: '已到货', type: 'warning' },
  RECEIVED: { label: '已入库', type: 'success' },
  DRAFT: { label: '草稿', type: 'info' },
  SUBMITTED: { label: '已提交', type: 'primary' },
  APPROVED: { label: '已审批', type: 'primary' },
  PURCHASING: { label: '采购中', type: 'warning' },
  PARTIAL: { label: '部分收货', type: 'warning' },
  CANCELLED: { label: '已取消', type: 'danger' },
}

function statusLabel(s: string) {
  return statusMap[s]?.label || s
}
function statusType(s: string) {
  return statusMap[s]?.type || 'info'
}
function nextStatuses(s?: string) {
  return (s && PURCHASE_FLOW[s]) || []
}
function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}
function firstItem(row: any) {
  return row?.purchase_order_items?.[0] || null
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, status: '' })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/purchase-orders', { params: query })
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
const domesticWarehouses = ref<any[]>([])
const codeMap = new Map<string, any>()
const skuMap = new Map<string, any>()
async function loadOptions() {
  try {
    const whRes = await api.get('/warehouses')
    domesticWarehouses.value = (whRes.data.data ?? []).filter((w: any) => w.wh_type === 'domestic')
    const allProducts: any[] = []
    let page = 1
    for (;;) {
      const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
      ;(data.data ?? []).forEach((p: any) => allProducts.push(p))
      if (page * 200 >= (data.total ?? 0)) break
      page++
    }
    products.value = allProducts
    codeMap.clear()
    skuMap.clear()
    allProducts.forEach((p) => {
      if (p.code) codeMap.set(p.code, p)
      if (p.sku) skuMap.set(p.sku, p)
    })
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  product_code: '',
  quantity: 1,
  receive_date: '',
  warehouse_id: '',
  productInfo: null as any,
  lookupMsg: '',
})

function openCreate() {
  form.product_code = ''
  form.quantity = 1
  form.receive_date = ''
  form.warehouse_id = domesticWarehouses.value[0]?.id ?? ''
  form.productInfo = null
  form.lookupMsg = ''
  createVisible.value = true
}

function lookupProduct() {
  const code = form.product_code.trim()
  if (!code) {
    form.productInfo = null
    form.lookupMsg = ''
    return
  }
  const p = codeMap.get(code) || skuMap.get(code)
  if (p) {
    form.productInfo = p
    form.lookupMsg = ''
  } else {
    form.productInfo = null
    form.lookupMsg = `未找到产品编码「${code}」，请确认后重试`
  }
}

async function save() {
  const code = form.product_code.trim()
  if (!code) {
    ElMessage.warning('请填写产品编码')
    return
  }
  if (!form.quantity || form.quantity <= 0) {
    ElMessage.warning('请填写拿货数量')
    return
  }
  const payload: any = {
    product_code: code,
    quantity: form.quantity,
  }
  if (form.receive_date) payload.receive_date = form.receive_date
  if (form.warehouse_id) payload.warehouse_id = form.warehouse_id
  saving.value = true
  try {
    await api.post('/purchase-orders', payload)
    ElMessage.success('创建成功，状态：已到货')
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
    const { data } = await api.get(`/purchase-orders/${id}`)
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
    await api.patch(`/purchase-orders/${flowRow.value.id}`, { status: flowTarget.value })
    ElMessage.success('已入库，库存已计入对应产品国内库存')
    flowVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '状态更新失败')
  } finally {
    saving.value = false
  }
}

async function removeRow(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除该拿货记录（${firstItem(row)?.products?.name || row.order_no}）吗？此操作不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await api.delete(`/purchase-orders/${row.id}`)
    ElMessage.success('删除成功')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

const selected = ref<any[]>([])
function onSelectionChange(rows: any[]) {
  selected.value = rows
}

const importing = ref(false)
const importFile = ref<any>(null)

function downloadTpl() {
  downloadTemplate(
    [
      { label: '产品编码', sample: 'D-2024-0088' },
      { label: '数量', sample: 100 },
      { label: '拿货日期', sample: '2026-08-17' },
    ],
    '拿货导入模板',
    '拿货批量导入模板.xlsx'
  )
}

function triggerImport() {
  importFile.value?.click()
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    const { headers, rows } = await readExcelFile(file)
    const col = buildColMap(headers, {
      product_code: ['产品编码', '编码', 'code'],
      quantity: ['数量', 'quantity', 'qty'],
      receive_date: ['拿货日期', '日期', '时间', 'receive_date', 'date'],
    })
    if (col.product_code === undefined || col.quantity === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"产品编码"和"数量"列')
      return
    }
    let ok = 0
    const failures: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const lineNo = i + 2
      const row = rows[i]
      const code = cellStr(row, col.product_code)
      const qty = cellNum(row, col.quantity)
      const dateStr = col.receive_date !== undefined ? cellStr(row, col.receive_date) : ''
      if (!code) {
        failures.push(`第${lineNo}行：产品编码为空`)
        continue
      }
      if (qty <= 0) {
        failures.push(`第${lineNo}行：数量必须大于 0`)
        continue
      }
      const payload: any = { product_code: code, quantity: qty }
      if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) payload.receive_date = dateStr
      try {
        await api.post('/purchase-orders', payload)
        ok++
      } catch (err: any) {
        failures.push(`第${lineNo}行：${err?.response?.data?.error?.message || '创建失败'}`)
      }
    }
    if (failures.length) {
      ElMessage.warning(`成功导入 ${ok} 条，失败 ${failures.length} 条：` + failures.slice(0, 5).join('；') + (failures.length > 5 ? ` 等 ${failures.length} 条` : ''))
    } else {
      ElMessage.success(`成功导入 ${ok} 条`)
    }
    load()
  } catch (err: any) {
    ElMessage.error(err?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

const exporting = ref(false)
async function updateReceiveDate(row: any, val: any) {
  try {
    const { data } = await api.patch(`/purchase-orders/${row.id}`, { receive_date: val || null })
    if (data?.data) Object.assign(row, data.data)
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
    load()
  }
}
function exportRows() {
  const columns = [
    { key: 'sku', label: '编码', value: (r: any) => firstItem(r)?.products?.sku || '-' },
    { key: 'code', label: '产品编码', value: (r: any) => firstItem(r)?.products?.code || '-' },
    { key: 'name', label: '产品名称', value: (r: any) => firstItem(r)?.products?.name || '-' },
    { key: 'quantity', label: '拿货数量', value: (r: any) => firstItem(r)?.quantity ?? '-' },
    { key: 'receive_date', label: '拿货日期', value: (r: any) => r.receive_date || '-' },
    { key: 'status', label: '状态', value: (r: any) => statusLabel(r.status) },
    { key: 'created_at', label: '创建时间', value: (r: any) => formatDate(r.created_at) },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `采购列表_${todayStr()}.xlsx`)
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
      `确定删除选中的 ${selected.value.length} 个拿货记录吗？此操作不可恢复。`,
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
      await api.delete(`/purchase-orders/${id}`)
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
.prod-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.prod-thumb {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  flex-shrink: 0;
}
.prod-thumb.placeholder {
  background: #f5f7fa;
  color: #909399;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}
.prod-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-box {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px dashed #e4e7ed;
  border-radius: 6px;
  padding: 10px;
  width: 100%;
}
.match-thumb {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  flex-shrink: 0;
}
.match-thumb.placeholder {
  background: #f5f7fa;
  color: #909399;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}
.match-info {
  min-width: 0;
}
.match-name {
  font-weight: 600;
  margin-bottom: 4px;
}
.match-sub {
  color: #909399;
  font-size: 12px;
}
.detail-wrap {
  padding: 4px 0;
}
.flow-note {
  font-size: 12px;
  color: #909399;
  background: rgba(64, 158, 255, 0.08);
  border: 1px solid rgba(64, 158, 255, 0.25);
  border-radius: 6px;
  padding: 8px 10px;
  line-height: 1.7;
  margin-left: 90px;
}
</style>
