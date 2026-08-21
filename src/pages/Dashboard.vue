<template>
  <div class="ov-page">
    <div class="page-header">
      <div>
        <h2>概况</h2>
        <span class="page-tip">经营数据总览</span>
      </div>
      <el-button :loading="loading" @click="loadAll">刷新</el-button>
    </div>

    <div class="filters">
      <div class="quick-group">
        <button
          v-for="d in quickDays"
          :key="d.days"
          class="quick"
          :class="{ active: activeDays === d.days && !customRange }"
          @click="setQuick(d.days)"
        >{{ d.label }}</button>
      </div>
      <div class="range-box">
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 260px"
        />
      </div>
      <el-button size="default" :loading="loading" @click="applyCustom">查询</el-button>
    </div>

    <div class="kpi-row" v-loading="loading">
      <div class="kpi">
        <div class="label">销售额（MXN）<span class="ico">💰</span></div>
        <div class="value">{{ fmtKpi(d.summary.sale_amount) }} <small>MXN</small></div>
        <div class="trend" :class="trendCls(d.summary.sale_amount, d.summary.prev_sale_amount)">
          {{ trendText(d.summary.sale_amount, d.summary.prev_sale_amount) }}
        </div>
      </div>
      <div class="kpi">
        <div class="label">销售数量<span class="ico">📦</span></div>
        <div class="value">{{ fmtKpi(d.summary.sale_qty) }} <small>件</small></div>
        <div class="trend" :class="trendCls(d.summary.sale_qty, d.summary.prev_sale_qty)">
          {{ trendText(d.summary.sale_qty, d.summary.prev_sale_qty) }}
        </div>
      </div>
      <div class="kpi">
        <div class="label">发货量<span class="ico">🚚</span></div>
        <div class="value">{{ fmtKpi(d.summary.ship_qty) }} <small>单</small></div>
        <div class="trend" :class="trendCls(d.summary.ship_qty, d.summary.prev_ship_qty)">
          {{ trendText(d.summary.ship_qty, d.summary.prev_ship_qty) }}
        </div>
      </div>
      <div class="kpi">
        <div class="label">售后工单<span class="ico">🛠️</span></div>
        <div class="value">{{ fmtKpi(d.summary.after_count) }} <small>单</small></div>
        <div class="trend" :class="trendCls(d.summary.after_count, d.summary.prev_after_count)">
          {{ trendText(d.summary.after_count, d.summary.prev_after_count) }}
        </div>
      </div>
      <div class="kpi">
        <div class="label">退款金额（MXN）<span class="ico">↩️</span></div>
        <div class="value">{{ fmtKpi(d.summary.refund_amount) }} <small>MXN</small></div>
        <div class="trend flat">销售 - 退款 = 实际销量</div>
      </div>
      <div class="kpi">
        <div class="label">出单链接数<span class="ico">🔗</span></div>
        <div class="value">{{ fmtKpi(d.summary.link_count) }} <small>个</small></div>
        <div class="trend flat">有效在售链接</div>
      </div>
      <div class="kpi">
        <div class="label">在途货件<span class="ico">🚢</span></div>
        <div class="value">{{ fmtKpi(d.warn.in_transit.length) }} <small>批</small></div>
        <div class="trend flat">国内 → 海外仓</div>
      </div>
      <div class="kpi">
        <div class="label">安全库存达标率<span class="ico">✅</span></div>
        <div class="value">{{ d.safety_rate.rate != null ? d.safety_rate.rate + '%' : '--' }} <small>{{ d.safety_rate.pass }}/{{ d.safety_rate.total }}</small></div>
        <div class="trend flat">达标商品 / 已设安全库存</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>销售 / 发货 / 售后趋势 <span class="more">{{ periodText }}</span></h2>
        <div class="trend-wrap">
          <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" v-if="d.trend && d.trend.length">
            <line v-for="(yv, xi) in yLines" :key="'y' + xi" :x1="0" :y1="yv" :x2="W" :y2="yv" stroke="#ebeef5" stroke-width="1" />
            <polyline :points="linePoints('sale')" fill="none" stroke="#67c23a" stroke-width="2" />
            <polyline :points="linePoints('ship')" fill="none" stroke="#409eff" stroke-width="2" />
            <polyline :points="linePoints('after')" fill="none" stroke="#e6a23c" stroke-width="2" />
          </svg>
        </div>
        <div class="legend">
          <span><i style="background:#67c23a"></i>销售数量</span>
          <span><i style="background:#409eff"></i>发货量</span>
          <span><i style="background:#e6a23c"></i>售后工单</span>
        </div>
      </div>
      <div class="card">
        <h2>平台销售分布 <span class="more">按净销量</span></h2>
        <div class="donut-wrap">
          <svg width="150" height="150" viewBox="0 0 150 150" v-if="d.platforms && d.platforms.length">
            <circle cx="75" cy="75" r="60" fill="none" stroke="#f0f2f5" stroke-width="24" />
            <circle
              v-for="(p, i) in donutArcs"
              :key="p.name"
              cx="75" cy="75" r="60" fill="none"
              :stroke="p.color" stroke-width="24"
              :stroke-dasharray="p.dash"
              :stroke-dashoffset="p.offset"
              transform="rotate(-90 75 75)"
            />
            <text x="75" y="72" text-anchor="middle" font-size="14" font-weight="700" fill="#303133">{{ donutTopName }}</text>
            <text x="75" y="90" text-anchor="middle" font-size="11" fill="#909399">{{ donutTopPct }}%</text>
          </svg>
          <div class="donut-legend">
            <div v-for="p in d.platforms" :key="p.name" class="dl-item">
              <span class="dl-dot" :style="{ background: platformColor(p.name) }"></span>
              <span class="dl-name">{{ p.name }}</span>
              <span class="dl-val">{{ p.value }}</span>
              <span class="dl-pct">{{ platformPct(p.value) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-card shadow="never" class="recent-card">
      <template #header>
        <div class="card-header">
          <span>最近发货动态</span>
          <el-button link type="primary" @click="loadRecent">刷新</el-button>
        </div>
      </template>
      <el-table v-loading="loadingRecent" :data="recentShipments" border stripe empty-text="暂无发货记录">
        <el-table-column prop="tracking_no" label="运单号" min-width="180" />
        <el-table-column label="货代" width="120">
          <template #default="{ row }">{{ row.forwarders?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="空海运" width="100">
          <template #default="{ row }">{{ row.shipping_mode || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓号" width="100">
          <template #default="{ row }">{{ row.warehouse_no || '-' }}</template>
        </el-table-column>
        <el-table-column label="发货数量" width="110">
          <template #default="{ row }">{{ row.shipping_qty ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="货物状态" width="120">
          <template #default="{ row }">
            <span v-if="row.cargo_status">{{ row.cargo_status }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" min-width="180">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/services/api'

const W = 720
const H = 150
const quickDays = [
  { days: 0, label: '今天' },
  { days: 7, label: '近7天' },
  { days: 30, label: '近30天' },
  { days: 60, label: '近60天' }
]

const loading = ref(false)
const loadingRecent = ref(false)
const activeDays = ref(7)
const customRange = ref(false)
const range = ref<[string, string] | null>(null)

const d = reactive({
  period: { start: '', end: '', days: 0 },
  summary: {
    sale_qty: 0, refund_qty: 0, refund_amount: 0, sale_amount: 0,
    ship_qty: 0, after_count: 0, link_count: 0,
    prev_sale_qty: 0, prev_sale_amount: 0, prev_ship_qty: 0, prev_after_count: 0
  },
  platforms: [] as any[],
  trend: [] as any[],
  warn: { low_stock: [] as any[], in_transit: [] as any[] },
  safety_rate: { total: 0, pass: 0, rate: null as number | null }
})

const stats = ref<any>({ recent_shipments: [] })
const recentShipments = computed(() => stats.value.recent_shipments || [])

async function loadAnalysis() {
  loading.value = true
  try {
    const params: any = {}
    if (customRange.value && range.value && range.value[0] && range.value[1]) {
      params.from = range.value[0]
      params.to = range.value[1]
    } else {
      params.days = activeDays.value
    }
    const res: any = await api.get('/analysis', { params })
    const data = res?.data?.data || res?.data || {}
    d.summary = Object.assign({ sale_qty: 0, refund_qty: 0, refund_amount: 0, sale_amount: 0, ship_qty: 0, after_count: 0, link_count: 0, prev_sale_qty: 0, prev_sale_amount: 0, prev_ship_qty: 0, prev_after_count: 0 }, data.summary || {})
    d.platforms = data.platforms || []
    d.trend = data.trend || []
    d.warn = Object.assign({ low_stock: [], in_transit: [] }, data.warn || {})
    d.safety_rate = Object.assign({ total: 0, pass: 0, rate: null }, data.safety_rate || {})
    d.period = data.period || { start: '', end: '', days: 0 }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '概况数据加载失败')
  } finally {
    loading.value = false
  }
}

async function loadRecent() {
  loadingRecent.value = true
  try {
    const { data } = await api.get('/dashboard/stats')
    stats.value = data.data ?? stats.value
  } catch (e: any) {
    try {
      await new Promise((r) => setTimeout(r, 1500))
      const { data: retryData } = await api.get('/dashboard/stats')
      stats.value = retryData.data ?? stats.value
    } catch (e2: any) {
      ElMessage.error(e2?.response?.data?.error?.message || '加载最近发货动态失败')
    }
  } finally {
    loadingRecent.value = false
  }
}

async function loadAll() {
  await Promise.all([loadAnalysis(), loadRecent()])
}

function setQuick(days: number) {
  activeDays.value = days
  customRange.value = false
  range.value = null
  loadAnalysis()
}
function applyCustom() {
  if (!range.value || !range.value[0] || !range.value[1]) {
    ElMessage.warning('请选择开始和结束日期')
    return
  }
  customRange.value = true
  loadAnalysis()
}

const periodText = computed(() => {
  if (!d.period.start) return ''
  if (d.period.start === d.period.end) return d.period.start
  return `${d.period.start} ~ ${d.period.end}（${d.period.days} 天）`
})

function fmtKpi(v: number): string {
  if (v == null || isNaN(v)) return '0'
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + 'w'
  return v.toLocaleString()
}
function trendCls(cur: number, prev: number): string {
  const pct = pctOf(cur, prev)
  if (pct == null) return 'flat'
  return pct >= 0 ? 'up' : 'down'
}
function trendText(cur: number, prev: number): string {
  const pct = pctOf(cur, prev)
  if (pct == null) return '上期无数据'
  return '环比 ' + (pct >= 0 ? '↑' : '↓') + Math.abs(pct).toFixed(1) + '%'
}
function pctOf(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

const yLines = computed(() => {
  const arr = []
  for (let i = 0; i <= 4; i++) arr.push((H / 5) * i + 8)
  return arr
})
function linePoints(key: string): string {
  const t = d.trend || []
  if (!t.length) return ''
  const max = Math.max(1, ...t.map((x) => Number(x[key]) || 0))
  const step = t.length > 1 ? W / (t.length - 1) : W
  return t
    .map((x, i) => {
      const px = i * step
      const py = H - 6 - ((Number(x[key]) || 0) / max) * (H - 24)
      return `${px.toFixed(1)},${py.toFixed(1)}`
    })
    .join(' ')
}

const PLATFORM_COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399', '#9c6ade']
function platformColor(name: string): string {
  const idx = (d.platforms || []).findIndex((p) => p.name === name)
  return PLATFORM_COLORS[idx >= 0 ? idx : 0]
}
const totalPlatform = computed(() => (d.platforms || []).reduce((s, p) => s + p.value, 0))
function platformPct(v: number): string {
  if (!totalPlatform.value) return '0'
  return ((v / totalPlatform.value) * 100).toFixed(1)
}
const donutArcs = computed(() => {
  const total = totalPlatform.value || 1
  const C = 2 * Math.PI * 60
  let acc = 0
  return (d.platforms || []).map((p) => {
    const frac = p.value / total
    const dash = `${frac * C} ${C - frac * C}`
    const offset = -acc * C
    acc += frac
    return { name: p.name, color: platformColor(p.name), dash, offset }
  })
})
const donutTopName = computed(() => (d.platforms || [])[0]?.name || '')
const donutTopPct = computed(() => (d.platforms || []).length ? platformPct((d.platforms || [])[0].value) : '0')

function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
  loadAll()
})
</script>

<style scoped>
.ov-page { min-width: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { font-size: 20px; margin: 0; color: var(--ink); }
.page-tip { font-size: 13px; color: var(--ink-3); }

.filters { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.quick-group { display: flex; gap: 6px; }
.quick { background: var(--glass-bg, #fff); border: 1px solid var(--border, #dcdfe6); border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; color: var(--ink-2); }
.quick.active { background: var(--accent, #409eff); color: #fff; border-color: var(--accent, #409eff); }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi { background: var(--glass-bg, #fff); border-radius: 10px; padding: 16px 18px; box-shadow: var(--shadow, 0 1px 4px rgba(0,0,0,.06)); }
.kpi .label { font-size: 13px; color: var(--ink-3); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
.kpi .label .ico { font-size: 18px; }
.kpi .value { font-size: 24px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.kpi .value small { font-size: 12px; font-weight: 400; color: var(--ink-3); margin-left: 4px; }
.kpi .trend { font-size: 12px; margin-top: 6px; }
.up { color: #f56c6c; }
.down { color: #67c23a; }
.flat { color: var(--ink-3, #909399); }

.card { background: var(--glass-bg, #fff); border-radius: 10px; padding: 20px 24px; margin-bottom: 20px; box-shadow: var(--shadow, 0 1px 4px rgba(0,0,0,.06)); }
.card h2 { font-size: 15px; margin: 0 0 14px; border-left: 4px solid var(--accent, #409eff); padding-left: 10px; display: flex; justify-content: space-between; align-items: center; color: var(--ink); }
.card h2 .more { font-size: 12px; color: var(--ink-3); font-weight: 400; border-left: none; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

.trend-wrap { height: 160px; position: relative; }
.trend-wrap svg { width: 100%; height: 100%; display: block; }
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--ink-2); margin-top: 8px; flex-wrap: wrap; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }

.donut-wrap { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.donut-legend { flex: 1; min-width: 150px; }
.dl-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 7px 0; }
.dl-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.dl-name { flex: 1; color: var(--ink-2); }
.dl-val { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink); }
.dl-pct { color: var(--ink-3); width: 46px; text-align: right; }

.recent-card { margin-top: 8px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }

@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .kpi-row { grid-template-columns: 1fr 1fr; gap: 10px; }
  .kpi .value { font-size: 18px; }
}
</style>
