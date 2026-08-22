<template>
  <div class="page">
    <div class="page-header">
      <h2>销售统计</h2>
      <div>
        <el-button v-if="canWrite" @click="downloadTpl">下载模板</el-button>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量导入</el-button>
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
        style="width: 260px"
        @change="onDateChange"
      />
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
    <el-table
      v-loading="loading"
      :data="pagedRows"
      border
      stripe
      @sort-change="onSortChange"
      height="100%"
    >
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
      <el-table-column prop="link_id" label="链接ID" min-width="120" sortable="custom" show-overflow-tooltip />
      <el-table-column prop="product_name" label="产品名称" min-width="170" sortable="custom" show-overflow-tooltip />
      <el-table-column prop="platform" label="平台/站点" min-width="100" sortable="custom" />
      <el-table-column prop="quantity" label="销售数量" width="110" align="right" sortable="custom" />
      <el-table-column prop="refund_qty" label="退款数量" width="110" align="right" sortable="custom" />
      <el-table-column label="实际销量" width="110" align="right" sortable="custom" prop="netQty">
        <template #default="{ row }">{{ row.netQty != null ? Number(row.netQty) : '-' }}</template>
      </el-table-column>
      <el-table-column label="环比变化" width="110" align="right" sortable="custom" prop="changeRate">
        <template #default="{ row }">
          <span v-if="row.prevQty == null" class="flat">新增</span>
          <span v-else-if="row.changeRate == null" class="flat">—</span>
          <span v-else :class="row.changeRate >= 0 ? 'up' : 'down'">
            {{ row.changeRate >= 0 ? '+' : '' }}{{ row.changeRate.toFixed(1) }}%
          </span>
        </template>
      </el-table-column>
      <el-table-column label="平均售价(MXN)" min-width="120" align="right" sortable="custom" prop="avg_price">
        <template #default="{ row }">{{ row.avg_price != null ? Number(row.avg_price) : '-' }}</template>
      </el-table-column>
      <el-table-column label="可用库存" min-width="110" align="right" sortable="custom" prop="overseas_stock">
        <template #default="{ row }">{{ row.overseas_stock != null ? Number(row.overseas_stock) : '-' }}</template>
      </el-table-column>
      <el-table-column prop="days" label="出单天数" width="100" align="right" sortable="custom" />
    </el-table>
    </div>

    <el-pagination
      background
      layout="total, sizes, prev, pager, next"
      :total="total"
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :page-sizes="[20, 50, 100]"
      @current-change="onPageChange"
      @size-change="onSizeChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'
import { useAuthStore } from '../stores/auth'
import { buildExportPayload, exportViaServer, todayStr } from '../utils/export'
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum } from '../utils/import'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('sales.write'))

const aggRows = ref<any[]>([])
const total = ref(0)
const summary = ref<any>(null)
const loading = ref(false)

const quickRanges = [
  { label: '今天', days: 0 },
  { label: '近7天', days: 7 },
  { label: '近30天', days: 30 },
  { label: '近60天', days: 60 },
]
const quickDays = ref<number>(0)

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

const dateRange = ref<any[]>(todayRange())
const query = reactive({ page: 1, pageSize: 20, keyword: '' })

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

// 聚合明细为按链接ID的数据（指定区间），拆分销售数量/退款数量/实际销量
function aggregate(rows: any[]) {
  const map = new Map<string, any>()
  const dateSet = new Set<string>()
  let totalSellQty = 0
  let totalRefundQty = 0
  let totalRefundAmount = 0
  let totalNetQty = 0
  let totalNetAmount = 0
  for (const r of rows) {
    const key = String(r.link_id || '')
    const d = String(r.sale_date || '')
    if (d) dateSet.add(d)
    const sellQty = Number(r.quantity || 0)
    const refundQty = Number(r.refund_qty || 0)
    const refundAmount = Number(r.refund_amount || 0)
    const sellAmount = sellQty * Number(r.unit_price || 0)
    totalSellQty += sellQty
    totalRefundQty += refundQty
    totalRefundAmount += refundAmount
    totalNetAmount += sellAmount - refundAmount
    const cur = map.get(key) || {
      link_id: key,
      product_name: r.product_name || '',
      platform: r.platform || '',
      quantity: 0,
      refund_qty: 0,
      refund_amount: 0,
      sellAmount: 0,
      netQty: 0,
      netAmount: 0,
      days: new Set<string>(),
      latest_date: '',
      overseas_stock: null as any,
      avg_price: null as any,
    }
    cur.quantity += sellQty
    cur.refund_qty += refundQty
    cur.refund_amount += refundAmount
    cur.sellAmount += sellAmount
    cur.netQty = cur.quantity - cur.refund_qty
    cur.netAmount = cur.sellAmount - cur.refund_amount
    cur.days.add(d)
    if (!cur.latest_date || d > cur.latest_date) {
      cur.latest_date = d
      cur.overseas_stock = r.overseas_stock != null ? Number(r.overseas_stock) : null
      if (r.product_name) cur.product_name = r.product_name
      if (r.platform) cur.platform = r.platform
    }
    map.set(key, cur)
  }
  const aggRows: any[] = []
  for (const v of map.values()) {
    aggRows.push({
      ...v,
      days: v.days.size,
      avg_price: v.netQty > 0 ? Number((v.netAmount / v.netQty).toFixed(2)) : v.avg_price,
    })
  }
  totalNetQty = totalSellQty - totalRefundQty
  return { aggRows, totalSellQty, totalRefundQty, totalRefundAmount, totalNetQty, totalNetAmount, dateSet }
}

// 全量翻页拉取 daily_sales
async function fetchDailySales(saleFrom: string, saleTo: string, keyword: string) {
  const all: any[] = []
  const params: any = { page: 1, pageSize: 200, sale_from: saleFrom, sale_to: saleTo, keyword }
  for (;;) {
    const { data } = await api.get('/daily-sales', { params })
    ;(data.data ?? []).forEach((r: any) => all.push(r))
    if (all.length >= (data.total ?? 0) || !(data.data ?? []).length) break
    params.page++
  }
  return all
}

async function load() {
  loading.value = true
  try {
    const from = dateRange.value?.[0] || ''
    const to = dateRange.value?.[1] || ''

    // 当前周期
    const curRows = await fetchDailySales(from, to, query.keyword)
    const cur = aggregate(curRows)

    // 上一等长周期（用于环比）：从当前周期长度往前推
    const prevFrom = from ? shiftDate(from, -(dayDiff(from, to) + 1)) : ''
    const prevTo = from ? shiftDate(from, -1) : ''
    let prevMap = new Map<string, any>()
    let prevTotalSellQty = 0
    let prevTotalRefundQty = 0
    let prevTotalRefundAmount = 0
    let prevTotalNetQty = 0
    let prevTotalNetAmount = 0
    let prevDateSet = new Set<string>()
    if (prevFrom && prevTo) {
      const prevRows = await fetchDailySales(prevFrom, prevTo, query.keyword)
      const prev = aggregate(prevRows)
      prevMap = new Map(prev.aggRows.map((r) => [String(r.link_id), r]))
      prevTotalSellQty = prev.totalSellQty
      prevTotalRefundQty = prev.totalRefundQty
      prevTotalRefundAmount = prev.totalRefundAmount
      prevTotalNetQty = prev.totalNetQty
      prevTotalNetAmount = prev.totalNetAmount
      prevDateSet = prev.dateSet
    }

    // 拉取商品图片映射
    const imageMap: Record<string, string> = {}
    {
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
    }

    // 合并环比数据（基于实际销量 netQty）
    aggRows.value = cur.aggRows.map((r: any) => {
      const key = String(r.link_id)
      const prev = prevMap.get(key)
      const prevQty = prev ? Number(prev.netQty || 0) : 0
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
      sellQty: cur.totalSellQty,
      refundQty: cur.totalRefundQty,
      refundAmount: cur.totalRefundAmount,
      netQty: cur.totalNetQty,
      netAmount: cur.totalNetAmount,
      days: cur.dateSet.size,
    }
    const prevKpi: any = {
      links: prevMap.size,
      sellQty: prevTotalSellQty,
      refundQty: prevTotalRefundQty,
      refundAmount: prevTotalRefundAmount,
      netQty: prevTotalNetQty,
      netAmount: prevTotalNetAmount,
      days: prevDateSet.size,
    }
    summary.value = {
      rows: aggRows.value.length,
      sellQty: cur.totalSellQty,
      refundQty: cur.totalRefundQty,
      quantity: cur.totalNetQty,
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
    { label: '退款金额', value: fmtMoney(k.refundAmount ?? 0), unit: 'MXN', trend: trendOf(k.refundAmount ?? 0, pk.refundAmount ?? 0) },
    { label: '实际销量', value: k.netQty ?? 0, unit: '件', trend: trendOf(k.netQty ?? 0, pk.netQty ?? 0) },
    { label: '总销售额', value: fmtMoney(k.netAmount ?? 0), unit: 'MXN', trend: trendOf(k.netAmount ?? 0, pk.netAmount ?? 0) },
    { label: '有销量天数', value: k.days ?? 0, unit: '天', trend: trendOf(k.days ?? 0, pk.days ?? 0) },
  ]
})

function fmtMoney(v: number) {
  return Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

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

function onSortChange({ prop, order }: { prop: string; order: 'ascending' | 'descending' | null }) {
  sortState.prop = prop || ''
  sortState.order = order
  query.page = 1
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

function downloadTpl() {
  downloadTemplate(
    [
      { label: '日期', sample: '2026-08-04' },
      { label: '站点', sample: 'Mexico' },
      { label: '商品ID', sample: 'MLM2553999543' },
      { label: '实际销量', sample: 8 },
      { label: '平均售价(MXN)', sample: 248.51 },
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
    const { headers, rows } = await readExcelFile(file)
    const col = buildColMap(headers, {
      sale_date: ['日期', 'date', 'sale_date'],
      platform: ['站点', '平台', 'platform'],
      link_id: ['商品ID', '链接ID', 'link_id', 'linkId'],
      quantity: ['实际销量', '销量', 'quantity', 'qty'],
      unit_price: ['平均售价(MXN)', '平均售价', '单价', 'price', 'unit_price'],
      overseas_stock: ['可用库存', '海外库存', 'overseas_stock', 'stock'],
    })
    if (col.link_id === undefined || col.quantity === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"商品ID"和"实际销量"列')
      return
    }
    const linkMap: Record<string, any> = {}
    let page = 1
    for (;;) {
      const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
      ;(data.data ?? []).forEach((p: any) => {
        if (p.link_id) linkMap[String(p.link_id).trim()] = p
      })
      if (page * 200 >= (data.total ?? 0)) break
      page++
    }
    const payloadRows: any[] = []
    const errLines: string[] = []
    const stockMap = new Map<string, { sale_date: string; stock: number }>()
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
      if (qty === 0) {
        errLines.push(`第${lineNo}行：实际销量不能为 0`)
        continue
      }
      // 允许负销量：代表退款/退货，导入时扣减
      const product = linkMap[linkId]
      const item: any = {
        link_id: linkId,
        quantity: qty,
        unit_price: col.unit_price !== undefined ? cellNum(row, col.unit_price) : 0,
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
    for (const [pid, v] of stockMap) {
      await api.patch(`/products/${pid}`, { overseas_stock: v.stock })
    }
    if (!payloadRows.length) {
      ElMessage.warning('没有可导入的数据')
      return
    }
    try {
      const { data } = await api.post('/daily-sales', { rows: payloadRows })
      const ok = data.data?.imported ?? payloadRows.length
      if (errLines.length) {
        ElMessage.warning(`成功导入 ${ok} 条，失败 ${errLines.length} 条：` + errLines.slice(0, 5).join('；') + (errLines.length > 5 ? ` 等 ${errLines.length} 条` : ''))
      } else {
        ElMessage.success(`成功导入 ${ok} 条`)
      }
    } catch (err: any) {
      errLines.push(err?.response?.data?.error?.message || '导入失败')
      ElMessage.error('导入失败：' + errLines.slice(-1)[0])
    }
    dateRange.value = todayRange()
    quickDays.value = 0
    query.page = 1
    load()
  } catch (err: any) {
    ElMessage.error(err?.message || '导入失败')
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
    { key: 'avg_price', label: '平均售价(MXN)', value: (r: any) => (r.avg_price != null ? Number(r.avg_price) : '') },
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
