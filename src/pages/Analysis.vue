<template>
  <div class="ana-page">
    <div class="page-header">
      <div>
        <h1>经营分析</h1>
        <div class="page-tip">基于业务数据的多维度分析看板</div>
      </div>
      <div class="header-actions">
        <el-button type="primary" :loading="exporting" @click="exportReport">
          <el-icon style="margin-right:4px"><Document /></el-icon>导出经营周报
        </el-button>
        <el-button :loading="loading" @click="load()">刷新</el-button>
      </div>
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

    <!-- 指标卡 -->
    <div class="kpi-row">
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
        <div class="value">{{ fmtKpi(inTransitCount) }} <small>批</small></div>
        <div class="trend flat">国内 → 海外仓</div>
      </div>
      <div class="kpi">
        <div class="label">安全库存达标率<span class="ico">✅</span></div>
        <div class="value">{{ d.safety_rate.rate != null ? d.safety_rate.rate + '%' : '--' }} <small>{{ d.safety_rate.pass }}/{{ d.safety_rate.total }}</small></div>
        <div class="trend flat">达标商品 / 已设安全库存</div>
      </div>
    </div>

    <!-- 智能洞察 -->
    <div class="insight-box" v-if="insights.length">
      <div class="t">💡 智能洞察</div>
      <div v-for="(it, i) in insights" :key="i" class="insight-item" v-html="it"></div>
    </div>

    <!-- 趋势 -->
    <div class="card">
      <h2>销售额 / 销量 / 售后趋势 <span class="more">每日 {{ periodText }}</span></h2>
      <div class="trend-wrap">
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" v-if="d.trend && d.trend.length">
          <line v-for="(yv, xi) in yLines" :key="'y' + xi" :x1="0" :y1="yv" :x2="W" :y2="yv" stroke="#ebeef5" stroke-width="1" />
          <polyline :points="linePoints('amount')" fill="none" stroke="#409eff" stroke-width="2" />
          <polyline :points="linePoints('sale')" fill="none" stroke="#67c23a" stroke-width="2" />
          <polyline :points="linePoints('after')" fill="none" stroke="#e6a23c" stroke-width="2" />
        </svg>
      </div>
      <div class="legend">
        <span><i style="background:#409eff"></i>销售额(MXN)</span>
        <span><i style="background:#67c23a"></i>销售数量</span>
        <span><i style="background:#e6a23c"></i>售后工单</span>
      </div>
    </div>

    <!-- 平台分布 + 资金周转 -->
    <div class="grid-2">
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
      <div class="card">
        <h2>资金周转概览 <span class="more">本期</span></h2>
        <div class="capital-row">
          <div class="capital-item">
            <div class="cap-label">销售额</div>
            <div class="cap-val" style="color:#409eff">{{ fmtKpi(d.capital.sale_amount) }}</div>
            <div class="cap-unit">MXN</div>
          </div>
          <div class="capital-item">
            <div class="cap-label">退款金额</div>
            <div class="cap-val" style="color:#e6a23c">{{ fmtKpi(d.capital.refund_amount) }}</div>
            <div class="cap-unit">MXN</div>
          </div>
          <div class="capital-item">
            <div class="cap-label">净销售额</div>
            <div class="cap-val" style="color:#67c23a">{{ fmtKpi(d.capital.net_amount) }}</div>
            <div class="cap-unit">MXN</div>
          </div>
          <div class="capital-item">
            <div class="cap-label">国内库存货值</div>
            <div class="cap-val" style="color:#606266">{{ fmtKpi(d.capital.stock_value) }}</div>
            <div class="cap-unit">MXN</div>
          </div>
        </div>
        <div class="cap-note">库存货值 = 国内仓库存 × 产品采购成本（估算）</div>
      </div>
    </div>

    <!-- 热销 + 潜力新品 -->
    <div class="grid-2">
      <div class="card">
        <h2>热销商品 TOP5 <span class="more">按净销量</span></h2>
        <ul class="rank-list">
          <li v-for="(h, i) in d.hot_top" :key="h.link_id" class="rank-item">
            <span class="rank-no" :class="{ top: i === 0 }">{{ i + 1 }}</span>
            <div class="rank-img"><img v-if="isImageUrl(h.image)" :src="h.image" referrerpolicy="no-referrer" @error="onImgError(h)" class="rank-thumb" /><span v-else>🏆</span></div>
            <div class="rank-info">
              <div class="rank-name">{{ h.name }}</div>
              <div class="rank-meta">链接 {{ h.link_id }}</div>
            </div>
            <div class="rank-val"><div class="v">{{ h.qty }}</div><div class="p flat">件</div></div>
          </li>
          <li v-if="!d.hot_top || !d.hot_top.length" class="empty-li">本期暂无销售数据</li>
        </ul>
      </div>
      <div class="card">
        <h2>潜力新品榜 <span class="more">销量上升最快</span></h2>
        <ul class="rank-list">
          <li v-for="(h, i) in d.new_rise" :key="h.link_id" class="rank-item">
            <span class="rank-no" :class="{ top: i === 0 }">{{ i + 1 }}</span>
            <div class="rank-img"><img v-if="isImageUrl(h.image)" :src="h.image" referrerpolicy="no-referrer" @error="onImgError(h)" class="rank-thumb" /><span v-else>🚀</span></div>
            <div class="rank-info">
              <div class="rank-name">{{ h.name }}</div>
              <div class="rank-meta">本期销量 {{ h.qty }} 件</div>
            </div>
            <div class="rank-val"><div class="v up">↑{{ h.rise }}%</div><div class="p flat">销量增速</div></div>
          </li>
          <li v-if="!d.new_rise || !d.new_rise.length" class="empty-li">本期暂无上升趋势商品</li>
        </ul>
      </div>
    </div>

    <!-- 补货 + 发货建议 -->
    <div class="grid-2">
      <div class="card">
        <h2>补货建议 <span class="more">按销量预测 · 建议补至 2 倍安全库存</span></h2>
        <ul class="rank-list">
          <li v-for="(r, i) in d.replenish" :key="r.product_id" class="rank-item">
            <span class="rank-no" :class="{ top: i === 0 }">{{ i + 1 }}</span>
            <div class="rank-img"><img v-if="isImageUrl(r.image)" :src="r.image" referrerpolicy="no-referrer" @error="onImgError(r)" class="rank-thumb" /><span v-else>📦</span></div>
            <div class="rank-info">
              <div class="rank-name">{{ r.name }}</div>
              <div class="rank-meta">
                库存 {{ r.stock }} / 安全 {{ r.safety_stock }} · 日均销 {{ r.daily }}
                <span v-if="r.daysLeft != null">· 约 {{ r.daysLeft }} 天售罄</span>
                <span v-else>· 滞销风险</span>
              </div>
            </div>
            <div class="rank-val"><div class="v up">+{{ r.suggest }}</div><div class="p flat">建议补货</div></div>
          </li>
          <li v-if="!d.replenish || !d.replenish.length" class="empty-li">暂无补货需求，库存均在安全水位</li>
        </ul>
      </div>
      <div class="card">
        <h2>发货建议</h2>
        <div class="advice-block">
          <div class="advice-title">🚢 在途货件分布（{{ inTransitCount }} 批）</div>
          <div class="advice-chips">
            <span v-for="s in d.ship_advice.by_status" :key="s.name" class="chip" :class="chipCls(s.name)">
              {{ s.name }} × {{ s.value }}
            </span>
            <span v-if="!d.ship_advice.by_status.length" class="empty-li">当前无在途货件</span>
          </div>
          <div class="advice-title" style="margin-top:14px">🚛 货代在途单量</div>
          <div class="advice-chips">
            <span v-for="f in d.ship_advice.by_forwarder" :key="f.name" class="chip">{{ f.name }} × {{ f.value }}</span>
            <span v-if="!d.ship_advice.by_forwarder.length" class="empty-li">暂无数据</span>
          </div>
          <div class="advice-tip" v-if="urgentStatusCount > 0">建议优先跟进「到港 / 清关」货件，尽快完成入仓上架。</div>
        </div>
      </div>
    </div>

    <!-- 国内库存分析 -->
    <div class="card">
      <h2>国内库存分析 <span class="more">哪些产品发货多 · 哪些在库时间长</span></h2>
      <div class="grid-2">
        <div>
          <div class="sub-title">🚀 发货量 TOP3（本期）</div>
          <ul class="rank-list">
            <li v-for="(h, i) in d.domestic.ship_top" :key="h.product_id" class="rank-item">
              <span class="rank-no" :class="{ top: i === 0 }">{{ i + 1 }}</span>
              <div class="rank-img"><img v-if="isImageUrl(h.image)" :src="h.image" referrerpolicy="no-referrer" @error="onImgError(h)" class="rank-thumb" /><span v-else>📤</span></div>
              <div class="rank-info">
                <div class="rank-name">{{ h.name || h.product_id }}</div>
                <div class="rank-meta">占发货总量 {{ shipPct(h.qty) }}%</div>
              </div>
              <div class="rank-val"><div class="v">{{ h.qty }}</div><div class="p flat">件</div></div>
            </li>
            <li v-if="!d.domestic.ship_top.length" class="empty-li">本期暂无发货记录</li>
          </ul>
        </div>
        <div>
          <div class="sub-title">⏱ 在库时长 TOP3（积压风险）</div>
          <ul class="rank-list">
            <li v-for="(h, i) in d.domestic.age_top" :key="h.product_id" class="rank-item">
              <span class="rank-no" :class="{ top: i === 0 }">{{ i + 1 }}</span>
              <div class="rank-img"><img v-if="isImageUrl(h.image)" :src="h.image" referrerpolicy="no-referrer" @error="onImgError(h)" class="rank-thumb" /><span v-else>⏳</span></div>
              <div class="rank-info">
                <div class="rank-name">{{ h.name || h.product_id }}</div>
                <div class="rank-meta">库存 {{ h.stock }} 件 · 超 {{ h.days }} 天未出库</div>
              </div>
              <div class="rank-val"><div class="v up">{{ h.days }}天</div><div class="p flat">在库</div></div>
            </li>
            <li v-if="!d.domestic.age_top.length" class="empty-li">暂无国内库存记录</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 库存预警 + 售后原因 -->
    <div class="grid-2">
      <div class="card">
        <h2>库存预警 <span class="more" v-if="d.safety_rate.rate != null">安全库存达标率 {{ d.safety_rate.rate }}%（{{ d.safety_rate.pass }}/{{ d.safety_rate.total }} 项达标）</span></h2>
        <div v-for="w in d.warn.low_stock" :key="w.product_id" class="warn-item">
          <span class="warn-tag red">低库存</span>
          <div class="warn-info">{{ w.name }}<div class="sub">库存 {{ w.stock }} 件 / 安全 {{ w.safety_stock }} 件 · 缺口 {{ w.gap }} 件</div></div>
        </div>
        <div v-for="t in d.warn.in_transit" :key="t.shipment_no + t.product_code" class="warn-item">
          <span class="warn-tag orange">在途</span>
          <div class="warn-info">{{ t.shipment_no }}<div class="sub">{{ t.product_code || '' }} {{ t.forwarder ? '· ' + t.forwarder : '' }} · {{ t.shipping_qty }} 件 · {{ t.cargo_status }}</div></div>
        </div>
        <div v-if="!d.warn.low_stock.length && !d.warn.in_transit.length" class="empty-li">库存状态良好，无预警项</div>
      </div>
      <div class="card">
        <h2>售后原因分布 <span class="more">本期 {{ d.summary.after_count }} 单</span></h2>
        <div v-for="r in d.after_reason" :key="r.name" class="reason-item">
          <div class="reason-row">
            <span class="reason-name">{{ r.name }}</span>
            <span class="reason-val">{{ r.value }} 单 · {{ reasonPct(r.value) }}%</span>
          </div>
          <div class="reason-bar">
            <div class="reason-fill" :style="{ width: reasonPct(r.value) + '%' }"></div>
          </div>
        </div>
        <div v-if="!d.after_reason.length" class="empty-li">本期暂无售后记录</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import { api } from '@/services/api'
import { addLog } from '@/utils/log'

const W = 720
const H = 150

const quickDays = [
  { days: 0, label: '今天' },
  { days: 7, label: '近7天' },
  { days: 30, label: '近30天' },
  { days: 60, label: '近60天' }
]

const loading = ref(false)
const exporting = ref(false)
const activeDays = ref(30)
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
  hot_top: [] as any[],
  new_rise: [] as any[],
  trend: [] as any[],
  warn: { low_stock: [] as any[], in_transit: [] as any[] },
  safety_rate: { total: 0, pass: 0, rate: null as number | null },
  replenish: [] as any[],
  ship_advice: { by_status: [] as any[], by_forwarder: [] as any[] },
  domestic: { ship_top: [] as any[], age_top: [] as any[], total_stock: 0 },
  after_reason: [] as any[],
  capital: { sale_amount: 0, refund_amount: 0, net_amount: 0, stock_value: 0 }
})

async function load() {
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
    Object.assign(d, data)
    // 兼容字段缺失
    d.summary = Object.assign({ sale_qty: 0, refund_qty: 0, refund_amount: 0, sale_amount: 0, ship_qty: 0, after_count: 0, link_count: 0, prev_sale_qty: 0, prev_sale_amount: 0, prev_ship_qty: 0, prev_after_count: 0 }, data.summary || {})
    d.warn = Object.assign({ low_stock: [], in_transit: [] }, data.warn || {})
    d.safety_rate = Object.assign({ total: 0, pass: 0, rate: null }, data.safety_rate || {})
    d.ship_advice = Object.assign({ by_status: [], by_forwarder: [] }, data.ship_advice || {})
    d.domestic = Object.assign({ ship_top: [], age_top: [], total_stock: 0 }, data.domestic || {})
    d.capital = Object.assign({ sale_amount: 0, refund_amount: 0, net_amount: 0, stock_value: 0 }, data.capital || {})
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '经营分析数据加载失败')
  } finally {
    loading.value = false
  }
}

function setQuick(days: number) {
  activeDays.value = days
  customRange.value = false
  range.value = null
  load()
}
function applyCustom() {
  if (!range.value || !range.value[0] || !range.value[1]) {
    ElMessage.warning('请选择开始和结束日期')
    return
  }
  customRange.value = true
  load()
}

/* ---------- 产品图片 ---------- */
function isImageUrl(v: unknown): boolean {
  if (typeof v !== 'string' || !v) return false
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:image/')
}
function onImgError(item: any) {
  item.image = ''
}

const periodText = computed(() => {
  if (!d.period.start) return ''
  if (d.period.start === d.period.end) return d.period.start
  return `${d.period.start} ~ ${d.period.end}（${d.period.days} 天）`
})

const inTransitCount = computed(() => d.warn.in_transit.length)
const urgentStatusCount = computed(() => {
  let n = 0
  for (const s of d.ship_advice.by_status) {
    if (s.name === '到港' || s.name === '清关') n += s.value
  }
  return n
})

/* ---------- 指标格式化 / 环比 ---------- */
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

/* ---------- 智能洞察 ---------- */
const insights = computed(() => {
  const list: string[] = []
  const s = d.summary
  const rate = d.safety_rate.rate
  if (s.sale_amount > 0) {
    const pct = pctOf(s.sale_amount, s.prev_sale_amount)
    if (pct != null && Math.abs(pct) >= 3) {
      list.push(`本期销售额 <b>${s.sale_amount.toLocaleString()} MXN</b>，环比 <span class="arrow ${pct >= 0 ? '' : 'down'}">${pct >= 0 ? '↑' : '↓'}${Math.abs(pct).toFixed(1)}%</span>。`)
    }
  }
  if (s.after_count > 0 && s.sale_qty > 0) {
    list.push(`售后率 <b>${((s.after_count / s.sale_qty) * 100).toFixed(1)}%</b>，售后原因集中在「${d.after_reason[0]?.name || '未知'}」（${d.after_reason[0]?.value || 0} 单），建议重点排查。`)
  }
  if (rate != null && rate < 80) {
    list.push(`安全库存达标率仅 <b>${rate}%</b>，${d.safety_rate.total - d.safety_rate.pass} 项低于安全库存，建议尽快安排补货。`)
  }
  if (d.domestic.age_top.length) {
    list.push(`国内库存存在积压风险：<b>${d.domestic.age_top[0].name}</b> 已在库 ${d.domestic.age_top[0].days} 天未出库，可考虑促销或调整采购计划。`)
  }
  if (d.replenish.length) {
    const urgent = d.replenish[0]
    list.push(`补货优先级最高：<b>${urgent.name}</b>（库存 ${urgent.stock} 件，日均销 ${urgent.daily} 件${urgent.daysLeft != null ? '，约 ' + urgent.daysLeft + ' 天售罄' : ''}），建议补货 <b>+${urgent.suggest}</b> 件。`)
  }
  if (!list.length) list.push('当前周期数据量较少，暂无明显异常；可切换更长周期查看趋势。')
  return list
})

/* ---------- 趋势图 ---------- */
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

/* ---------- 平台分布环形图 ---------- */
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
  return (d.platforms || []).map((p, i) => {
    const frac = p.value / total
    const dash = `${frac * C} ${C - frac * C}`
    const offset = -acc * C
    acc += frac
    return { name: p.name, color: platformColor(p.name), dash, offset }
  })
})
const donutTopName = computed(() => (d.platforms || [])[0]?.name || '')
const donutTopPct = computed(() => (d.platforms || []).length ? platformPct((d.platforms || [])[0].value) : '0')

/* ---------- 发货占比 ---------- */
function shipPct(qty: number): string {
  const total = d.summary.ship_qty || 0
  if (!total) return '0'
  return ((qty / total) * 100).toFixed(0)
}

/* ---------- 售后占比 ---------- */
function reasonPct(v: number): string {
  const total = d.summary.after_count || 0
  if (!total) return '0'
  return ((v / total) * 100).toFixed(0)
}

/* ---------- 状态色 ---------- */
function chipCls(name: string): string {
  if (name === '到港' || name === '清关') return 'chip-warn'
  if (name === '已预约') return 'chip-info'
  return ''
}

/* ---------- 一键导出经营周报 ---------- */
async function exportReport() {
  if (!d.period.start) {
    ElMessage.warning('请先加载数据')
    return
  }
  exporting.value = true
  try {
    const period = d.period.start === d.period.end ? d.period.start : `${d.period.start} ~ ${d.period.end}`
    const s = d.summary
    const lines = [
      'cb-erp 经营周报（' + period + '）',
      '生成时间：' + new Date().toLocaleString('zh-CN', { hour12: false }),
      '',
      '一、核心指标',
      '· 销售额：' + s.sale_amount.toLocaleString() + ' MXN（环比 ' + trendText(s.sale_amount, s.prev_sale_amount) + '）',
      '· 销售数量：' + s.sale_qty.toLocaleString() + ' 件（环比 ' + trendText(s.sale_qty, s.prev_sale_qty) + '）',
      '· 发货量：' + s.ship_qty.toLocaleString() + ' 单',
      '· 售后工单：' + s.after_count + ' 单（售后率 ' + (s.sale_qty ? ((s.after_count / s.sale_qty) * 100).toFixed(1) + '%' : '--') + '）',
      '· 退款金额：' + s.refund_amount.toLocaleString() + ' MXN',
      '· 出单链接数：' + s.link_count + ' 个',
      '· 安全库存达标率：' + (d.safety_rate.rate != null ? d.safety_rate.rate + '%（' + d.safety_rate.pass + '/' + d.safety_rate.total + '）' : '--'),
      '',
      '二、热销 TOP3',
      ...(d.hot_top.slice(0, 3).map((h, i) => (i + 1) + '. ' + h.name + '：' + h.qty.toLocaleString() + ' 件')),
      '',
      '三、潜力新品 TOP3',
      ...(d.new_rise.slice(0, 3).map((h, i) => (i + 1) + '. ' + h.name + '：本期 ' + h.qty.toLocaleString() + ' 件，增速 +' + h.rise + '%')),
      '',
      '四、平台分布',
      ...((d.platforms || []).map((p) => '· ' + p.name + ' ' + p.value.toLocaleString() + ' 件（' + platformPct(p.value) + '%）')),
      '',
      '五、补货建议',
      ...(d.replenish.map((r) => '· ' + r.name + '：建议补货 +' + r.suggest + '（库存 ' + r.stock + '，日均销 ' + r.daily + (r.daysLeft != null ? '，约 ' + r.daysLeft + ' 天售罄' : '') + '）')),
      '',
      '六、库存预警',
      '· 低库存 ' + d.warn.low_stock.length + ' 项：' + (d.warn.low_stock.map((w) => w.name + '(缺' + w.gap + ')').join('、') || '无'),
      '· 在途货件 ' + inTransitCount.value + ' 批：' + (d.warn.in_transit.map((t) => t.shipment_no).join('、') || '无'),
      '· 在库积压 ' + d.domestic.age_top.length + ' 项：' + (d.domestic.age_top.map((a) => a.name + '(' + a.days + '天)').join('、') || '无'),
      '',
      '七、智能建议',
      ...insights.value.map((x) => '· ' + x.replace(/<[^>]+>/g, '')),
      '',
      '本报告由 cb-erp 经营分析自动生成。'
    ]
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '经营周报_' + period.replace(/\s/g, '') + '.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
    addLog('success', '导出经营周报', period)
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.ana-page { min-width: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.page-header h1 { font-size: 20px; margin: 0; color: var(--ink); }
.page-tip { font-size: 13px; color: var(--ink-3); }
.header-actions { display: flex; gap: 8px; }

.filters { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.quick-group { display: flex; gap: 6px; }
.quick { background: var(--glass-bg, #fff); border: 1px solid var(--border, #dcdfe6); border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; color: var(--ink-2); }
.quick.active { background: var(--accent, #409eff); color: #fff; border-color: var(--accent, #409eff); }
.range-box { display: inline-flex; align-items: center; }

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
.sub-title { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }

.insight-box { background: linear-gradient(135deg, var(--insight-c1, rgba(236,245,255,.9)), var(--insight-c2, rgba(240,249,235,.9))); border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; }
html.dark .insight-box { --insight-c1: rgba(36,46,66,.5); --insight-c2: rgba(36,50,46,.5); }
.insight-box .t { font-size: 13px; font-weight: 600; color: var(--accent, #409eff); margin-bottom: 8px; }
.insight-item { font-size: 13px; color: var(--ink-2); line-height: 2.1; }
.insight-item b { color: var(--ink); }
.insight-item .arrow { color: #f56c6c; font-weight: 600; }
.insight-item .arrow.down { color: #67c23a; }

.trend-wrap { height: 160px; position: relative; }
.trend-wrap svg { width: 100%; height: 100%; display: block; }
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--ink-2); margin-top: 8px; flex-wrap: wrap; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }

.rank-list { list-style: none; margin: 0; padding: 0; }
.rank-item { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px dashed var(--border, #ebeef5); }
.rank-item:last-child { border-bottom: none; }
.rank-no { width: 22px; height: 22px; border-radius: 6px; background: var(--bg-muted, #f4f4f5); color: var(--ink-3); font-size: 12px; font-weight: 700; text-align: center; line-height: 22px; flex-shrink: 0; }
.rank-no.top { background: #f56c6c; color: #fff; }
.rank-img { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 20px; background: var(--bg-muted, #f0f9eb); flex-shrink: 0; overflow: hidden; }
.rank-img .rank-thumb { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 8px; }
.rank-info { flex: 1; min-width: 0; }
.rank-name { font-size: 13px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank-meta { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.rank-val { text-align: right; flex-shrink: 0; }
.rank-val .v { font-size: 15px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.rank-val .p { font-size: 12px; }
.empty-li { font-size: 13px; color: var(--ink-3); padding: 12px 0; text-align: center; }

.donut-wrap { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.donut-legend { flex: 1; min-width: 150px; }
.dl-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 7px 0; }
.dl-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.dl-name { flex: 1; color: var(--ink-2); }
.dl-val { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink); }
.dl-pct { color: var(--ink-3); width: 46px; text-align: right; }

.capital-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.capital-item { background: var(--bg-muted, #fafafa); border-radius: 8px; padding: 14px 16px; }
.cap-label { font-size: 12px; color: var(--ink-3); margin-bottom: 6px; }
.cap-val { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cap-unit { font-size: 11px; color: var(--ink-3); margin-top: 2px; }
.cap-note { font-size: 12px; color: var(--ink-3); margin-top: 10px; }

.advice-title { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 8px; }
.advice-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; background: var(--bg-muted, #f0f2f5); color: var(--ink-2); }
.chip-warn { background: #fdf6ec; color: #e6a23c; }
html.dark .chip-warn { background: rgba(230,162,60,.14); }
.chip-info { background: #ecf5ff; color: #409eff; }
html.dark .chip-info { background: rgba(64,158,255,.14); }
.advice-tip { margin-top: 12px; font-size: 12px; color: #e6a23c; background: #fdf6ec; border-radius: 8px; padding: 8px 12px; }
html.dark .advice-tip { background: rgba(230,162,60,.12); }

.warn-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--border, #ebeef5); }
.warn-item:last-child { border-bottom: none; }
.warn-tag { flex-shrink: 0; font-size: 12px; border-radius: 6px; padding: 2px 8px; }
.warn-tag.red { background: #fef0f0; color: #f56c6c; }
html.dark .warn-tag.red { background: rgba(245,108,108,.14); }
.warn-tag.orange { background: #fdf6ec; color: #e6a23c; }
html.dark .warn-tag.orange { background: rgba(230,162,60,.14); }
.warn-info { flex: 1; font-size: 13px; color: var(--ink); }
.warn-info .sub { font-size: 12px; color: var(--ink-3); }

.reason-item { padding: 6px 0; }
.reason-row { display: flex; justify-content: space-between; font-size: 13px; color: var(--ink); margin-bottom: 4px; }
.reason-name { color: var(--ink-2); }
.reason-val { color: var(--ink-3); font-size: 12px; }
.reason-bar { height: 8px; border-radius: 4px; background: var(--bg-muted, #f0f2f5); overflow: hidden; }
.reason-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #f56c6c, #e6a23c); }

@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .kpi-row { grid-template-columns: 1fr 1fr; gap: 10px; }
  .kpi .value { font-size: 18px; }
  .capital-row { grid-template-columns: 1fr 1fr; }
}
</style>
