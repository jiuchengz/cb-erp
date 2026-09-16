<template>
  <div class="page board-page">
    <div class="page-header">
      <div>
        <h2>商品销量看板</h2>
        <span class="page-sub">
          一货一行 · 销量与走势随窗口（7/15/30 天）联动 · 点击「近 N 天走势」查看逐日明细 · 滞销预警（连续超 {{ slowDays }} 天未出单）/ 补货建议
        </span>
        <div class="src-tip">
          数据来源：可用库存 = 销售统计导入的商品主档可用库存（products.overseas_stock）；销量/走势 = 销售统计 daily_sales；
          国内仓库存 = 库存管理 inventory（国内仓）；在途 = 物流发货中调拨未入仓货件；商品图片与编码 = 商品管理
        </div>
      </div>
      <div class="header-right">
        <span v-if="generatedAt" class="gen-time">数据更新：{{ generatedAt }}</span>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">商品总数</div>
        <div class="kpi-value">{{ kpi.total ?? 0 }}</div>
        <div class="kpi-foot">海外可用库存 {{ fmt(kpi.overseas_stock) }} · 在途 {{ fmt(kpi.in_transit_qty) }}</div>
      </div>
      <div class="kpi-card danger">
        <div class="kpi-label">需立即补货</div>
        <div class="kpi-value">{{ kpi.urgent ?? 0 }}</div>
        <div class="kpi-foot">可售天数低于 7 天或已断货</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-label">滞销待调整</div>
        <div class="kpi-value">{{ kpi.slow ?? 0 }}</div>
        <div class="kpi-foot">海外有库存且连续超 {{ slowDays }} 天无出单</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">建议补货</div>
        <div class="kpi-value">{{ kpi.replenish ?? 0 }}</div>
        <div class="kpi-foot">可售天数低于 15 天</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">近 {{ windowDays }} 天销量</div>
        <div class="kpi-value">{{ fmt(kpi.qty_period) }}</div>
        <div class="kpi-foot">
          环比
          <span :class="growthClass(kpi.growth_pct)">
            {{ kpi.growth_pct === null || kpi.growth_pct === undefined ? '—' : (kpi.growth_pct > 0 ? '+' : '') + kpi.growth_pct + '%' }}
          </span>
        </div>
      </div>
      <div class="kpi-card ok">
        <div class="kpi-label">补货建议总量</div>
        <div class="kpi-value">{{ fmt(kpi.suggest_qty) }}</div>
        <div class="kpi-foot">覆盖 {{ kpi.suggest_sku ?? 0 }} 个商品 · {{ targetCoverDays }} 天目标</div>
      </div>
    </div>

    <div class="toolbar">
      <el-radio-group v-model="windowDays" @change="onWindowChange">
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="15">近 15 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
      </el-radio-group>
      <el-input v-model="search" placeholder="搜索产品编号 / SKU / 名称 / 链接ID" clearable class="toolbar-search" />
      <el-select v-model="stateFilter" class="toolbar-select">
        <el-option label="全部状态" value="all" />
        <el-option label="仅异常（需补货 / 滞销）" value="abnormal" />
        <el-option label="需立即补货" value="urgent" />
        <el-option label="滞销待调整" value="slow" />
        <el-option label="建议补货" value="replenish" />
        <el-option label="正常" value="ok" />
      </el-select>
      <el-checkbox v-model="onlyOverseas">仅看有海外仓库存</el-checkbox>
      <el-button @click="exportCsv">导出 CSV</el-button>
    </div>

    <el-table
      :data="pagedRows"
      v-loading="loading"
      stripe
      class="table-main"
      :default-sort="{ prop: 'qty_period', order: 'descending' }"
      @row-click="openDetail"
    >
      <el-table-column label="图片" width="72" align="center">
        <template #default="{ row }">
          <el-image
            v-if="row.image_url"
            :src="row.image_url"
            fit="cover"
            class="prod-img"
            :preview-src-list="[row.image_url]"
            preview-teleported
            @click.stop
          />
          <span v-else class="img-placeholder">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="code" label="产品编号" min-width="130" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" min-width="190" show-overflow-tooltip />
      <el-table-column prop="link_id" label="链接ID" min-width="130" show-overflow-tooltip />
      <el-table-column label="可用库存（海外）" width="140" align="right" sortable prop="overseas_stock">
        <template #header>
          <el-tooltip content="来源：销售统计导入的商品主档可用库存（products.overseas_stock）；主档为 0 时依次回退销售统计最新快照、海外仓库账面" placement="top">
            <span>可用库存（海外）</span>
          </el-tooltip>
        </template>
        <template #default="{ row }">
          <span>{{ fmt(row.overseas_stock) }}</span>
          <el-tooltip v-if="row.overseas_source && row.overseas_source !== 'master'" placement="top"
            :content="row.overseas_source === 'snapshot' ? `主档为 0，取销售统计最新快照（${row.snapshot_overseas_stock}）` : `主档与快照均为 0，取海外仓库账面（${row.warehouse_overseas_stock}）`">
            <el-tag size="small" type="warning" effect="plain" class="src-tag">回退</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="domestic_stock" label="国内库存" width="100" align="right" sortable />
      <el-table-column prop="in_transit_qty" label="在途" width="90" align="right" sortable />
      <el-table-column :label="`近${windowDays}天销量`" width="110" align="right" sortable prop="qty_period" />
      <el-table-column label="环比" width="100" align="right">
        <template #default="{ row }">
          <span :class="growthClass(row.growth_pct)">
            {{ row.growth_pct === null ? '新增' : (row.growth_pct > 0 ? '+' : '') + row.growth_pct + '%' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="daily_avg" label="日均" width="90" align="right" sortable />
      <el-table-column label="可售天数" width="100" align="right">
        <template #default="{ row }">
          <span v-if="row.days_cover === null">—</span>
          <span v-else :class="{ 'txt-danger': row.days_cover < 7, 'txt-warn': row.days_cover >= 7 && row.days_cover < 15 }">
            {{ row.days_cover }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="最后出单" width="115" align="center">
        <template #default="{ row }">
          <span v-if="row.last_sale_date">{{ row.last_sale_date }}</span>
          <span v-else class="img-placeholder">90 天以上无</span>
        </template>
      </el-table-column>
      <el-table-column label="未出单天数" width="105" align="right">
        <template #default="{ row }">
          <span :class="{ 'txt-warn': row.state === 'slow' }">{{ row.never_sold ? '90+' : row.days_since_sale }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="`近${windowDays}天走势`" width="132" align="center">
        <template #default="{ row }">
          <el-tooltip content="点击查看逐日明细走势" placement="top">
            <div class="spark" @click.stop="openDetail(row)">
              <span
                v-for="(v, i) in row.trend"
                :key="i"
                class="spark-bar"
                :class="{ zero: !v, neg: v < 0 }"
                :style="{ height: barHeight(row, v) }"
                :title="`${trendDates[i]}：${v}`"
              ></span>
            </div>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="suggest_qty" label="补货建议" width="105" align="right" sortable>
        <template #default="{ row }">
          <strong v-if="row.suggest_qty > 0" class="txt-strong">{{ row.suggest_qty }}</strong>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120" align="center" fixed="right">
        <template #default="{ row }">
          <el-tag :type="tagType(row.state)" effect="light" size="small">{{ row.state_label }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager-wrap">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="filteredRows.length"
        :page-sizes="[20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
      />
    </div>

    <el-drawer v-model="detailVisible" size="70%" destroy-on-close :title="detailTitle">
      <div v-loading="detailLoading" class="detail-wrap">
        <template v-if="detail">
          <div class="detail-head">
            <el-image v-if="detail.product.image_url" :src="detail.product.image_url" fit="cover" class="detail-img"
              :preview-src-list="[detail.product.image_url]" preview-teleported />
            <div v-else class="detail-img detail-img-empty">无图</div>
            <div class="detail-info">
              <div class="detail-name">{{ detail.product.name }}</div>
              <div class="detail-meta">
                <span>编号：{{ detail.product.code || '—' }}</span>
                <span>SKU：{{ detail.product.sku || '—' }}</span>
                <span>链接ID：{{ detail.product.link_id || '—' }}</span>
                <span>单位：{{ detail.product.unit }}</span>
              </div>
              <div class="detail-meta">
                <el-tag :type="tagType(detail.summary.state)" effect="light" size="small">{{ detail.summary.state_label }}</el-tag>
                <span class="meta-gap">统计窗口：{{ detail.summary.from }} ~ {{ detail.summary.to }}（{{ detail.summary.days }} 天）</span>
              </div>
            </div>
            <div class="detail-head-right">
              <el-radio-group v-model="windowDays" size="small" @change="onWindowChange">
                <el-radio-button :value="7">7 天</el-radio-button>
                <el-radio-button :value="15">15 天</el-radio-button>
                <el-radio-button :value="30">30 天</el-radio-button>
              </el-radio-group>
            </div>
          </div>

          <el-descriptions title="库存与在途（来源：销售统计导入 / 库存管理 / 物流发货）" :column="4" border class="detail-block">
            <el-descriptions-item label="可用库存（海外）">
              <strong>{{ fmt(detail.stock.overseas_stock) }}</strong>
              <span class="cell-note">主档 {{ fmt(detail.stock.master_overseas_stock) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="销售统计快照">
              {{ fmt(detail.stock.snapshot_overseas_stock) }}
              <span v-if="detail.stock.snapshot_date" class="cell-note">{{ detail.stock.snapshot_date }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="海外仓库账面">{{ fmt(detail.stock.warehouse_overseas_stock) }}</el-descriptions-item>
            <el-descriptions-item label="国内仓库存">{{ fmt(detail.stock.domestic_stock) }}</el-descriptions-item>
            <el-descriptions-item label="调拨在途">{{ fmt(detail.stock.in_transit_qty) }}</el-descriptions-item>
            <el-descriptions-item label="安全库存">{{ fmt(detail.stock.safety_stock) }}</el-descriptions-item>
            <el-descriptions-item label="窗口销量">{{ fmt(detail.summary.qty_period) }}</el-descriptions-item>
            <el-descriptions-item label="上期销量（环比）">
              {{ fmt(detail.summary.qty_prev) }}
              <span :class="growthClass(detail.summary.growth_pct)" class="cell-note">
                {{ detail.summary.growth_pct === null ? '新增' : (detail.summary.growth_pct > 0 ? '+' : '') + detail.summary.growth_pct + '%' }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="日均销量">{{ detail.summary.daily_avg }}</el-descriptions-item>
            <el-descriptions-item label="可售天数">{{ detail.summary.days_cover === null ? '—' : detail.summary.days_cover }}</el-descriptions-item>
            <el-descriptions-item label="最后出单">{{ detail.summary.last_sale_date || '90 天以上无' }}</el-descriptions-item>
            <el-descriptions-item label="未出单天数">{{ detail.summary.never_sold ? '90+' : detail.summary.days_since_sale }}</el-descriptions-item>
            <el-descriptions-item label="补货建议" :span="2">
              <strong class="txt-strong">{{ detail.summary.suggest_qty }}</strong>
              <span class="cell-note">= ceil(日均 × {{ targetCoverDays }} − 可用库存 − 在途)，滞销不补货</span>
            </el-descriptions-item>
            <el-descriptions-item label="退款金额合计（窗口）" :span="2">{{ fmt(refundTotal) }}</el-descriptions-item>
          </el-descriptions>

          <div class="detail-block">
            <div class="block-title">逐日走势（净销量 = 销售数量 − 退款数量，共 {{ detail.summary.days }} 天）</div>
            <div class="chart-box" v-if="chart">
              <svg class="trend-svg" :viewBox="`0 0 ${chart.w} ${chart.h}`">
                <line v-for="(g, i) in chart.grid" :key="'g' + i" :x1="chart.padL" :x2="chart.w - chart.padR" :y1="g.y" :y2="g.y"
                  stroke="rgba(144,147,153,0.35)" stroke-dasharray="4 4" />
                <text v-for="(g, i) in chart.grid" :key="'gt' + i" :x="chart.padL - 8" :y="Number(g.y) + 4" text-anchor="end"
                  class="axis-text">{{ g.label }}</text>
                <polygon :points="chart.area" fill="rgba(64,158,255,0.12)" />
                <polyline :points="chart.pts" fill="none" stroke="#409eff" stroke-width="2" stroke-linejoin="round" />
                <circle v-for="(b, i) in chart.bars" :key="'c' + i" :cx="b.x" :cy="b.y" :r="b.net_qty ? 3.5 : 2"
                  :fill="b.net_qty > 0 ? '#409eff' : b.net_qty < 0 ? '#f56c6c' : '#dcdfe6'">
                  <title>{{ b.date }}：净销量 {{ b.net_qty }}（销售 {{ b.quantity }} / 退款 {{ b.refund_qty }}）</title>
                </circle>
                <text v-for="(l, i) in chart.labels" :key="'lb' + i" :x="l.x" :y="chart.h - 8" text-anchor="middle" class="axis-text">{{ l.text }}</text>
              </svg>
            </div>
            <el-empty v-else description="窗口内无销售记录" :image-size="70" />
          </div>

          <div class="detail-block">
            <div class="block-title">逐日明细（最新在前）</div>
            <el-table :data="detailRows" max-height="360" size="small" stripe>
              <el-table-column prop="date" label="日期" width="120" />
              <el-table-column label="平台" min-width="120">
                <template #default="{ row }">{{ (row.platforms || []).join(' / ') || '—' }}</template>
              </el-table-column>
              <el-table-column prop="quantity" label="销售数量" width="100" align="right" />
              <el-table-column prop="refund_qty" label="退款数量" width="100" align="right" />
              <el-table-column prop="net_qty" label="净销量" width="100" align="right">
                <template #default="{ row }">
                  <strong :class="{ 'txt-strong': row.net_qty > 0, 'txt-danger': row.net_qty < 0 }">{{ row.net_qty }}</strong>
                </template>
              </el-table-column>
              <el-table-column label="单价" width="100" align="right">
                <template #default="{ row }">{{ row.unit_price ? fmt(row.unit_price) : '—' }}</template>
              </el-table-column>
              <el-table-column label="退款金额" width="110" align="right">
                <template #default="{ row }">{{ row.refund_amount ? fmt(row.refund_amount) : '—' }}</template>
              </el-table-column>
              <el-table-column label="可用库存快照" width="120" align="right">
                <template #default="{ row }">{{ row.overseas_stock != null ? fmt(row.overseas_stock) : '—' }}</template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/services/api'

const windowDays = ref(30)
const slowDays = ref(3)
const targetCoverDays = ref(30)
const search = ref('')
const stateFilter = ref('all')
const onlyOverseas = ref(false)
const rows = ref<any[]>([])
const trendDates = ref<string[]>([])
const kpi = ref<any>({})
const generatedAt = ref('')
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<any>(null)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/product-sales-board', { params: { days: windowDays.value } })
    rows.value = data.rows ?? []
    kpi.value = data.kpi ?? {}
    trendDates.value = data.trend_dates ?? []
    generatedAt.value = data.generated_at ?? ''
    slowDays.value = data.slow_days ?? 3
    targetCoverDays.value = data.target_cover_days ?? 30
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '加载失败'
    const { ElMessage } = await import('element-plus')
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

async function openDetail(row: any) {
  if (!row?.id) return
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const { data } = await api.get('/product-sales-board', { params: { product_id: row.id, days: windowDays.value } })
    detail.value = data
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '明细加载失败'
    const { ElMessage } = await import('element-plus')
    ElMessage.error(msg)
  } finally {
    detailLoading.value = false
  }
}

function onWindowChange() {
  page.value = 1
  load()
  if (detailVisible.value && detail.value?.product?.id) {
    const id = detail.value.product.id
    detailLoading.value = true
    api
      .get('/product-sales-board', { params: { product_id: id, days: windowDays.value } })
      .then(({ data }) => {
        detail.value = data
      })
      .catch(() => {})
      .finally(() => {
        detailLoading.value = false
      })
  }
}

const detailTitle = computed(() => '商品销量明细' + (detail.value?.product?.name ? ' · ' + detail.value.product.name : ''))

const detailRows = computed(() => [...(detail.value?.daily || [])].reverse())

const refundTotal = computed(() => (detail.value?.daily || []).reduce((a: number, d: any) => a + Number(d.refund_amount || 0), 0))

const chart = computed(() => {
  const daily: any[] = detail.value?.daily || []
  if (!daily.length) return null
  const w = 1000
  const h = 250
  const padL = 52
  const padR = 20
  const padT = 20
  const padB = 32
  const vals = daily.map((d) => Number(d.net_qty || 0))
  const maxV = Math.max(1, ...vals)
  const minV = Math.min(0, ...vals)
  const span = maxV - minV || 1
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const n = Math.max(1, daily.length - 1)
  const X = (i: number) => padL + (innerW * i) / n
  const Y = (v: number) => padT + innerH * (1 - (v - minV) / span)
  const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const baseY = Y(minV).toFixed(1)
  const area = `${padL},${baseY} ${pts} ${X(daily.length - 1).toFixed(1)},${baseY}`
  const grid = [0, 0.5, 1].map((t) => {
    const v = minV + span * (1 - t)
    return { y: Y(v).toFixed(1), label: String(Math.round(v)) }
  })
  const bars = daily.map((d, i) => ({ ...d, x: Number(X(i).toFixed(1)), y: Number(Y(Number(d.net_qty || 0)).toFixed(1)) }))
  const labelIdx = Array.from(new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1]))
  const labels = labelIdx.map((i) => ({ x: Number(X(i).toFixed(1)), text: String(daily[i].date).slice(5) }))
  return { w, h, padL, padR, pts, area, grid, bars, labels }
})

const filteredRows = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (onlyOverseas.value && Number(r.overseas_stock || 0) <= 0) return false
    if (stateFilter.value === 'abnormal' && !['urgent', 'slow', 'replenish'].includes(r.state)) return false
    if (stateFilter.value !== 'all' && stateFilter.value !== 'abnormal' && r.state !== stateFilter.value) return false
    if (kw) {
      const hit = [r.code, r.sku, r.name, r.link_id].some((v) => String(v || '').toLowerCase().includes(kw))
      if (!hit) return false
    }
    return true
  })
})

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

watch([search, stateFilter, onlyOverseas, pageSize], () => {
  page.value = 1
})

function fmt(v: any) {
  const n = Number(v || 0)
  return n.toLocaleString('zh-CN')
}

function growthClass(v: any) {
  if (v === null || v === undefined || Number(v) === 0) return ''
  return Number(v) > 0 ? 'txt-up' : 'txt-down'
}

function tagType(state: string) {
  if (state === 'urgent') return 'danger'
  if (state === 'slow') return 'warning'
  if (state === 'replenish') return 'primary'
  return 'info'
}

function barHeight(row: any, v: number) {
  const arr: number[] = row.trend || []
  const max = Math.max(1, ...arr.map((x: number) => Math.abs(Number(x) || 0)))
  return Math.max(2, Math.round((Math.abs(Number(v || 0)) / max) * 26)) + 'px'
}

function exportCsv() {
  const headers = [
    '产品编号',
    'SKU',
    '名称',
    '链接ID',
    '可用库存(海外)',
    '国内库存',
    '在途',
    `近${windowDays.value}天销量`,
    '环比%',
    '日均',
    '可售天数',
    '最后出单',
    '未出单天数',
    '补货建议',
    '状态'
  ]
  const lines = [headers.join(',')]
  for (const r of filteredRows.value) {
    const cells = [
      r.code,
      r.sku,
      r.name,
      r.link_id,
      r.overseas_stock,
      r.domestic_stock,
      r.in_transit_qty,
      r.qty_period,
      r.growth_pct === null ? '' : r.growth_pct,
      r.daily_avg,
      r.days_cover === null ? '' : r.days_cover,
      r.last_sale_date || '',
      r.never_sold ? '90+' : r.days_since_sale,
      r.suggest_qty,
      r.state_label
    ].map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`)
    lines.push(cells.join(','))
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `商品销量看板_近${windowDays.value}天_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<style scoped>
.board-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.page-header h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.page-sub {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.src-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 6px 10px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.gen-time {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.kpi-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--el-bg-color);
}
.kpi-card.danger {
  border-left: 3px solid var(--el-color-danger);
}
.kpi-card.warn {
  border-left: 3px solid var(--el-color-warning);
}
.kpi-card.ok {
  border-left: 3px solid var(--el-color-success);
}
.kpi-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.kpi-value {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.5;
}
.kpi-foot {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.toolbar-search {
  width: 280px;
}
.toolbar-select {
  width: 200px;
}
.prod-img {
  width: 42px;
  height: 42px;
  border-radius: 6px;
  display: inline-block;
  vertical-align: middle;
}
.img-placeholder {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}
.src-tag {
  margin-left: 4px;
}
.spark {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  height: 28px;
  cursor: pointer;
}
.spark-bar {
  width: 5px;
  background: var(--el-color-primary);
  border-radius: 2px 2px 0 0;
}
.spark-bar.zero {
  background: var(--el-border-color);
}
.spark-bar.neg {
  background: var(--el-color-danger);
}
.txt-danger {
  color: var(--el-color-danger);
  font-weight: 600;
}
.txt-warn {
  color: var(--el-color-warning);
  font-weight: 600;
}
.txt-strong {
  color: var(--el-color-primary);
}
.txt-up {
  color: var(--el-color-success);
}
.txt-down {
  color: var(--el-color-danger);
}
.pager-wrap {
  display: flex;
  justify-content: flex-end;
}
.detail-wrap {
  min-height: 200px;
}
.detail-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.detail-img {
  width: 84px;
  height: 84px;
  border-radius: 8px;
  flex: 0 0 auto;
}
.detail-img-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}
.detail-info {
  flex: 1;
  min-width: 0;
}
.detail-name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
}
.detail-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.meta-gap {
  margin-left: 6px;
}
.detail-head-right {
  flex: 0 0 auto;
}
.detail-block {
  margin-top: 16px;
}
.block-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}
.chart-box {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px 4px;
}
.trend-svg {
  width: 100%;
  height: auto;
  display: block;
}
.axis-text {
  font-size: 12px;
  fill: var(--el-text-color-secondary);
}
.cell-note {
  margin-left: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
