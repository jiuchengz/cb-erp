<template>
  <div class="page">
    <div class="page-header">
      <h2>采购管理</h2>
      <div>
        <el-button v-if="canWrite" @click="downloadTpl">下载模板</el-button>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量导入</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增采购单</el-button>
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
      <el-table-column prop="order_no" label="采购单号" min-width="160" />
      <el-table-column prop="supplier" label="供应商" min-width="140" show-overflow-tooltip />
      <el-table-column label="仓库" min-width="140">
        <template #default="{ row }">{{ warehouseName(row.warehouse_id) }}</template>
      </el-table-column>
      <el-table-column prop="total_amount" label="总金额" width="120" align="right" />
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

    <el-dialog v-model="createVisible" title="新增采购单" width="860px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="采购单号" required>
          <el-input v-model="form.order_no" placeholder="唯一采购单号" />
        </el-form-item>
        <el-form-item label="供应商">
          <el-input v-model="form.supplier" placeholder="可选" />
        </el-form-item>
        <el-form-item label="拿货日期">
          <el-date-picker
            v-model="form.receive_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="form.warehouse_id" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="商品明细" required>
          <div class="items-editor">
            <div v-for="(it, idx) in form.items" :key="idx" class="item-row">
              <el-select v-model="it.product_id" filterable placeholder="商品" style="width: 300px">
                <el-option v-for="p in products" :key="p.id" :label="`${p.sku} - ${p.name}`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.quantity" :min="1" :precision="0" placeholder="数量" style="width: 130px" />
              <el-input-number v-model="it.unit_price" :min="0" :precision="2" placeholder="单价" style="width: 140px" />
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

    <el-dialog v-model="detailVisible" title="采购单详情" width="760px">
      <el-descriptions v-if="detail" :column="2" border>
        <el-descriptions-item label="采购单号">{{ detail.order_no }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{ detail.supplier || '-' }}</el-descriptions-item>
        <el-descriptions-item label="仓库">{{ warehouseName(detail.warehouse_id) }}</el-descriptions-item>
        <el-descriptions-item label="拿货日期">{{ detail.receive_date || '-' }}</el-descriptions-item>
        <el-descriptions-item label="总金额">{{ detail.total_amount }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="detail" :data="detail.purchase_order_items || []" border stripe size="small" style="margin-top: 12px">
        <el-table-column prop="product_id" label="商品ID" min-width="240" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="90" align="right" />
        <el-table-column prop="received_quantity" label="实收数量" width="90" align="right" />
        <el-table-column prop="unit_price" label="单价" width="100" align="right" />
        <el-table-column prop="subtotal" label="小计" width="100" align="right" />
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
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum, autoNo } from '../utils/import'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('procurement.write'))

const PURCHASE_FLOW: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PURCHASING', 'CANCELLED'],
  PURCHASING: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
  PARTIAL: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
}

const statusOptions = [
  { label: '草稿', value: 'DRAFT' },
  { label: '已提交', value: 'SUBMITTED' },
  { label: '已审批', value: 'APPROVED' },
  { label: '采购中', value: 'PURCHASING' },
  { label: '部分收货', value: 'PARTIAL' },
  { label: '已收货', value: 'RECEIVED' },
  { label: '已取消', value: 'CANCELLED' },
]

const statusMap: Record<string, { label: string; type: string }> = {
  DRAFT: { label: '草稿', type: 'info' },
  SUBMITTED: { label: '已提交', type: 'primary' },
  APPROVED: { label: '已审批', type: 'primary' },
  PURCHASING: { label: '采购中', type: 'warning' },
  PARTIAL: { label: '部分收货', type: 'warning' },
  RECEIVED: { label: '已收货', type: 'success' },
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
const warehouses = ref<any[]>([])
function warehouseName(id: string) {
  return warehouses.value.find((w) => w.id === id)?.name || id
}
async function loadOptions() {
  try {
    const [prodRes, whRes] = await Promise.all([
      api.get('/products', { params: { page: 1, pageSize: 200 } }),
      api.get('/warehouses'),
    ])
    products.value = prodRes.data.data ?? []
    warehouses.value = whRes.data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  order_no: '',
  supplier: '',
  warehouse_id: '',
  receive_date: '',
  items: [] as any[],
})

function addItem() {
  form.items.push({ product_id: '', quantity: 1, unit_price: 0 })
}
function removeItem(idx: number) {
  form.items.splice(idx, 1)
}

function openCreate() {
  form.order_no = ''
  form.supplier = ''
  form.warehouse_id = ''
  form.receive_date = ''
  form.items = []
  addItem()
  createVisible.value = true
}

async function save() {
  if (!form.order_no.trim()) {
    ElMessage.warning('请填写采购单号')
    return
  }
  if (!form.warehouse_id) {
    ElMessage.warning('请选择仓库')
    return
  }
  const items = form.items.filter((it) => it.product_id)
  if (!items.length) {
    ElMessage.warning('请至少添加一条商品明细')
    return
  }
  const payload: any = {
    order_no: form.order_no,
    warehouse_id: form.warehouse_id,
    items: items.map((it) => ({
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price: it.unit_price,
    })),
  }
  if (form.supplier.trim()) payload.supplier = form.supplier.trim()
  if (form.receive_date) payload.receive_date = form.receive_date
  saving.value = true
  try {
    await api.post('/purchase-orders', payload)
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

const importing = ref(false)
const importFile = ref<any>(null)

function downloadTpl() {
  downloadTemplate(
    [
      { label: '采购单号', sample: 'PO-IMP001' },
      { label: '供应商', sample: '示例供应商' },
      { label: '仓库', sample: '默认仓库' },
      { label: '商品SKU', sample: 'SKU-DLB-001' },
      { label: '数量', sample: 5 },
      { label: '单价', sample: 199 },
    ],
    '采购导入模板',
    '采购批量导入模板.xlsx'
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
      order_no: ['采购单号', '订单号', 'order_no', 'orderNo'],
      supplier: ['供应商', 'supplier'],
      warehouse: ['仓库', '仓库名称', 'warehouse', 'warehouseName'],
      sku: ['商品SKU', 'SKU', '产品编码', '编码', 'code', 'sku'],
      quantity: ['数量', 'quantity', 'qty'],
      unit_price: ['单价', 'price', 'unit_price'],
    })
    if (col.sku === undefined || col.quantity === undefined || col.warehouse === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"商品SKU"、"数量"和"仓库"列')
      return
    }
    const skuMap: Record<string, any> = {}
    let page = 1
    for (;;) {
      const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
      ;(data.data ?? []).forEach((p: any) => {
        if (p.sku) skuMap[p.sku] = p
        if (p.code) skuMap[p.code] = p
      })
      if (page * 200 >= (data.total ?? 0)) break
      page++
    }
    const whNameMap: Record<string, any> = {}
    warehouses.value.forEach((w) => {
      whNameMap[w.name] = w
      whNameMap[w.id] = w
    })
    const groups = new Map<string, { order_no: string; supplier: string; warehouse_id: string; rows: any[][] }>()
    let autoSeq = 0
    const failures: string[] = []
    rows.forEach((row, idx) => {
      const lineNo = idx + 2
      const sku = cellStr(row, col.sku)
      const qty = cellNum(row, col.quantity)
      const whName = cellStr(row, col.warehouse)
      if (!sku) {
        failures.push(`第${lineNo}行：商品SKU为空`)
        return
      }
      if (qty <= 0) {
        failures.push(`第${lineNo}行：数量必须大于 0`)
        return
      }
      if (!whName) {
        failures.push(`第${lineNo}行：仓库为空`)
        return
      }
      const product = skuMap[sku]
      if (!product) {
        failures.push(`第${lineNo}行：SKU「${sku}」未匹配到商品`)
        return
      }
      const wh = whNameMap[whName]
      if (!wh) {
        failures.push(`第${lineNo}行：仓库「${whName}」未匹配到仓库`)
        return
      }
      const rawNo = cellStr(row, col.order_no)
      const orderNo = rawNo || autoNo('PO-IMP', ++autoSeq)
      const key = `${orderNo}|${wh.id}`
      if (!groups.has(key)) {
        groups.set(key, { order_no: orderNo, supplier: cellStr(row, col.supplier), warehouse_id: wh.id, rows: [] })
      }
      groups.get(key)!.rows.push(row)
    })
    let ok = 0
    const errLines: string[] = []
    for (const g of groups.values()) {
      const items = g.rows
        .map((row) => {
          const product = skuMap[cellStr(row, col.sku)]
          return {
            product_id: product.id,
            quantity: cellNum(row, col.quantity),
            unit_price: col.unit_price !== undefined ? cellNum(row, col.unit_price) : undefined,
          }
        })
        .filter((it) => it.quantity > 0)
      for (let i = 0; i < items.length; i += 200) {
        const payload: any = { order_no: g.order_no, warehouse_id: g.warehouse_id, items: items.slice(i, i + 200) }
        if (g.supplier) payload.supplier = g.supplier
        try {
          await api.post('/purchase-orders', payload)
          ok++
        } catch (err: any) {
          errLines.push(`单号${g.order_no}：${err?.response?.data?.error?.message || '创建失败'}`)
        }
      }
    }
    if (failures.length) errLines.push(...failures)
    if (errLines.length) {
      ElMessage.warning(`成功导入 ${ok} 单，失败 ${errLines.length} 条：` + errLines.slice(0, 5).join('；') + (errLines.length > 5 ? ` 等 ${errLines.length} 条` : ''))
    } else {
      ElMessage.success(`成功导入 ${ok} 单`)
    }
    load()
  } catch (err: any) {
    ElMessage.error(err?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

const exporting = ref(false)
// 拿货日期内联编辑：PATCH /purchase-orders/[id]
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
    { key: 'order_no', label: '采购单号' },
    { key: 'supplier', label: '供应商' },
    { key: 'warehouse_id', label: '仓库', value: (r: any) => warehouseName(r.warehouse_id) },
    { key: 'receive_date', label: '拿货日期', value: (r: any) => r.receive_date || '-' },
    { key: 'total_amount', label: '总金额' },
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
      `确定删除选中的 ${selected.value.length} 个采购单吗？此操作不可恢复。`,
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
