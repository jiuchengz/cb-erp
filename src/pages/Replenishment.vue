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
        <el-button v-if="canWrite" type="primary" @click="openCreate">采购新增</el-button>
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
      <el-table-column label="产品编码" width="130" show-overflow-tooltip>
        <template #default="{ row }">{{ firstItemCode(row) }}</template>
      </el-table-column>
      <el-table-column label="图片" width="70">
        <template #default="{ row }">
          <el-image
            v-if="firstItemImage(row)"
            :src="firstItemImage(row)"
            :preview-src-list="[firstItemImage(row)]"
            preview-teleported
            fit="cover"
            class="product-img"
          />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="产品名称" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{ firstItemName(row) }}</template>
      </el-table-column>
      <el-table-column label="仓库" min-width="140">
        <template #default="{ row }">{{ warehouseName(row.warehouse_id) }}</template>
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
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="170">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canWrite" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="canWrite" link type="danger" @click="removeOne(row)">删除</el-button>
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

    <el-dialog v-model="createVisible" title="采购新增" width="620px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="产品编码" required>
          <el-select v-model="form.product_id" filterable placeholder="输入产品编码搜索" style="width: 100%">
            <el-option v-for="p in products" :key="p.id" :label="p.code || p.sku" :value="p.id">
              <span style="float: left">{{ p.code || p.sku }}</span>
              <span style="float: right; color: #909399; font-size: 12px">{{ p.name }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item v-if="selectedProduct" label="产品图片">
          <el-image
            :src="selectedProduct.image_text"
            :preview-src-list="[selectedProduct.image_text]"
            preview-teleported
            fit="cover"
            style="width: 48px; height: 48px; border-radius: 4px; border: 1px solid #ebeef5"
          />
        </el-form-item>
        <el-form-item label="产品名称">
          <span>{{ selectedProduct?.name || '-' }}</span>
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="form.warehouse_id" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="补货数量" required>
          <el-input-number v-model="form.quantity" :min="1" :precision="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="补货时间">
          <el-date-picker v-model="form.replenishment_time" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑补货单" width="620px" destroy-on-close>
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="产品" required>
          <el-select v-model="editForm.product_id" filterable placeholder="选择产品" style="width: 100%">
            <el-option v-for="p in products" :key="p.id" :label="`${p.code || p.sku} - ${p.name}`" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="editForm.warehouse_id" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="补货数量" required>
          <el-input-number v-model="editForm.quantity" :min="1" :precision="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="补货时间">
          <el-date-picker v-model="editForm.replenishment_time" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
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

const statusOptions = [
  { label: '采购中', value: 'PROCESSING' },
  { label: '取消采购', value: 'CANCELLED' },
  { label: '已完成', value: 'COMPLETED' },
]

// 采购中兼容存量 DRAFT/SUBMITTED/APPROVED
const statusMap: Record<string, { label: string; type: string }> = {
  DRAFT: { label: '采购中', type: 'warning' },
  SUBMITTED: { label: '采购中', type: 'warning' },
  APPROVED: { label: '采购中', type: 'warning' },
  PROCESSING: { label: '采购中', type: 'warning' },
  CANCELLED: { label: '取消采购', type: 'danger' },
  COMPLETED: { label: '已完成', type: 'success' },
}

function statusLabel(s: string) {
  return statusMap[s]?.label || s
}
function statusType(s: string) {
  return statusMap[s]?.type || 'info'
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
// 产品列：产品编码 - 产品名称（多条明细时取第一条）
function firstItemLabel(row: any) {
  const items = orderItems(row)
  if (items.length) {
    const it = items[0]
    if (it.products) {
      return `${it.products.code || it.products.sku || ''} - ${it.products.name}`
    }
    return it.product_id || ''
  }
  return ''
}
// 产品编码：取第一条明细的产品编码
function firstItemCode(row: any) {
  const items = orderItems(row)
  if (items.length && items[0].products) {
    return items[0].products.code || items[0].products.sku || ''
  }
  return ''
}
// 产品名称：取第一条明细的产品名称
function firstItemName(row: any) {
  const items = orderItems(row)
  if (items.length && items[0].products) {
    return items[0].products.name || ''
  }
  return ''
}
// 产品图片：取第一条明细的产品图片
function firstItemImage(row: any) {
  const items = orderItems(row)
  if (items.length && items[0].products?.image_text) {
    return items[0].products.image_text
  }
  return ''
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
  replenishment_time: '',
})

// 弹窗中当前选中的产品（自动带出名称、图片）
const selectedProduct = computed(() => products.value.find((p) => p.id === form.product_id))

// 仓库默认：优先名称含「国内」的仓库，否则取第一个
function defaultWarehouseId() {
  const domestic = warehouses.value.find((w) => /国内/.test(w.name))
  return domestic?.id || warehouses.value[0]?.id || ''
}

function openCreate() {
  form.product_id = ''
  form.warehouse_id = defaultWarehouseId()
  form.quantity = 1
  form.replenishment_time = ''
  createVisible.value = true
}

async function save() {
  if (!form.product_id || !form.warehouse_id) {
    ElMessage.warning('请选择产品编码和仓库')
    return
  }
  saving.value = true
  try {
    await api.post('/replenishment', {
      order_no: autoNo('RPL', Math.floor(Math.random() * 900) + 100),
      warehouse_id: form.warehouse_id,
      replenishment_time: form.replenishment_time || null,
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

const editVisible = ref(false)
const editForm = reactive({
  id: '',
  product_id: '',
  warehouse_id: '',
  quantity: 1,
  replenishment_time: '',
})

function openEdit(row: any) {
  const items = orderItems(row)
  const first = items[0]
  editForm.id = row.id
  editForm.product_id = first?.product_id ?? ''
  editForm.warehouse_id = row.warehouse_id ?? ''
  editForm.quantity = Number(first?.quantity ?? row.replenish_qty ?? 1)
  editForm.replenishment_time = row.replenishment_time || ''
  editVisible.value = true
}

async function saveEdit() {
  if (!editForm.id || !editForm.product_id || !editForm.warehouse_id) {
    ElMessage.warning('请选择产品和仓库')
    return
  }
  saving.value = true
  try {
    await api.patch(`/replenishment/${editForm.id}`, {
      warehouse_id: editForm.warehouse_id,
      replenish_qty: editForm.quantity,
      replenishment_time: editForm.replenishment_time || null,
      items: [{ product_id: editForm.product_id, quantity: editForm.quantity }],
    })
    ElMessage.success('已保存')
    editVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function removeOne(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除补货单「${row.order_no}」吗？此操作不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/replenishment/${row.id}`)
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

// 内联编辑：失焦/回车后 PATCH /replenishment/[id] 保存
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
    { key: 'replenishment_time', label: '补货时间', value: (r: any) => r.replenishment_time || '-' },
    { key: 'product', label: '产品', value: (r: any) => firstItemLabel(r) },
    { key: 'warehouse_id', label: '仓库', value: (r: any) => warehouseName(r.warehouse_id) },
    { key: 'replenish_qty', label: '补货数量', value: (r: any) => r.replenish_qty ?? '-' },
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
      { label: '产品编码', sample: 'DLB-001' },
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
      sku: ['产品编码', '商品SKU', 'SKU', '编码', 'code', 'sku'],
      warehouse: ['仓库', '仓库名称', 'warehouse', 'warehouseName'],
      quantity: ['补货数量', '数量', 'quantity', 'qty'],
    })
    if (col.sku === undefined || col.warehouse === undefined || col.quantity === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"产品编码"、"仓库"和"补货数量"列')
      return
    }
    const skuMap: Record<string, any> = {}
    let page = 1
    for (;;) {
      const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
      ;(data.data ?? []).forEach((p: any) => {
        if (p.code) skuMap[p.code] = p
        if (p.sku) skuMap[p.sku] = p
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
        failures.push(`第${lineNo}行：产品编码为空`)
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
        failures.push(`第${lineNo}行：编码「${sku}」未匹配到产品`)
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
.product-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.product-img {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
}
.product-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
