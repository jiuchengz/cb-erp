<template>
  <div class="page">
    <div class="page-header">
      <h2>销售管理</h2>
      <div>
        <el-button v-if="canWrite" @click="downloadTpl">下载模板</el-button>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量导入</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增销售单</el-button>
        <input ref="importFile" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onImportFile" />
      </div>
    </div>

    <div class="filters">
      <el-input
        v-model="query.keyword"
        placeholder="订单号/链接ID/产品名"
        clearable
        style="width: 240px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 160px" @change="load">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column label="图片" width="70">
        <template #default="{ row }">
          <el-image
            v-if="firstProductImage(row)"
            :src="firstProductImage(row)"
            :preview-src-list="[firstProductImage(row)]"
            preview-teleported
            fit="cover"
            style="width: 42px; height: 42px; border-radius: 4px"
            @error="onImgError"
          />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="order_no" label="订单号" min-width="160" />
      <el-table-column label="链接ID" min-width="110">
        <template #default="{ row }">{{ firstProductLinkId(row) || '-' }}</template>
      </el-table-column>
      <el-table-column label="平台" width="90">
        <template #default="{ row }">{{ row.platform || '-' }}</template>
      </el-table-column>
      <el-table-column label="利润" width="120" align="right">
        <template #default="{ row }">
          <template v-if="orderProfit(row).known">
            <span :style="{ color: orderProfit(row).profit >= 0 ? '#67c23a' : '#f56c6c' }">
              {{ orderProfit(row).profit >= 0 ? '+' : '' }}{{ orderProfit(row).profit.toFixed(2) }}
            </span>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="customer_id" label="客户ID" min-width="160" show-overflow-tooltip />
      <el-table-column prop="currency" label="币种" width="80" />
      <el-table-column prop="total_amount" label="总金额" width="120" align="right" />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="170">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.id)">详情</el-button>
          <el-button v-if="canWrite && nextStatuses(row.status).length" link type="primary" @click="openFlow(row)">
            流转
          </el-button>
          <el-button v-if="canCancel && nextStatuses(row.status).includes('CANCELLED')" link type="danger" @click="openFlow(row, 'CANCELLED')">
            取消
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

    <el-dialog v-model="createVisible" title="新增销售单" width="860px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="订单号" required>
          <el-input v-model="form.order_no" placeholder="唯一订单号" />
        </el-form-item>
        <el-form-item label="币种">
          <el-select v-model="form.currency" style="width: 160px">
            <el-option label="CNY" value="CNY" />
            <el-option label="MXN" value="MXN" />
            <el-option label="USD" value="USD" />
            <el-option label="PHP" value="PHP" />
          </el-select>
        </el-form-item>
        <el-form-item label="客户ID">
          <el-input v-model="form.customer_id" placeholder="可选" />
        </el-form-item>
        <el-form-item label="商品明细" required>
          <div class="items-editor">
            <div v-for="(it, idx) in form.items" :key="idx" class="item-row">
              <el-select v-model="it.product_id" filterable placeholder="商品" style="width: 320px">
                <el-option v-for="p in products" :key="p.id" :label="`${p.sku} - ${p.name}`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.quantity" :min="1" :precision="0" placeholder="数量" style="width: 120px" />
              <el-input-number v-model="it.unit_price" :min="0" :precision="2" placeholder="单价" style="width: 140px" />
              <el-input-number v-model="it.discount" :min="0" :precision="2" placeholder="折扣" style="width: 140px" />
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

    <el-dialog v-model="detailVisible" title="销售单详情" width="760px">
      <el-descriptions v-if="detail" :column="2" border>
        <el-descriptions-item label="订单号">{{ detail.order_no }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        <el-descriptions-item label="币种">{{ detail.currency }}</el-descriptions-item>
        <el-descriptions-item label="总金额">{{ detail.total_amount }}</el-descriptions-item>
        <el-descriptions-item label="客户ID" :span="2">{{ detail.customer_id || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间" :span="2">{{ formatDate(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="detail" :data="detail.sales_order_items || []" border stripe size="small" style="margin-top: 12px">
        <el-table-column prop="sku" label="SKU" min-width="140" />
        <el-table-column prop="quantity" label="数量" width="90" align="right" />
        <el-table-column prop="unit_price" label="单价" width="110" align="right" />
        <el-table-column prop="discount" label="折扣" width="100" align="right" />
        <el-table-column prop="subtotal" label="小计" width="110" align="right" />
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
const canWrite = computed(() => auth.hasPermission('sales.write'))
const canCancel = computed(() => auth.hasPermission('sales.cancel'))

const SALES_FLOW: Record<string, string[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
}

const statusOptions = [
  { label: '草稿', value: 'DRAFT' },
  { label: '已确认', value: 'CONFIRMED' },
  { label: '已付款', value: 'PAID' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '已发货', value: 'SHIPPED' },
  { label: '已送达', value: 'DELIVERED' },
  { label: '已取消', value: 'CANCELLED' },
]

const statusMap: Record<string, { label: string; type: string }> = {
  DRAFT: { label: '草稿', type: 'info' },
  CONFIRMED: { label: '已确认', type: 'primary' },
  PAID: { label: '已付款', type: 'success' },
  PROCESSING: { label: '处理中', type: 'warning' },
  SHIPPED: { label: '已发货', type: 'primary' },
  DELIVERED: { label: '已送达', type: 'success' },
  CANCELLED: { label: '已取消', type: 'danger' },
}

function statusLabel(s: string) {
  return statusMap[s]?.label || s
}
function statusType(s: string) {
  return statusMap[s]?.type || 'info'
}
function nextStatuses(s?: string) {
  return (s && SALES_FLOW[s]) || []
}
function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

function firstProductImage(row: any): string {
  const it = (row?.sales_order_items || [])[0]
  const img = it?.products?.image_text
  return img && isImageUrl(img) ? img : ''
}
function firstProductLinkId(row: any): string {
  const it = (row?.sales_order_items || [])[0]
  return it?.products?.link_id || ''
}
function isImageUrl(v: string): boolean {
  return typeof v === 'string' && /^(https?:\/\/|\/|data:image\/)/i.test(v)
}
function onImgError(e: Event) {
  ;(e.target as HTMLImageElement).style.visibility = 'hidden'
}
// 利润 = 明细小计 - 数量×采购成本；任一明细缺成本则 known=false（显示 '-'）
function orderProfit(row: any): { profit: number; known: boolean } {
  const items = row?.sales_order_items || []
  if (!items.length) return { profit: 0, known: false }
  let profit = 0
  for (const it of items) {
    const cost = it?.products?.purchase_cost
    if (cost === undefined || cost === null || cost === '') return { profit: 0, known: false }
    profit += Number(it.subtotal || 0) - Number(it.quantity || 0) * Number(cost)
  }
  return { profit, known: true }
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, keyword: '', status: '' })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/sales', { params: query })
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
async function loadProducts() {
  try {
    const { data } = await api.get('/products', { params: { page: 1, pageSize: 200 } })
    products.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载商品失败')
  }
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  order_no: '',
  customer_id: '',
  currency: 'CNY',
  items: [] as any[],
})

function addItem() {
  form.items.push({ product_id: '', quantity: 1, unit_price: 0, discount: 0 })
}
function removeItem(idx: number) {
  form.items.splice(idx, 1)
}

function openCreate() {
  form.order_no = ''
  form.customer_id = ''
  form.currency = 'CNY'
  form.items = []
  addItem()
  createVisible.value = true
}

async function save() {
  if (!form.order_no.trim()) {
    ElMessage.warning('请填写订单号')
    return
  }
  const items = form.items.filter((it) => it.product_id)
  if (!items.length) {
    ElMessage.warning('请至少添加一条商品明细')
    return
  }
  const payload: any = {
    order_no: form.order_no,
    currency: form.currency,
    items: items.map((it) => ({
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount: it.discount,
    })),
  }
  if (form.customer_id.trim()) payload.customer_id = form.customer_id.trim()
  saving.value = true
  try {
    await api.post('/sales', payload)
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
    const { data } = await api.get(`/sales/${id}`)
    detail.value = data.data
    detailVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载详情失败')
  }
}

const flowVisible = ref(false)
const flowRow = ref<any>(null)
const flowTarget = ref('')
function openFlow(row: any, preset?: string) {
  flowRow.value = row
  const next = nextStatuses(row.status)
  flowTarget.value = preset && next.includes(preset) ? preset : next[0] ?? ''
  flowVisible.value = true
}

async function submitFlow() {
  if (!flowRow.value || !flowTarget.value) return
  saving.value = true
  try {
    await api.patch(`/sales/${flowRow.value.id}`, { status: flowTarget.value })
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
      { label: '订单号', sample: 'MLM-SALE-IMP001' },
      { label: '商品SKU', sample: 'SKU-DLB-001' },
      { label: '数量', sample: 2 },
      { label: '单价', sample: 329 },
      { label: '折扣', sample: 0 },
      { label: '销售日期', sample: '2026-08-05' },
      { label: '平台', sample: 'ML' },
      { label: '客户ID', sample: '' },
    ],
    '销售导入模板',
    '销售批量导入模板.xlsx'
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
      order_no: ['订单号', 'order_no', 'orderNo'],
      sku: ['商品SKU', 'SKU', '产品编号', '编码', '链接ID', 'code', 'linkId', 'sku'],
      quantity: ['数量', 'quantity', 'qty'],
      unit_price: ['单价', 'price', 'unit_price'],
      discount: ['折扣', 'discount'],
      customer_id: ['客户ID', 'customer_id', 'customerId'],
    })
    if (col.sku === undefined || col.quantity === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"商品SKU"和"数量"列')
      return
    }
    // 拉取全量商品建立 SKU 映射
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
    // 按订单号分组合并明细
    const groups = new Map<string, { order_no: string; customer_id: string; rows: any[][] }>()
    let autoSeq = 0
    const failures: string[] = []
    rows.forEach((row, idx) => {
      const lineNo = idx + 2
      const sku = cellStr(row, col.sku)
      const qty = cellNum(row, col.quantity)
      if (!sku) {
        failures.push(`第${lineNo}行：商品SKU为空`)
        return
      }
      if (qty <= 0) {
        failures.push(`第${lineNo}行：数量必须大于 0`)
        return
      }
      const product = skuMap[sku]
      if (!product) {
        failures.push(`第${lineNo}行：SKU「${sku}」未匹配到商品`)
        return
      }
      const rawNo = cellStr(row, col.order_no)
      const orderNo = rawNo || autoNo('SALE-IMP', ++autoSeq)
      const key = orderNo
      if (!groups.has(key)) {
        groups.set(key, { order_no: orderNo, customer_id: cellStr(row, col.customer_id), rows: [] })
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
            discount: col.discount !== undefined ? cellNum(row, col.discount) : undefined,
          }
        })
        .filter((it) => it.quantity > 0)
      // 超过 200 条明细时按 200 拆分
      for (let i = 0; i < items.length; i += 200) {
        const payload: any = { order_no: g.order_no, items: items.slice(i, i + 200) }
        if (g.customer_id) payload.customer_id = g.customer_id
        try {
          await api.post('/sales', payload)
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
function exportRows() {
  const columns = [
    { key: 'order_no', label: '订单号' },
    { key: 'link_id', label: '链接ID', value: (r: any) => firstProductLinkId(r) },
    { key: 'platform', label: '平台', value: (r: any) => r.platform || '-' },
    { key: 'profit', label: '利润', value: (r: any) => (orderProfit(r).known ? orderProfit(r).profit.toFixed(2) : '-') },
    { key: 'customer_id', label: '客户ID' },
    { key: 'currency', label: '币种' },
    { key: 'total_amount', label: '总金额' },
    { key: 'status', label: '状态', value: (r: any) => statusLabel(r.status) },
    { key: 'created_at', label: '创建时间', value: (r: any) => formatDate(r.created_at) },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `销售列表_${todayStr()}.xlsx`)
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
      `确定删除选中的 ${selected.value.length} 个销售单吗？此操作不可恢复。`,
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
      await api.delete(`/sales/${id}`)
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
  loadProducts()
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
