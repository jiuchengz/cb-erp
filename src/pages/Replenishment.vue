<template>
  <div class="page">
    <div class="page-header">
      <h2>补货管理</h2>
      <div>
        <el-button v-if="canWrite" @click="downloadTpl">下载模板</el-button>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量新增</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增补货建议</el-button>
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
      <el-table-column label="商品" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ firstItemLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="仓库" min-width="140">
        <template #default="{ row }">{{ warehouseName(row.warehouse_id) }}</template>
      </el-table-column>
      <el-table-column label="明细" min-width="140">
        <template #default="{ row }">{{ itemSummary(row) }}</template>
      </el-table-column>
      <el-table-column label="补货数量" width="150" align="right">
        <template #default="{ row }">
          <el-input-number
            v-if="canWrite"
            v-model="row.replenish_qty"
            :min="0"
            :precision="0"
            size="small"
            controls-position="right"
            style="width: 120px"
            @change="(v: any) => updateField(row, 'replenish_qty', v)"
          />
          <span v-else>{{ row.replenish_qty ?? '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="补货时间" width="170">
        <template #default="{ row }">
          <el-date-picker
            v-if="canWrite"
            v-model="row.replenishment_time"
            type="date"
            value-format="YYYY-MM-DD"
            size="small"
            placeholder="选择日期"
            style="width: 140px"
            @change="(v: any) => updateField(row, 'replenishment_time', v)"
          />
          <span v-else>{{ row.replenishment_time || '-' }}</span>
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

    <el-dialog v-model="createVisible" title="新增补货建议" width="620px" destroy-on-close>
      <el-form :model="form" label-width="110px">
        <el-form-item label="商品" required>
          <el-select v-model="form.product_id" filterable placeholder="选择商品" style="width: 100%">
            <el-option v-for="p in products" :key="p.id" :label="`${p.sku} - ${p.name}`" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="form.warehouse_id" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="建议补货量" required>
          <el-input-number v-model="form.quantity" :min="1" :precision="0" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="补货建议详情" width="560px">
      <el-descriptions v-if="detail" :column="1" border>
        <el-descriptions-item label="商品">
          {{ firstItemLabel(detail) }}
        </el-descriptions-item>
        <el-descriptions-item label="仓库">{{ warehouseName(detail.warehouse_id) }}</el-descriptions-item>
        <el-descriptions-item label="补货明细">{{ itemSummary(detail) }}</el-descriptions-item>
        <el-descriptions-item label="补货数量">{{ detail.replenish_qty ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="补货时间">{{ detail.replenishment_time || '-' }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="detail" :data="detail.replenishment_order_items || []" border stripe size="small" style="margin-top: 12px">
        <el-table-column label="商品" min-width="220">
          <template #default="{ row }">
            {{ row.products ? `${row.products.sku} - ${row.products.name}` : row.product_id }}
          </template>
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
const canWrite = computed(() => auth.hasPermission('replenishment.write'))

const REPLENISHMENT_FLOW: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
}

const statusOptions = [
  { label: '草稿', value: 'DRAFT' },
  { label: '已提交', value: 'SUBMITTED' },
  { label: '已审批', value: 'APPROVED' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已驳回', value: 'REJECTED' },
  { label: '已取消', value: 'CANCELLED' },
]

const statusMap: Record<string, { label: string; type: string }> = {
  DRAFT: { label: '草稿', type: 'info' },
  SUBMITTED: { label: '已提交', type: 'primary' },
  APPROVED: { label: '已审批', type: 'primary' },
  COMPLETED: { label: '已完成', type: 'success' },
  REJECTED: { label: '已驳回', type: 'danger' },
  CANCELLED: { label: '已取消', type: 'danger' },
}

function statusLabel(s: string) {
  return statusMap[s]?.label || s
}
function statusType(s: string) {
  return statusMap[s]?.type || 'info'
}
function nextStatuses(s?: string) {
  return (s && REPLENISHMENT_FLOW[s]) || []
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
    const { data } = await api.get('/replenishment', { params: query })
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

function orderItems(row: any): any[] {
  return row?.replenishment_order_items || []
}
function firstItemLabel(row: any) {
  const items = orderItems(row)
  if (items.length) {
    const it = items[0]
    return it.products ? `${it.products.sku} - ${it.products.name}` : it.product_id || ''
  }
  return row?.product_id || ''
}
function itemSummary(row: any) {
  const items = orderItems(row)
  if (!items.length) return ''
  const total = items.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0)
  return `${items.length} 项 · 合计 ${total}`
}
async function loadOptions() {
  try {
    const [prodRes, whRes] = await Promise.all([
      api.get('/products', { params: { page: 1, pageSize: 200 } }),
      api.get('/warehouses'),
    ])
    products.value = prodRes.data.data ?? []
    warehouses.value = (whRes.data.data ?? []).filter((w: any) => w.wh_type === 'domestic')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  product_id: '',
  warehouse_id: '',
  quantity: 1,
})

function openCreate() {
  form.product_id = ''
  form.warehouse_id = ''
  form.quantity = 1
  createVisible.value = true
}

async function save() {
  if (!form.product_id || !form.warehouse_id) {
    ElMessage.warning('请选择商品和仓库')
    return
  }
  saving.value = true
  try {
    await api.post('/replenishment', {
      order_no: autoNo('RPL', Math.floor(Math.random() * 900) + 100),
      warehouse_id: form.warehouse_id,
      items: [{ product_id: form.product_id, quantity: form.quantity }],
    })
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
    const { data } = await api.get(`/replenishment/${id}`)
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
    await api.patch(`/replenishment/${flowRow.value.id}`, { status: flowTarget.value })
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

// 内联编辑：失焦/回车后 PATCH /replenishment/[id] 保存（不触发状态机校验）
const updating = ref(false)
async function updateField(row: any, key: string, val: any) {
  if (updating.value) return
  updating.value = true
  try {
    const payload: any = { [key]: val === null || val === undefined ? null : val }
    const { data } = await api.patch(`/replenishment/${row.id}`, payload)
    if (data?.data) Object.assign(row, data.data)
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
    load()
  } finally {
    updating.value = false
  }
}

const exporting = ref(false)
function exportRows() {
  const columns = [
    { key: 'product_id', label: '商品', value: (r: any) => firstItemLabel(r) },
    { key: 'warehouse_id', label: '仓库', value: (r: any) => warehouseName(r.warehouse_id) },
    { key: 'quantity', label: '明细', value: (r: any) => itemSummary(r) },
    { key: 'replenish_qty', label: '补货数量', value: (r: any) => r.replenish_qty ?? '-' },
    { key: 'replenishment_time', label: '补货时间', value: (r: any) => r.replenishment_time || '-' },
    { key: 'status', label: '状态', value: (r: any) => statusLabel(r.status) },
    { key: 'created_at', label: '创建时间', value: (r: any) => formatDate(r.created_at) },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `补货列表_${todayStr()}.xlsx`)
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

const importing = ref(false)
const importFile = ref<any>(null)

function downloadTpl() {
  downloadTemplate(
    [
      { label: '商品SKU', sample: 'SKU-DLB-001' },
      { label: '仓库', sample: '默认仓库' },
      { label: '补货数量', sample: 10 },
      { label: '补货时间', sample: '2026-08-14' },
      { label: '备注', sample: '' },
    ],
    '补货导入模板',
    '补货批量导入模板.xlsx'
  )
}

function triggerImport() {
  importFile.value?.click()
}

// 批量新增：解析 Excel，按仓库分组一次提交多条明细（对应旧版 batchImportReplenishment）
async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    const { headers, rows } = await readExcelFile(file)
    const col = buildColMap(headers, {
      sku: ['商品SKU', 'SKU', '产品编码', '编码', 'code', 'sku'],
      warehouse: ['仓库', '仓库名称', 'warehouse', 'warehouseName'],
      quantity: ['补货数量', '数量', 'quantity', 'qty'],
    })
    if (col.sku === undefined || col.warehouse === undefined || col.quantity === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"商品SKU"、"仓库"和"补货数量"列')
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
    // 按仓库分组，明细合并到一个补货单
    const groups = new Map<string, { warehouse_id: string; items: { product_id: string; quantity: number }[] }>()
    let autoSeq = 0
    const failures: string[] = []
    rows.forEach((row, idx) => {
      const lineNo = idx + 2
      const sku = cellStr(row, col.sku)
      const whName = cellStr(row, col.warehouse)
      const qty = cellNum(row, col.quantity)
      if (!sku) {
        failures.push(`第${lineNo}行：商品SKU为空`)
        return
      }
      if (!whName) {
        failures.push(`第${lineNo}行：仓库为空`)
        return
      }
      if (qty <= 0) {
        failures.push(`第${lineNo}行：补货数量必须大于 0`)
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
      const key = wh.id
      if (!groups.has(key)) groups.set(key, { warehouse_id: wh.id, items: [] })
      groups.get(key)!.items.push({ product_id: product.id, quantity: qty })
    })
    let ok = 0
    const errLines: string[] = []
    for (const g of groups.values()) {
      // 明细超过 200 条时拆分为多个补货单
      for (let i = 0; i < g.items.length; i += 200) {
        try {
          await api.post('/replenishment', {
            order_no: autoNo('RPL-IMP', ++autoSeq),
            warehouse_id: g.warehouse_id,
            items: g.items.slice(i, i + 200),
          })
          ok++
        } catch (err: any) {
          errLines.push(`仓库「${warehouseName(g.warehouse_id)}」：${err?.response?.data?.error?.message || '创建失败'}`)
        }
      }
    }
    if (failures.length) errLines.push(...failures)
    if (errLines.length) {
      ElMessage.warning(`成功新增 ${ok} 单，失败 ${errLines.length} 条：` + errLines.slice(0, 5).join('；') + (errLines.length > 5 ? ` 等 ${errLines.length} 条` : ''))
    } else {
      ElMessage.success(`成功新增 ${ok} 单`)
    }
    load()
  } catch (err: any) {
    ElMessage.error(err?.message || '批量新增失败')
  } finally {
    importing.value = false
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selected.value.length} 个补货建议吗？此操作不可恢复。`,
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
      await api.delete(`/replenishment/${id}`)
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
</style>
