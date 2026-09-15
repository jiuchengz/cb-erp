<template>
  <div class="page board-page">
    <div class="page-header">
      <div>
        <h2>商品销量看板</h2>
        <span class="page-sub">
          一货一行 · 含产品图片 / 窗口销量与环比 / 海外仓库存与在途 / 滞销预警（连续超 {{ slowDays }} 天未出单）/ 补货建议
        </span>
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
        <div class="kpi-foot">海外库存 {{ fmt(kpi.overseas_stock) }} · 在途 {{ fmt(kpi.in_transit_qty) }}</div>
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
      <el-input
        v-model="search"
        placeholder="搜索产品编号 / SKU / 名称 / 链接ID"
        clearable
        class="toolbar-search"
      />
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

    <el-table :data="pagedRows" v-loading="loading" stripe class="table-main" :default-sort="{ prop: 'qty_period', order: 'descending' }">
      <el-table-column label="图片" width="72" align="center">
        <template #default="{ row }">
          <el-image
            v-if="row.image_url"
            :src="row.image_url"
            fit="cover"
            class="prod-img"
            :preview-src-list="[row.image_url]"
            preview-teleported
          />
          <span v-else class="img-placeholder">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="code" label="产品编号" min-width="130" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" min-width="190" show-overflow-tooltip />
      <el-table-column prop="link_id" label="链接ID" min-width="130" show-overflow-tooltip />
      <el-table-column prop="overseas_stock" label="海外仓库存" width="110" align="right" sortable />
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
      <el-table-column label="14日走势" width="120" align="center">
        <template #default="{ row }">
          <div class="spark">
            <span
              v-for="(v, i) in row.trend"
              :key="i"
              class="spark-bar"
              :class="{ zero: !v }"
              :style="{ height: barHeight(row, v) }"
              :title="`${trendDates[i]}：${v}`"
            ></span>
          </div>
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

function onWindowChange() {
  page.value = 1
  load()
}

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
  const max = Math.max(1, ...arr.map((x: number) => Number(x) || 0))
  return Math.max(2, Math.round((Number(v || 0) / max) * 26)) + 'px'
}

function exportCsv() {
  const headers = [
    '产品编号',
    'SKU',
    '名称',
    '链接ID',
    '海外仓库存',
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
.spark {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  height: 28px;
}
.spark-bar {
  width: 5px;
  background: var(--el-color-primary);
  border-radius: 2px 2px 0 0;
}
.spark-bar.zero {
  background: var(--el-border-color);
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
</style>
