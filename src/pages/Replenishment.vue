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

    <el-card v-if="canRead" shadow="never" class="unarrived-card" :class="{ 'is-collapsed': !statsExpanded }">
      <template #header>
        <div class="unarrived-header" @click="statsExpanded = !statsExpanded">
          <span class="unarrived-title">未到货统计</span>
          <div class="unarrived-header-right">
            <span class="unarrived-total">未到货总数 <b>{{ fmtNum(unarrived.all.total_qty) }}</b> 件</span>
            <span class="unarrived-hint">{{ unarrivedScopeText }}</span>
            <el-button link type="primary" :loading="statsLoading" @click.stop="loadStats">刷新</el-button>
            <el-button link type="primary" @click.stop="statsExpanded = !statsExpanded">
              {{ statsExpanded ? '收起' : '展开' }}
            </el-button>
          </div>
        </div>
      </template>

      <template v-if="statsExpanded">
      <!-- 卡片汇总（全部统计日口径） -->
      <div class="unarrived-kpis" v-loading="statsLoading">
        <div class="unarrived-kpi">
          <div class="kpi-label">未到货总数量</div>
          <div class="kpi-value">{{ fmtNum(unarrived.all.total_qty) }} <small>件</small></div>
          <div class="kpi-sub">全部 {{ fmtNum(unarrived.all.date_count) }} 个统计日合计</div>
        </div>
        <div class="unarrived-kpi">
          <div class="kpi-label">涉及商品 SKU</div>
          <div class="kpi-value">{{ fmtNum(unarrived.all.sku_count) }} <small>个</small></div>
          <div class="kpi-sub">跨统计日按商品去重</div>
        </div>
        <div class="unarrived-kpi">
          <div class="kpi-label">涉及补货单</div>
          <div class="kpi-value">{{ fmtNum(unarrived.all.order_count) }} <small>单</small></div>
          <div class="kpi-sub">跨统计日去重的未匹配单据</div>
        </div>
        <div class="unarrived-kpi">
          <div class="kpi-label">未到货单（全部日期）</div>
          <div class="kpi-value">{{ fmtNum(unarrived.unarrived_orders) }} <small>单</small></div>
          <div class="kpi-sub">共扫描 {{ fmtNum(unarrived.scanned_orders) }} 单</div>
        </div>
      </div>

      <!-- 明细表格 -->
      <div class="unarrived-section">
        <div class="unarrived-section-header">
          <span class="unarrived-section-title">未到货明细</span>
          <span class="unarrived-hint">全部统计日 · 共 {{ fmtNum(unarrivedItems.length) }} 条</span>
        </div>
        <el-table
          :resizable="false"
          v-loading="statsLoading"
          :data="unarrivedItems"
          border
          stripe
          size="small"
          max-height="320"
          empty-text="暂无未到货商品"
        >
          <el-table-column label="统计日期" width="120">
            <template #default="{ row }">{{ row.date || '-' }}</template>
          </el-table-column>
          <el-table-column label="产品条码" min-width="140">
            <template #default="{ row }">{{ row.code || row.sku || '-' }}</template>
          </el-table-column>
          <el-table-column label="名称" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="未到货数量" width="120" align="right">
            <template #default="{ row }">{{ fmtNum(row.quantity) }}</template>
          </el-table-column>
          <el-table-column label="明细条数" width="100" align="right">
            <template #default="{ row }">{{ row.item_count }}</template>
          </el-table-column>
          <el-table-column label="涉及仓库" min-width="180">
            <template #default="{ row }">{{ (row.warehouse_ids || []).map(warehouseName).join('、') || '-' }}</template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 趋势图 -->
      <div class="unarrived-section">
        <div class="unarrived-section-header">
          <span class="unarrived-section-title">未到货趋势</span>
          <span class="unarrived-hint">最近 {{ unarrivedTrend.length }} 个统计日 · 折线各自按自身峰值缩放</span>
        </div>
        <div class="unarrived-trend" v-loading="statsLoading">
          <svg v-if="unarrivedTrend.length" :viewBox="`0 0 ${TREND_W} ${TREND_H}`" preserveAspectRatio="none">
            <line
              v-for="(yv, xi) in unarrivedYLines"
              :key="'uy' + xi"
              :x1="0"
              :y1="yv"
              :x2="TREND_W"
              :y2="yv"
              stroke="#ebeef5"
              stroke-width="1"
            />
            <polyline :points="qtyPoints" fill="none" stroke="#f56c6c" stroke-width="2" />
            <polyline :points="skuPoints" fill="none" stroke="#409eff" stroke-width="2" />
          </svg>
          <el-empty v-else description="暂无未到货数据" :image-size="60" />
        </div>
        <div class="unarrived-legend" v-if="unarrivedTrend.length">
          <span><i style="background:#f56c6c"></i>未到货数量</span>
          <span><i style="background:#409eff"></i>涉及 SKU 数</span>
        </div>
        <div class="unarrived-footnote">
          数据口径：{{ unarrived.criteriaText || '-' }}
          <template v-if="unarrived.generated_at"> · 生成于 {{ formatDate(unarrived.generated_at) }}</template>
        </div>
      </div>
      </template>
    </el-card>

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

    <el-dialog v-model="editVisible" title="编辑补货单" width="760px" destroy-on-close>
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="仓库" required>
          <el-select v-model="editForm.warehouse_id" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="补货时间">
          <el-date-picker v-model="editForm.replenishment_time" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="补货明细" required>
          <div style="width: 100%">
            <el-table :data="editForm.items" border size="small" style="width: 100%">
              <el-table-column label="产品" min-width="260">
                <template #default="{ row }">
                  <el-select v-model="row.product_id" filterable placeholder="选择产品" style="width: 100%">
                    <el-option v-for="p in products" :key="p.id" :label="`${p.code || p.sku} - ${p.name}`" :value="p.id" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="补货数量" width="160">
                <template #default="{ row }">
                  <el-input-number v-model="row.quantity" :min="1" :precision="0" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="80" align="center">
                <template #default="{ $index }">
                  <el-button link type="danger" :disabled="editForm.items.length <= 1" @click="removeEditItem($index)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-button link type="primary" style="margin-top: 8px" @click="addEditItem">+ 添加明细</el-button>
          </div>
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
// 未到货统计区块可见性：跟随登录账号权限（replenishment.read）
const canRead = computed(() => auth.hasPermission('replenishment.read'))

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
function statusType(s: string): 'primary' | 'success' | 'info' | 'warning' | 'danger' {
  return (statusMap[s]?.type || 'info') as 'primary' | 'success' | 'info' | 'warning' | 'danger'
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
// 全部仓库 id -> name 映射（未到货统计明细的仓库展示用，不受 domestic 下拉过滤影响）
const warehouseMap = ref<Record<string, string>>({})
function warehouseName(id: string) {
  return warehouseMap.value[id] || warehouses.value.find((w) => w.id === id)?.name || id
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
  warehouse_id: '',
  replenishment_time: '',
  items: [] as { product_id: string; quantity: number }[],
})

function openEdit(row: any) {
  const items = orderItems(row)
  editForm.id = row.id
  editForm.warehouse_id = row.warehouse_id ?? ''
  editForm.replenishment_time = row.replenishment_time || ''
  // 回填该单全部明细（后端 PATCH 为整单明细删除重建，只提交首条会导致其余明细丢失）
  editForm.items = items.length
    ? items.map((it: any) => ({
        product_id: it.product_id,
        quantity: Number(it.quantity) || 1,
      }))
    : [{ product_id: '', quantity: Number(row.replenish_qty) || 1 }]
  editVisible.value = true
}

function addEditItem() {
  editForm.items.push({ product_id: '', quantity: 1 })
}

function removeEditItem(index: number) {
  if (editForm.items.length <= 1) return
  editForm.items.splice(index, 1)
}

async function saveEdit() {
  if (!editForm.id || !editForm.warehouse_id) {
    ElMessage.warning('请选择仓库')
    return
  }
  if (!editForm.items.length || editForm.items.some((it) => !it.product_id)) {
    ElMessage.warning('请为每条明细选择产品')
    return
  }
  const items = editForm.items.map((it) => ({
    product_id: it.product_id,
    quantity: Number(it.quantity),
  }))
  const totalQty = items.reduce((sum, it) => sum + it.quantity, 0)
  saving.value = true
  try {
    await api.patch(`/replenishment/${editForm.id}`, {
      warehouse_id: editForm.warehouse_id,
      replenish_qty: totalQty,
      replenishment_time: editForm.replenishment_time || null,
      items,
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

// ===== 未到货统计区块（数据源：GET /api/replenishment/stats，字段以服务端 stats.ts 为准）=====
const TREND_W = 720
const TREND_H = 150
// 趋势图最多展示的统计日数量（超出取最近 N 天）
const TREND_DAYS = 30

const statsLoading = ref(false)
// 区块展开状态：默认收起，仅显示标题与未到货总数，点击后展开汇总/明细/趋势
const statsExpanded = ref(false)
const unarrived = reactive({
  timezone: '',
  generated_at: '',
  // 服务端口径说明（criteria.grouping）
  criteriaText: '',
  today_date: '',
  today: { date: '', order_count: 0, total_qty: 0, sku_count: 0 },
  // 全部统计日汇总（跨日去重）：data.all
  all: { total_qty: 0, sku_count: 0, order_count: 0, item_count: 0, date_count: 0 },
  scanned_orders: 0,
  unarrived_orders: 0,
  orders_without_items: 0,
  // 服务端返回的分日分组（UnarrivedDateGroup[]）
  dates: [] as any[],
})

// 仓库可见范围提示：非全量账号由服务端按 warehouseIds 行级隔离
const unarrivedScopeText = computed(() =>
  auth.hasFullWarehouseAccess() ? '全部仓库' : '仅统计当前账号可见仓库'
)

// 明细数据：汇总全部统计日的商品明细（保留各统计日），并带上统计日期
const unarrivedItems = computed(() => {
  const rows: any[] = []
  for (const g of unarrived.dates || []) {
    for (const it of g.items || []) rows.push({ ...it, date: g.date })
  }
  return rows
})

// 趋势图数据：按日期升序取最近 TREND_DAYS 天
const unarrivedTrend = computed(() =>
  [...(unarrived.dates || [])]
    .sort((a: any, b: any) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-TREND_DAYS)
)

const unarrivedYLines = computed(() => {
  const arr: number[] = []
  for (let i = 0; i <= 4; i++) arr.push((TREND_H / 5) * i + 8)
  return arr
})

function trendPoints(key: string, max: number): string {
  const t = unarrivedTrend.value
  if (!t.length) return ''
  const step = t.length > 1 ? TREND_W / (t.length - 1) : TREND_W
  return t
    .map((x: any, i: number) => {
      const px = t.length > 1 ? i * step : TREND_W / 2
      const py = TREND_H - 6 - ((Number(x[key]) || 0) / max) * (TREND_H - 24)
      return `${px.toFixed(1)},${py.toFixed(1)}`
    })
    .join(' ')
}

const qtyPoints = computed(() =>
  trendPoints('total_qty', Math.max(1, ...unarrivedTrend.value.map((x: any) => Number(x.total_qty) || 0)))
)
const skuPoints = computed(() =>
  trendPoints('sku_count', Math.max(1, ...unarrivedTrend.value.map((x: any) => Number(x.sku_count) || 0)))
)

function fmtNum(v: any): string {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '0'
}

async function loadStats() {
  if (!canRead.value) return
  statsLoading.value = true
  try {
    const { data } = await api.get('/replenishment/stats')
    const d = data?.data ?? {}
    unarrived.timezone = d.timezone || ''
    unarrived.generated_at = d.generated_at || ''
    unarrived.criteriaText = d.criteria?.grouping || ''
    unarrived.today_date = d.today_date || ''
    unarrived.today = {
      date: d.today?.date || d.today_date || '',
      order_count: Number(d.today?.order_count) || 0,
      total_qty: Number(d.today?.total_qty) || 0,
      sku_count: Number(d.today?.sku_count) || 0,
    }
    unarrived.scanned_orders = Number(d.scanned_orders) || 0
    unarrived.unarrived_orders = Number(d.unarrived_orders) || 0
    unarrived.orders_without_items = Number(d.orders_without_items) || 0
    unarrived.dates = Array.isArray(d.dates) ? d.dates : []
    // 全部统计日口径：优先取服务端 all；服务端未返回时按 dates 本地兜底（SKU 按商品去重）
    if (d.all) {
      unarrived.all = {
        total_qty: Number(d.all.total_qty) || 0,
        sku_count: Number(d.all.sku_count) || 0,
        order_count: Number(d.all.order_count) || 0,
        item_count: Number(d.all.item_count) || 0,
        date_count: Number(d.all.date_count) || unarrived.dates.length,
      }
    } else {
      const skus = new Set<string>()
      let totalQty = 0
      let orderCount = 0
      let itemCount = 0
      for (const g of unarrived.dates) {
        totalQty += Number(g.total_qty) || 0
        orderCount += Number(g.order_count) || 0
        for (const it of g.items || []) {
          skus.add(String(it.product_id ?? it.sku ?? it.code ?? ''))
          itemCount += Number(it.item_count) || 0
        }
      }
      unarrived.all = {
        total_qty: totalQty,
        sku_count: skus.size,
        order_count: orderCount,
        item_count: itemCount,
        date_count: unarrived.dates.length,
      }
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '未到货统计加载失败')
  } finally {
    statsLoading.value = false
  }
}

onMounted(() => {
  load()
  loadOptions()
  loadStats()
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

/* ===== 未到货统计区块 ===== */
.unarrived-card {
  margin-bottom: 16px;
  flex-shrink: 0;
}
.unarrived-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
}
.unarrived-title {
  font-weight: 600;
}
.unarrived-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.unarrived-total {
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
}
.unarrived-total b {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-color-danger, #f56c6c);
}
/* 收起态：仅保留标题行，隐藏卡片内容区与头部下边框 */
.unarrived-card.is-collapsed :deep(.el-card__body) {
  display: none;
}
.unarrived-card.is-collapsed :deep(.el-card__header) {
  border-bottom: none;
}
.unarrived-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.unarrived-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.unarrived-kpi {
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 8px;
  padding: 12px 16px;
}
.kpi-label {
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
}
.kpi-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--el-text-color-primary, #303133);
}
.kpi-value small {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary, #909399);
}
.kpi-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.unarrived-section {
  margin-top: 16px;
}
.unarrived-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.unarrived-section-title {
  font-size: 14px;
  font-weight: 600;
}
.unarrived-trend {
  height: 160px;
}
.unarrived-trend svg {
  width: 100%;
  height: 100%;
  display: block;
}
.unarrived-legend {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  margin-top: 8px;
}
.unarrived-legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: -1px;
}
.unarrived-footnote {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
@media (max-width: 900px) {
  .unarrived-kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
