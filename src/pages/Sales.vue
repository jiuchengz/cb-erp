<template>
  <div class="page">
    <div class="page-header">
      <h2>销售统计</h2>
      <div>
        <el-button v-if="canWrite" @click="downloadTpl">下载模板</el-button>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量导入</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" :loading="deleting" @click="batchRemove">
          批量删除{{ selected.length ? ' (' + selected.length + ')' : '' }}
        </el-button>
        <input ref="importFile" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onImportFile" />
      </div>
    </div>

    <div class="filters">
      <el-button-group>
        <el-button
          v-for="r in quickRanges"
          :key="r.days"
          :type="quickDays === r.days ? 'primary' : 'default'"
          size="default"
          @click="applyQuick(r.days)"
        >{{ r.label }}</el-button>
      </el-button-group>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        :clearable="false"
        popper-class="sales-dp-popper"
        style="width: 260px"
        @change="onDateChange"
      >
        <template #default="{ text, dayjs: cellDayjs }">
          <div class="cell-wrap">
            <div class="cell-date">{{ text }}</div>
            <div class="cell-qty">{{ dpQty(cellDayjs) }}</div>
          </div>
        </template>
      </el-date-picker>
      <el-input
        v-model="query.keyword"
        placeholder="链接ID/产品名"
        clearable
        style="width: 200px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <!-- 指标卡 -->
    <el-row :gutter="14" class="kpi-row" v-loading="loading">
      <el-col v-for="k in kpiCards" :key="k.label" :xs="12" :sm="4">
        <el-card shadow="hover" class="kpi-card">
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-value">{{ k.value }}<small v-if="k.unit">{{ k.unit }}</small></div>
          <div class="kpi-trend" :class="trendClass(k.trend)">
            <template v-if="k.trend != null">
              环比 {{ k.trend >= 0 ? '+' : '' }}{{ k.trend.toFixed(1) }}%
            </template>
            <template v-else>—</template>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-alert v-if="summary" type="info" :closable="false" class="summary-bar">
      当前范围共出单 {{ summary.rows }} 条，销售 {{ summary.sellQty }} / 退款 {{ summary.refundQty }}，实际销量 {{ summary.quantity }}
    </el-alert>

    <div class="table-wrap">
    <el-table :resizable="false"
      v-loading="loading"
      :data="pagedRows"
      border
      stripe
      height="100%"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="46" />
      <el-table-column label="图片" width="70" align="center">
        <template #default="{ row }">
          <el-tooltip v-if="row.image" :show-after="200" :offset="10">
            <template #content>
              <img :src="row.image" class="img-preview" referrerpolicy="no-referrer" @error="onImgError($event)" />
            </template>
            <img :src="row.image" class="product-thumb" referrerpolicy="no-referrer" @error="onImgError($event)" />
          </el-tooltip>
          <div v-else class="img-fallback">无图</div>
        </template>
      </el-table-column>
      <el-table-column prop="link_id" label="链接ID" min-width="120" show-overflow-tooltip>
        <template #header>
          <span class="sortable-header" @click="toggleSort('link_id')">链接ID<el-icon class="sort-icon" :class="{ active: !!sortDir('link_id') }"><sort v-if="!sortDir('link_id')" /><arrow-up v-else-if="sortDir('link_id') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
      </el-table-column>
      <el-table-column prop="product_name" label="产品名称" min-width="170" show-overflow-tooltip>
        <template #header>
          <span class="sortable-header" @click="toggleSort('product_name')">产品名称<el-icon class="sort-icon" :class="{ active: !!sortDir('product_name') }"><sort v-if="!sortDir('product_name')" /><arrow-up v-else-if="sortDir('product_name') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
      </el-table-column>
      <el-table-column prop="platform" label="平台/站点" min-width="100">
        <template #header>
          <span class="sortable-header" @click="toggleSort('platform')">平台/站点<el-icon class="sort-icon" :class="{ active: !!sortDir('platform') }"><sort v-if="!sortDir('platform')" /><arrow-up v-else-if="sortDir('platform') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
      </el-table-column>
      <el-table-column prop="quantity" label="销售数量" width="110" align="right">
        <template #header>
          <span class="sortable-header" @click="toggleSort('quantity')">销售数量<el-icon class="sort-icon" :class="{ active: !!sortDir('quantity') }"><sort v-if="!sortDir('quantity')" /><arrow-up v-else-if="sortDir('quantity') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
      </el-table-column>
      <el-table-column prop="refund_qty" label="退款数量" width="110" align="right">
        <template #header>
          <span class="sortable-header" @click="toggleSort('refund_qty')">退款数量<el-icon class="sort-icon" :class="{ active: !!sortDir('refund_qty') }"><sort v-if="!sortDir('refund_qty')" /><arrow-up v-else-if="sortDir('refund_qty') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
      </el-table-column>
      <el-table-column label="实际销量" width="110" align="right" prop="netQty">
        <template #header>
          <span class="sortable-header" @click="toggleSort('netQty')">实际销量<el-icon class="sort-icon" :class="{ active: !!sortDir('netQty') }"><sort v-if="!sortDir('netQty')" /><arrow-up v-else-if="sortDir('netQty') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
        <template #default="{ row }">{{ row.netQty != null ? Number(row.netQty) : '-' }}</template>
      </el-table-column>
      <el-table-column label="环比变化" width="110" align="right" prop="changeRate">
        <template #header>
          <span class="sortable-header" @click="toggleSort('changeRate')">环比变化<el-icon class="sort-icon" :class="{ active: !!sortDir('changeRate') }"><sort v-if="!sortDir('changeRate')" /><arrow-up v-else-if="sortDir('changeRate') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
        <template #default="{ row }">
          <span v-if="row.prevQty == null" class="flat">新增</span>
          <span v-else-if="row.changeRate == null" class="flat">—</span>
          <span v-else :class="row.changeRate >= 0 ? 'up' : 'down'">
            {{ row.changeRate >= 0 ? '+' : '' }}{{ row.changeRate.toFixed(1) }}%
          </span>
        </template>
      </el-table-column>
      <el-table-column :label="'平均售价(' + getCurrencyCode() + ')'" min-width="120" align="right" prop="avg_price">
        <template #header>
          <span class="sortable-header" @click="toggleSort('avg_price')">{{ '平均售价(' + getCurrencyCode() + ')' }}<el-icon class="sort-icon" :class="{ active: !!sortDir('avg_price') }"><sort v-if="!sortDir('avg_price')" /><arrow-up v-else-if="sortDir('avg_price') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
        <template #default="{ row }">{{ row.avg_price != null ? convertMoney(row.avg_price).toLocaleString() + ' ' + getCurrencyCode() : '-' }}</template>
      </el-table-column>
      <el-table-column label="可用库存" min-width="110" align="right" prop="overseas_stock">
        <template #header>
          <span class="sortable-header" @click="toggleSort('overseas_stock')">可用库存<el-icon class="sort-icon" :class="{ active: !!sortDir('overseas_stock') }"><sort v-if="!sortDir('overseas_stock')" /><arrow-up v-else-if="sortDir('overseas_stock') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
        <template #default="{ row }">{{ row.overseas_stock != null ? Number(row.overseas_stock) : '-' }}</template>
      </el-table-column>
      <el-table-column prop="days" label="出单天数" width="100" align="right">
        <template #header>
          <span class="sortable-header" @click="toggleSort('days')">出单天数<el-icon class="sort-icon" :class="{ active: !!sortDir('days') }"><sort v-if="!sortDir('days')" /><arrow-up v-else-if="sortDir('days') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <div class="pagination-bar">
      <span class="pagination-total">当前页共 {{ pagedRows.length }} 条</span>
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        @current-change="onPageChange"
      />
      <el-select v-model="query.pageSize" class="page-size-select" @change="onSizeChange">
        <el-option label="100条/页" :value="100" />
        <el-option label="200条/页" :value="200" />
        <el-option label="500条/页" :value="500" />
      </el-select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowUp, Sort } from '@element-plus/icons-vue'
import { api } from '../services/api'
import { convertMoney, getCurrencyCode, getRate, BASE_CURRENCY, isRatesLoaded, fetchExchangeRates } from '../utils/system'
import { useAuthStore } from '../stores/auth'
import { buildExportPayload, exportViaServer, todayStr } from '../utils/export'
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum } from '../utils/import'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('sales.write'))

const aggRows = ref<any[]>([])
const total = ref(0)
const summary = ref<any>(null)
const loading = ref(false)

// 日期选择器日历面板：每日实际销量（日期 -> netQty）
const dailyMap = ref<Record<string, number>>({})
function dpQty(d: any) {
  if (!d || typeof d.format !== 'function') return ''
  const qty = dailyMap.value[d.format('YYYY-MM-DD')]
  return qty != null && qty !== 0 ? String(qty) : ''
}

// 日期选择记忆：手动选择日期/点击快捷周期后持久化，刷新页面不丢失
const RANGE_KEY = 'cb-erp-sales-range'
const QUICK_KEY = 'cb-erp-sales-quick'

function initialQuick(): number {
  try {
    const quickRaw = localStorage.getItem(QUICK_KEY)
    const quick = quickRaw != null ? Number(quickRaw) : NaN
    if (!isNaN(quick) && [0, 7, 30, 60, -1].includes(quick)) return quick
  } catch {
    /* 存储异常时回退默认 */
  }
  return 0
}

const quickRanges = [
  { label: '今天', days: 0 },
  { label: '近7天', days: 7 },
  { label: '近30天', days: 30 },
  { label: '近60天', days: 60 },
]
const quickDays = ref<number>(initialQuick())

function fmtDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 默认查看当天
function todayRange(): [string, string] {
  const t = fmtDate(new Date())
  return [t, t]
}

function initialRange(): [string, string] {
  try {
    const quickRaw = localStorage.getItem(QUICK_KEY)
    const quick = quickRaw != null ? Number(quickRaw) : NaN
    // 上次是快捷周期（今天/近7天/近30天/近60天）：按当前日期重新推算
    if (!isNaN(quick) && quick >= 0) {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - quick)
      return [fmtDate(start), fmtDate(end)]
    }
    // 上次是手动选择的具体日期：原样恢复
    const raw = localStorage.getItem(RANGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length === 2 && arr[0] && arr[1]) return [String(arr[0]), String(arr[1])]
    }
  } catch {
    /* 存储异常时回退当天 */
  }
  return todayRange()
}

function saveRange(quickDaysVal: number) {
  try {
    if (dateRange.value?.[0] && dateRange.value?.[1]) {
      localStorage.setItem(RANGE_KEY, JSON.stringify([dateRange.value[0], dateRange.value[1]]))
      localStorage.setItem(QUICK_KEY, String(quickDaysVal))
    }
  } catch {
    /* 忽略存储失败 */
  }
}

const dateRange = ref<any[]>(initialRange())
const query = reactive({ page: 1, pageSize: 200, keyword: '' })

const sortState = reactive<{ prop: string; order: 'ascending' | 'descending' | null }>({
  prop: '',
  order: null,
})

function applyQuick(days: number) {
  quickDays.value = days
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  dateRange.value = [fmtDate(start), fmtDate(end)]
  query.page = 1
  saveRange(days)
  load()
}

function onDateChange() {
  // 手动选择日期范围后，取消快捷周期高亮
  const len = dateRange.value?.[0] && dateRange.value?.[1]
    ? dayDiff(dateRange.value[0], dateRange.value[1]) + 1
    : 0
  if (len === 1) quickDays.value = 0
  else if (len === 7) quickDays.value = 7
  else if (len === 30) quickDays.value = 30
  else if (len === 60) quickDays.value = 60
  else quickDays.value = -1
  query.page = 1
  // 手动选择的具体日期需持久化（刷新不丢）；快捷档位记 -1，避免次日被"按今天重算"覆盖
  saveRange(-1)
  load()
}

function dayDiff(a: string, b: string) {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  return Math.round((db - da) / 86400000)
}

function shiftDate(d: string, offsetDays: number) {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + offsetDays)
  return fmtDate(dt)
}

// 计算日期所在月的最后一天（用于日历面板整月销量数据范围）
function monthLastDay(dateStr: string) {
  const [y, m] = dateStr.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

// 聚合明细为按链接ID的数据（指定区间），拆分销售数量/退款数量/实际销量
// 调用后端聚合接口，替代全量翻页 + 前端聚合
async function fetchSummary(saleFrom: string, saleTo: string, keyword: string) {
  const { data } = await api.get('/daily-sales/summary', {
    params: { sale_from: saleFrom, sale_to: saleTo, keyword },
  })
  return {
    aggRows: data.aggRows ?? [],
    totals: data.totals ?? {},
    dateSet: new Set<string>(data.dateSet ?? []),
    dailyTotals: data.dailyTotals ?? [],
  }
}

// 拉取商品图片映射
async function fetchImageMap() {
  const imageMap: Record<string, string> = {}
  let page = 1
  for (;;) {
    const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
    ;(data.data ?? []).forEach((p: any) => {
      const lid = String(p.link_id || '').trim()
      if (lid && p.image_text) imageMap[lid] = p.image_text
    })
    if (page * 200 >= (data.total ?? 0)) break
    page++
  }
  return imageMap
}

async function load() {
  loading.value = true
  try {
    const from = dateRange.value?.[0] || ''
    const to = dateRange.value?.[1] || ''

    // 当前周期 + 上一等长周期（用于环比）+ 日历整月销量 + 商品图片映射，并行拉取
    const prevFrom = from ? shiftDate(from, -(dayDiff(from, to) + 1)) : ''
    const prevTo = from ? shiftDate(from, -1) : ''
    // 日历面板数据范围：覆盖选择范围所在整月，未选中日期也能显示销量
    const calFrom = from ? from.slice(0, 7) + '-01' : ''
    const calTo = to ? monthLastDay(to) : ''
    const [cur, prev, cal, imageMap] = await Promise.all([
      fetchSummary(from, to, query.keyword),
      prevFrom && prevTo
        ? fetchSummary(prevFrom, prevTo, query.keyword)
        : Promise.resolve({ aggRows: [], totals: {}, dateSet: new Set<string>(), dailyTotals: [] }),
      calFrom && calTo
        ? fetchSummary(calFrom, calTo, query.keyword)
        : Promise.resolve({ aggRows: [], totals: {}, dateSet: new Set<string>(), dailyTotals: [] }),
      fetchImageMap(),
    ])
    const prevMap = new Map<string, any>(prev.aggRows.map((r: any) => [String(r.link_id), r]))

    // 日历面板数据：按日期 -> 实际销量（整月覆盖，未选中时也全部显示）
    const daily: Record<string, number> = {}
    ;(cal.dailyTotals ?? []).forEach((d: any) => {
      if (d.sale_date != null) daily[d.sale_date] = Number(d.net_qty || 0)
    })
    dailyMap.value = daily

    // 合并环比数据（基于实际销量 netQty）
    aggRows.value = cur.aggRows.map((r: any) => {
      const key = String(r.link_id)
      const p = prevMap.get(key)
      const prevQty = p ? Number(p.netQty || 0) : 0
      let changeRate: number | null = null
      if (prevQty > 0) changeRate = Number((((r.netQty - prevQty) / prevQty) * 100).toFixed(1))
      return {
        ...r,
        image: imageMap[key] || '',
        prevQty: prevQty > 0 ? prevQty : null,
        changeRate,
      }
    })
    total.value = aggRows.value.length

    const kpi: any = {
      links: aggRows.value.length,
      sellQty: cur.totals.sellQty ?? 0,
      refundQty: cur.totals.refundQty ?? 0,
      refundAmount: cur.totals.refundAmount ?? 0,
      netQty: cur.totals.netQty ?? 0,
      netAmount: cur.totals.netAmount ?? 0,
      days: cur.dateSet.size,
    }
    const prevKpi: any = {
      links: prevMap.size,
      sellQty: prev.totals.sellQty ?? 0,
      refundQty: prev.totals.refundQty ?? 0,
      refundAmount: prev.totals.refundAmount ?? 0,
      netQty: prev.totals.netQty ?? 0,
      netAmount: prev.totals.netAmount ?? 0,
      days: prev.dateSet.size,
    }
    summary.value = {
      rows: aggRows.value.length,
      sellQty: cur.totals.sellQty ?? 0,
      refundQty: cur.totals.refundQty ?? 0,
      quantity: cur.totals.netQty ?? 0,
      kpi,
      prevKpi,
      hasPrev: prevFrom !== '' && prevTo !== '',
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const kpiCards = computed(() => {
  const k = summary.value?.kpi || {}
  const pk = summary.value?.prevKpi || {}
  const hasPrev = summary.value?.hasPrev
  const trendOf = (cur: number, prev: number) => (hasPrev && prev > 0 ? Number((((cur - prev) / prev) * 100).toFixed(1)) : null)
  return [
    { label: '出单链接数', value: k.links ?? 0, unit: '个', trend: trendOf(k.links ?? 0, pk.links ?? 0) },
    { label: '销售数量', value: k.sellQty ?? 0, unit: '件', trend: trendOf(k.sellQty ?? 0, pk.sellQty ?? 0) },
    { label: '退款数量', value: k.refundQty ?? 0, unit: '件', trend: trendOf(k.refundQty ?? 0, pk.refundQty ?? 0) },
    { label: '退款金额', value: convertMoney(k.refundAmount ?? 0).toLocaleString(), unit: getCurrencyCode(), trend: trendOf(k.refundAmount ?? 0, pk.refundAmount ?? 0) },
    { label: '实际销量', value: k.netQty ?? 0, unit: '件', trend: trendOf(k.netQty ?? 0, pk.netQty ?? 0) },
    { label: '实际销售额', value: convertMoney(k.netAmount ?? 0).toLocaleString(), unit: getCurrencyCode(), trend: trendOf(k.netAmount ?? 0, pk.netAmount ?? 0) },
    { label: '有销量天数', value: k.days ?? 0, unit: '天', trend: trendOf(k.days ?? 0, pk.days ?? 0) },
  ]
})

function trendClass(t: number | null) {
  if (t == null) return 'flat'
  if (t > 0) return 'up'
  if (t < 0) return 'down'
  return 'flat'
}

const pagedRows = computed(() => {
  let rows = aggRows.value
  if (sortState.prop && sortState.order) {
    const prop = sortState.prop
    const dir = sortState.order === 'ascending' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const va = a[prop]
      const vb = b[prop]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
  }
  const start = (query.page - 1) * query.pageSize
  return rows.slice(start, start + query.pageSize)
})

// 点击表头：未排序 -> 升序 -> 降序 -> 取消
function toggleSort(prop: string) {
  if (sortState.prop !== prop) {
    sortState.prop = prop
    sortState.order = 'ascending'
  } else if (sortState.order === 'ascending') {
    sortState.order = 'descending'
  } else {
    sortState.prop = ''
    sortState.order = null
  }
  query.page = 1
}

// 排序方向：ascending / descending / null
function sortDir(prop: string) {
  return sortState.prop === prop ? sortState.order : ''
}

function onPageChange() {}

function onSizeChange() {
  query.page = 1
  load()
}

function isImageUrl(v: unknown): v is string {
  if (typeof v !== 'string' || !v) return false
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:image/')
}

function onImgError(e: Event) {
  const img = e.target as HTMLImageElement
  img.src =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect fill="#F5F7FA" width="40" height="40"/><text x="20" y="24" text-anchor="middle" font-size="12" fill="#C0C4CC">?</text></svg>'
    )
}

const importing = ref(false)
const importFile = ref<any>(null)

// ===== 批量删除（与其它模块一致的交互：勾选 -> 确认 -> 删除） =====
const deleting = ref(false)
const selected = ref<any[]>([])
function onSelectionChange(rows: any[]) {
  selected.value = rows || []
}

// 删除口径：选中链接在当前筛选日期范围内的全部销售明细（列表为按链接聚合行，需按范围删除）
async function batchRemove() {
  if (!selected.value.length) return
  const rangeText = dateRange.value?.[0] && dateRange.value?.[1]
    ? `${dateRange.value[0]} 至 ${dateRange.value[1]}`
    : '全部日期'
  try {
    await ElMessageBox.confirm(
      `将删除选中的 ${selected.value.length} 个链接在【${rangeText}】内的全部销售明细，删除后不可恢复。是否继续？`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  deleting.value = true
  try {
    const { data } = await api.post('/daily-sales/batch-delete', {
      link_ids: selected.value.map((r: any) => String(r.link_id || '')).filter(Boolean),
      sale_from: dateRange.value?.[0] || '',
      sale_to: dateRange.value?.[1] || '',
    })
    ElMessage.success(`已删除 ${data?.deleted ?? 0} 条销售明细`)
    selected.value = []
    load()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error?.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

function downloadTpl() {
  downloadTemplate(
    [
      { label: '日期', sample: '2026-08-04' },
      { label: '站点', sample: 'Mexico' },
      { label: '商品ID', sample: 'MLM2553999543' },
      { label: '实际销量', sample: 8 },
      { label: '平均售价(' + getCurrencyCode() + ')', sample: 248.51 },
      { label: '可用库存', sample: 27 },
    ],
    '历史分析-商品销售明细',
    '历史分析-商品销售明细模板.xlsx'
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
    if (!isRatesLoaded()) await fetchExchangeRates()
    const { headers, rows } = await readExcelFile(file)
    const col = buildColMap(headers, {
      sale_date: ['日期', 'date', 'sale_date'],
      platform: ['站点', '平台', 'platform'],
      link_id: ['商品ID', '链接ID', 'link_id', 'linkId'],
      quantity: ['实际销量', '销量', 'quantity', 'qty'],
      unit_price: ['平均售价(' + getCurrencyCode() + ')', '平均售价', '单价', 'price', 'unit_price'],
      overseas_stock: ['可用库存', '海外库存', 'overseas_stock', 'stock'],
    })
    // 平均售价列：兼容任意币种后缀（如"平均售价(USD)"），并「始终」以列头币种为准换算。
    // 注意：不能因为列头恰好等于当前显示币种就跳过币种解析——记账币种固定为 BASE_CURRENCY(MXN)，
    // 一旦表格币种与之不同（如 USD），跳过解析会把 USD 数值直接当 MXN 写入，金额被放大约 17 倍。
    let unitPriceCurrency = BASE_CURRENCY
    if (col.unit_price === undefined) {
      const priceIdx = headers.findIndex((h) => h.replace(/\s/g, '').startsWith('平均售价'))
      if (priceIdx >= 0) col.unit_price = priceIdx
    }
    if (col.unit_price !== undefined) {
      const rawHeader = String(headers[col.unit_price] || '').replace(/\s/g, '')
      const m = rawHeader.match(/[（(]([A-Za-z]{3})[)）]/)
      if (m) unitPriceCurrency = m[1].toUpperCase()
    }
    // 汇率缺失时直接拦截：宁可导入失败，也不静默把外币数值当记账币种写库
    if (unitPriceCurrency !== BASE_CURRENCY && getRate(unitPriceCurrency, BASE_CURRENCY) == null) {
      ElMessage.error(`缺少 ${unitPriceCurrency}→${BASE_CURRENCY} 汇率，无法换算平均售价，请先补全汇率后重试`)
      return
    }
    if (col.link_id === undefined || col.quantity === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"商品ID"和"实际销量"列')
      return
    }
    const linkMap: Record<string, any> = {}
    // 按 Excel 涉及的商品ID精确查询（替代全量分页拉取，商品多时明显提速）
    const allLinkIds = Array.from(
      new Set(
        rows
          .map((row: any) => cellStr(row, col.link_id).replace(/^MLM/i, '').trim())
          .filter(Boolean)
      )
    )
    for (let i = 0; i < allLinkIds.length; i += 200) {
      const chunk = allLinkIds.slice(i, i + 200)
      const { data } = await api.get('/products', { params: { page: 1, pageSize: 200, link_ids: chunk.join(',') } })
      ;(data.data ?? []).forEach((p: any) => {
        if (p.link_id) linkMap[String(p.link_id).trim()] = p
      })
    }
    const payloadRows: any[] = []
    const errLines: string[] = []
    const stockMap = new Map<string, { sale_date: string; stock: number }>()
    // 无销量但有库存的行：只参与海外库存快照更新，不写入销售统计
    const stockOnlyMap = new Map<string, { sale_date: string; stock: number; curStock: number }>()
    let stockUpdated = 0
    let stockSkipped = 0
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx]
      const lineNo = idx + 2
      const rawId = cellStr(row, col.link_id)
      const linkId = rawId.replace(/^MLM/i, '').trim()
      const qty = cellNum(row, col.quantity)
      if (!rawId) {
        errLines.push(`第${lineNo}行：商品ID为空`)
        continue
      }
      // 无销量行：仅当带库存列、库存>0 且商品已存在时，记入海外库存快照（跳过销售统计）
      if (qty === 0) {
        const p0 = linkMap[linkId]
        if (p0 && col.overseas_stock !== undefined) {
          const s0 = cellNum(row, col.overseas_stock)
          if (s0 > 0) {
            const d0 = col.sale_date !== undefined ? cellStr(row, col.sale_date).slice(0, 10) : ''
            const cur0 = stockOnlyMap.get(p0.id)
            if (!cur0 || d0 >= cur0.sale_date) {
              stockOnlyMap.set(p0.id, { sale_date: d0, stock: s0, curStock: Number(p0.overseas_stock ?? 0) })
            }
            continue
          }
        }
        errLines.push(`第${lineNo}行：无销量且无可更新库存，已忽略`)
        continue
      }
      // 允许负销量：代表退款/退货，导入时扣减
      const product = linkMap[linkId]
      // 平均售价：读取后按列币种换算为记账币种（BASE_CURRENCY）存储
      const rawPrice = col.unit_price !== undefined ? cellNum(row, col.unit_price) : 0
      let unitPrice = rawPrice
      if (rawPrice && unitPriceCurrency !== BASE_CURRENCY) {
        const rate = getRate(unitPriceCurrency, BASE_CURRENCY)
        if (rate != null) unitPrice = rawPrice * rate
      }
      const item: any = {
        link_id: linkId,
        quantity: qty,
        unit_price: unitPrice,
        overseas_stock: col.overseas_stock !== undefined ? cellNum(row, col.overseas_stock) : 0,
      }
      if (col.sale_date !== undefined) {
        const d = cellStr(row, col.sale_date).slice(0, 10)
        if (d) item.sale_date = d
      }
      if (col.platform !== undefined) {
        const p = cellStr(row, col.platform)
        if (p) item.platform = p
      }
      item.product_name = product ? product.name || '' : '未匹配'
      payloadRows.push(item)
      if (product && col.overseas_stock !== undefined) {
        const stock = cellNum(row, col.overseas_stock)
        const d = item.sale_date || ''
        const cur = stockMap.get(product.id)
        if (!cur || d >= cur.sale_date) {
          stockMap.set(product.id, { sale_date: d, stock })
        }
      }
    }
    // 海外库存批量更新（一次请求替代逐条 PATCH，导入明显提速）
    // 有销量商品：沿用原逻辑，取表格最新库存直接覆盖；
    // 无销量但有库存的商品：与现有海外库存一致则跳过，不一致才以表格最新时间为准更新。
    const stockItems: { id: string; overseas_stock: number }[] = []
    for (const [pid, v] of stockMap) {
      stockItems.push({ id: pid, overseas_stock: v.stock })
      stockUpdated++
    }
    for (const [pid, v] of stockOnlyMap) {
      if (stockMap.has(pid)) continue // 该商品本次表格中有销量，按有销量逻辑更新
      if (Number(v.curStock) === Number(v.stock)) {
        stockSkipped++
        continue
      }
      stockItems.push({ id: pid, overseas_stock: v.stock })
      stockUpdated++
    }
    if (stockItems.length) {
      for (let i = 0; i < stockItems.length; i += 500) {
        const chunk = stockItems.slice(i, i + 500)
        await api.post('/products/batch-stock', { items: chunk })
      }
    }
    if (!payloadRows.length && !stockItems.length) {
      ElMessage.warning('没有可导入的数据')
      return
    }
    const summaryParts: string[] = []
    if (payloadRows.length) {
      try {
        const { data } = await api.post('/daily-sales', { rows: payloadRows })
        const d = data.data || {}
        const ok = d.imported ?? payloadRows.length
        // 反馈新增/更新/去重跳过，让「同一表格重复导入」的结果一目了然
        const detailParts: string[] = []
        if (d.inserted) detailParts.push(`新增 ${d.inserted}`)
        if (d.updated) detailParts.push(`覆盖 ${d.updated}`)
        if (d.skipped) detailParts.push(`跳过重复 ${d.skipped}`)
        summaryParts.push(`成功导入销售 ${ok} 条${detailParts.length ? `（${detailParts.join('，')}）` : ''}`)
      } catch (err: any) {
        const msg = err?.response?.data?.error?.message || '导入失败'
        errLines.push(msg)
        summaryParts.push('销售导入失败')
        ElMessage.error('销售导入失败：' + msg)
      }
    }
    if (stockUpdated > 0) summaryParts.push(`更新海外库存 ${stockUpdated} 个商品`)
    if (stockSkipped > 0) summaryParts.push(`海外库存一致跳过 ${stockSkipped} 个商品`)
    if (errLines.length) {
      ElMessage.warning(summaryParts.join('，') + `，忽略 ${errLines.length} 行：` + errLines.slice(0, 5).join('；') + (errLines.length > 5 ? ` 等 ${errLines.length} 行` : ''))
    } else {
      ElMessage.success(summaryParts.join('，'))
    }
    dateRange.value = todayRange()
    quickDays.value = 0
    query.page = 1
    saveRange(0)
    load()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error?.message || err?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

const exporting = ref(false)
async function exportRows() {
  const columns = [
    { key: 'link_id', label: '链接ID', value: (r: any) => r.link_id || '' },
    { key: 'product_name', label: '产品名称', value: (r: any) => r.product_name || '' },
    { key: 'platform', label: '平台/站点', value: (r: any) => r.platform || '' },
    { key: 'quantity', label: '销售数量', value: (r: any) => r.quantity ?? '' },
    { key: 'refund_qty', label: '退款数量', value: (r: any) => r.refund_qty ?? '' },
    { key: 'netQty', label: '实际销量', value: (r: any) => r.netQty ?? '' },
    {
      key: 'changeRate',
      label: '环比变化',
      value: (r: any) => {
        if (r.prevQty == null) return '新增'
        if (r.changeRate == null) return ''
        return `${r.changeRate >= 0 ? '+' : ''}${r.changeRate.toFixed(1)}%`
      },
    },
    { key: 'avg_price', label: '平均售价(' + getCurrencyCode() + ')', value: (r: any) => (r.avg_price != null ? convertMoney(r.avg_price).toLocaleString() + ' ' + getCurrencyCode() : '') },
    { key: 'overseas_stock', label: '可用库存', value: (r: any) => (r.overseas_stock != null ? Number(r.overseas_stock) : '') },
    { key: 'days', label: '出单天数', value: (r: any) => r.days ?? '' },
  ]
  exporting.value = true
  try {
    await exportViaServer(`销售统计_${todayStr()}.xlsx`, buildExportPayload({ rows: aggRows.value, columns }))
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.sortable-header {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}
.sortable-header:hover {
  color: var(--el-color-primary, #409eff);
}
.sort-icon {
  font-size: 14px;
  color: #c0c4cc;
  transition: color 0.2s;
}
.sort-icon.active {
  color: var(--el-color-primary, #409eff);
}
.sortable-header:hover .sort-icon {
  color: var(--el-color-primary, #409eff);
}
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
  margin-bottom: 12px;
  flex-wrap: wrap;
  align-items: center;
}

/* 日期选择器弹出日历面板：日期下方显示当日实际销量
   适配新版 Element Plus：#default 插槽内容整体替换 .el-date-table-cell，
   选中/悬停/今天等状态样式需基于 td 状态类（available/today/in-range/start-date/end-date）自行补齐 */
:global(.sales-dp-popper .el-date-table td) {
  height: 46px !important;
}
:global(.sales-dp-popper .cell-wrap) {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 4px;
}
:global(.sales-dp-popper .cell-date) {
  font-size: 14px;
  color: #606266;
  line-height: 1.2;
}
:global(.sales-dp-popper .cell-qty) {
  font-size: 10px;
  color: #409eff;
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1px;
  min-height: 12px;
}
/* 悬停反馈 */
:global(.sales-dp-popper .el-date-table td.available:hover .cell-wrap) {
  background: #ecf5ff;
}
/* 今天 */
:global(.sales-dp-popper .el-date-table td.today .cell-date) {
  color: #409eff;
  font-weight: 700;
}
/* 选中范围内 */
:global(.sales-dp-popper .el-date-table td.in-range .cell-wrap) {
  background: #f2f6fc;
}
:global(.sales-dp-popper .el-date-table td.in-range.available:hover .cell-wrap) {
  background: #e4edfa;
}
/* 起止日期：蓝底白字（明确选中反馈） */
:global(.sales-dp-popper .el-date-table td.start-date .cell-wrap),
:global(.sales-dp-popper .el-date-table td.end-date .cell-wrap) {
  background: #409eff;
}
:global(.sales-dp-popper .el-date-table td.start-date .cell-date),
:global(.sales-dp-popper .el-date-table td.start-date .cell-qty),
:global(.sales-dp-popper .el-date-table td.end-date .cell-date),
:global(.sales-dp-popper .el-date-table td.end-date .cell-qty) {
  color: #fff;
}
.kpi-row {
  margin-bottom: 12px;
}
.kpi-card {
  margin-bottom: 2px;
}
.kpi-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}
.kpi-value {
  font-size: 26px;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
}
.kpi-value small {
  font-size: 13px;
  font-weight: 400;
  color: #909399;
  margin-left: 4px;
}
.kpi-trend {
  font-size: 12px;
  margin-top: 8px;
}
.up {
  color: #67c23a;
}
.down {
  color: #f56c6c;
}
.flat {
  color: #909399;
}
.summary-bar {
  margin-bottom: 12px;
}
.product-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #ebeef5;
  cursor: pointer;
  vertical-align: middle;
}
.img-preview {
  max-width: 220px;
  max-height: 220px;
  border-radius: 6px;
}
.img-fallback {
  width: 40px;
  height: 40px;
  line-height: 40px;
  border-radius: 4px;
  background: #f5f7fa;
  color: #c0c4cc;
  font-size: 12px;
  text-align: center;
  margin: 0 auto;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
