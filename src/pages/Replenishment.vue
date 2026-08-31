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

    <div class="table-wrap">
    <el-table :resizable="false" v-loading="loading" :data="rows" border stripe @selection-change="onSelectionChange" height="100%">
      <el-table-column type="selection" width="46" />
      <el-table-column label="补货时间" width="170">
        <template #default="{ row }">{{ row.replenishment_time || '-' }}</template>
      </el-table-column>
      <el-table-column label="产品条码" min-width="140">
        <template #default="{ row }">
          <span class="product-label">{{ firstItem(row)?.code || firstItem(row)?.sku || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="图片" width="90">
        <template #default="{ row }">
          <el-image
            v-if="firstItem(row)?.image_text"
            :src="firstItem(row).image_text"
            :preview-src-list="[firstItem(row).image_text]"
            fit="cover"
            lazy
            style="width: 48px; height: 48px; border-radius: 4px; display: block"
          />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="名称" min-width="220">
        <template #default="{ row }">{{ firstItem(row)?.name || '-' }}</template>
      </el-table-column>
      <el-table-column label="仓库" min-width="140">
        <template #default="{ row }">{{ warehouseName(row.warehouse_id) }}</template>
      </el-table-column>
      <el-table-column label="补货数量" width="150" align="right">
        <template #default="{ row }">{{ row.replenish_qty ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="到货时间" width="130">
        <template #default="{ row }">{{ row.arrival_date || '-' }}</template>
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
    </div>

    <div class="pagination-bar">
      <span class="pagination-total">当前页共 {{ rows.length }} 条</span>
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        @current-change="load"
      />
      <el-select v-model="query.pageSize" class="page-size-select" @change="onSizeChange">
        <el-option label="100条/页" :value="100" />
        <el-option label="200条/页" :value="200" />
        <el-option label="500条/页" :value="500" />
      </el-select>
    </div>

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
import { formatDateTime as sysFormatDateTime } from '../utils/system'
import { useAuthStore } from '../stores/auth'
import { buildExportPayload, exportViaServer, todayStr } from '../utils/export'
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum, cellDateStr } from '../utils/import'

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
  return sysFormatDateTime(v)
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 200, status: '' })

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
// 产品列：返回首条明细的产品对象（条码/图片/名称分列展示）
function firstItem(row: any) {
  const items = orderItems(row)
  if (items.length) {
    return items[0].products || null
  }
  return null
}
// 补货时间标准化：2026-8-31 / 2026-8-1 -> 2026-08-31 / 2026-08-01；非日期格式原样返回
function normalizeTime(s: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((s || '').trim())
  if (!m) return (s || '').trim()
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}
async function loadAllProducts(): Promise<any[]> {
  const all: any[] = []
  let page = 1
  const pageSize = 200
  while (true) {
    const res = await api.get('/products', { params: { page, pageSize } })
    const list = res.data.data ?? []
    all.push(...list)
    const total = res.data.total ?? 0
    if (all.length >= total || list.length < pageSize) break
    page++
  }
  return all
}
async function loadOptions() {
  try {
    const whRes = await api.get('/warehouses')
    products.value = await loadAllProducts()
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
    const delLabel = row.order_no || firstItem(row)?.code || firstItem(row)?.sku || '无单号'
    await ElMessageBox.confirm(`确定删除补货单「${delLabel}」吗？此操作不可恢复。`, '删除确认', {
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

const exporting = ref(false)
async function exportRows() {
  const columns = [
    { key: 'replenishment_time', label: '补货时间', value: (r: any) => r.replenishment_time || '-' },
    { key: 'product', label: '产品', value: (r: any) => { const p = firstItem(r); return p ? `${p.code || p.sku || ''} · ${p.name || ''}` : '' } },
    { key: 'warehouse_id', label: '仓库', value: (r: any) => warehouseName(r.warehouse_id) },
    { key: 'replenish_qty', label: '补货数量', value: (r: any) => r.replenish_qty ?? '-' },
    { key: 'status', label: '状态', value: (r: any) => statusLabel(r.status) },
    { key: 'created_at', label: '创建时间', value: (r: any) => formatDate(r.created_at) },
  ]
  exporting.value = true
  try {
    await exportViaServer(`补货列表_${todayStr()}.xlsx`, buildExportPayload({ rows: rows.value, columns }))
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
      { label: '产品编码', sample: 'DLB002' },
      { label: '仓库', sample: 'CN-9店佛山仓' },
      { label: '补货数量', sample: 50 },
      { label: '补货时间', sample: '2026-08-31' },
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
      time: ['补货时间', '时间', 'replenishment_time', 'time'],
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
    // 每个产品（Excel 每行）单独生成一条补货记录，不按仓库合并明细；
    // 完全重复行（编码+仓库+数量+时间全相同，时间为空视为相同）只保留首次出现的行，其余跳过
    const pending: { wh: any; product: any; qty: number; lineNo: number; time: string }[] = []
    const seen = new Map<string, number>()
    const dupGroups: { keepLine: number; skipLines: number[] }[] = []
    const failures: string[] = []
    rows.forEach((row, idx) => {
      const lineNo = idx + 2
      const sku = cellStr(row, col.sku)
      const whName = cellStr(row, col.warehouse)
      const qty = cellNum(row, col.quantity)
      const time = col.time === undefined ? '' : cellDateStr(row, col.time)
      // 补货时间标准化为 yyyy-MM-dd（兼容 Date 对象/序列号/2026-8-31 文本写法）
      const normTime = normalizeTime(time)
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
      const key = `${sku}|${wh.id}|${qty}|${normTime}`
      const firstLine = seen.get(key)
      if (firstLine !== undefined) {
        const g = dupGroups.find((x) => x.keepLine === firstLine)
        if (g) g.skipLines.push(lineNo)
        else dupGroups.push({ keepLine: firstLine, skipLines: [lineNo] })
        return
      }
      seen.set(key, lineNo)
      pending.push({ wh, product, qty, lineNo, time: normTime })
    })
    let ok = 0
    const errLines: string[] = []
    for (const it of pending) {
      try {
        // Excel 每行一条独立补货记录，列表每个产品单独一行
        await api.post('/replenishment', {
          warehouse_id: it.wh.id,
          replenishment_time: it.time || null,
          items: [{ product_id: it.product.id, quantity: it.qty }],
        })
        ok++
      } catch (err: any) {
        errLines.push(`第${it.lineNo}行（${it.wh.name || it.wh.id}）：${err?.response?.data?.error?.message || '创建失败'}`)
      }
    }
    if (failures.length) errLines.push(...failures)
    // 重复行提示：哪些行重复、保留哪一行、共跳过几条
    let dupSkipped = 0
    const dupMsgs: string[] = []
    for (const g of dupGroups) {
      dupSkipped += g.skipLines.length
      dupMsgs.push(`第 ${g.skipLines.join('、')} 行内容重复，保留第 ${g.keepLine} 行，已跳过`)
    }
    const summary = [`成功创建 ${ok} 条`]
    if (dupSkipped) summary.push(`跳过重复 ${dupSkipped} 条`)
    if (errLines.length) summary.push(`失败 ${errLines.length} 条`)
    if (errLines.length || dupSkipped) {
      const detail = [...dupMsgs.slice(0, 5), ...errLines.slice(0, 5)]
      let more = 0
      if (dupMsgs.length > 5) more += dupMsgs.length - 5
      if (errLines.length > 5) more += errLines.length - 5
      ElMessage.warning(summary.join('，') + (detail.length ? '：' + detail.join('；') : '') + (more ? ` 等 ${more} 条` : ''))
    } else {
      ElMessage.success(summary.join('，'))
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
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
}
.table-wrap :deep(.el-table) {
  flex: 1;
  min-height: 0;
}
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
.product-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
