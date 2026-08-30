<template>
  <div class="page">
    <div class="page-header">
      <h2>成本利润表</h2>
      <div class="header-tools">
        <el-button @click="downloadTpl">下载模板</el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量上传</el-button>
        <el-button :loading="exporting" @click="onExport">批量导出</el-button>
        <el-button type="primary" @click="openSettings">利润设置</el-button>
        <input ref="importFile" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onImportFile" />
      </div>
    </div>

    <div class="filters">
      <el-input
        v-model="query.search"
        placeholder="搜索 SKU / 名称 / 链接ID"
        clearable
        style="width: 260px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-button type="primary" @click="load">查询</el-button>
      <span class="rate-inputs">
        海运
        <el-input-number v-model="settings.sea_rate" :min="0" :max="100000" :step="100" size="small" controls-position="right" style="width: 110px" />
        元/方
        ｜ 空运
        <el-input-number v-model="settings.air_rate" :min="0" :max="100000" :step="1" size="small" controls-position="right" style="width: 110px" />
        元/kg
        <el-button size="small" type="primary" plain :loading="savingRates" @click="saveRates">保存运费单价</el-button>
      </span>
      <span class="settings-hint">汇率 {{ settings.rate }} ｜ 含税 {{ settings.tax_rate }} ｜ 仓储 {{ settings.storage }}% ｜ 货损 {{ settings.loss }}% ｜ 广告 {{ settings.ad }}% ｜ 代扣 {{ settings.tax9 }}% ｜ 补税 {{ settings.tax7 }}% ｜ 默认佣金 {{ settings.comm }}%</span>
    </div>

    <div class="table-wrap">
      <el-table :resizable="false" :data="rows" v-loading="loading" border stripe size="small" style="width: 100%" max-height="calc(100vh - 250px)">
        <el-table-column prop="code" label="产品编码" min-width="130" show-overflow-tooltip />
        <el-table-column prop="name" label="产品名称" min-width="180" show-overflow-tooltip />
        <el-table-column label="图片" width="70">
          <template #default="{ row }">
            <el-image
              v-if="row.image_text"
              :src="row.image_text"
              :preview-src-list="[row.image_text]"
              preview-teleported
              fit="cover"
              style="width: 48px; height: 48px; border-radius: 4px"
            />
            <span v-else class="img-empty">-</span>
          </template>
        </el-table-column>
        <el-table-column label="链接" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link v-if="row.link_id" type="primary" :href="'https://www.mercadolibre.com.mx/' + row.link_id" target="_blank" :underline="false">{{ row.link_id }}</el-link>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="ML佣金比例" width="110" align="right">
          <template #default="{ row }">{{ row.ml_commission_rate != null ? (row.ml_commission_rate * 100).toFixed(2) + '%' : (settings.comm).toFixed(2) + '%' }}</template>
        </el-table-column>
        <el-table-column prop="unit_price" label="售价(比索)" width="105" align="right" sortable />
        <el-table-column label="售价(元)" width="100" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.sale_price_cny) }}</template>
        </el-table-column>
        <el-table-column prop="purchase_cost" label="不含税采购成本(元)" width="140" align="right" />
        <el-table-column label="13%含税采购成本(元)" width="150" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.taxed_cost_cny) }}</template>
        </el-table-column>
        <el-table-column label="含税采购成本(比索)" width="140" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.taxed_cost_peso) }}</template>
        </el-table-column>
        <el-table-column prop="first_leg_freight" label="头程运费(元)" width="120" align="right" />
        <el-table-column label="头程运费(比索)" width="120" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.first_freight_peso) }}</template>
        </el-table-column>
        <el-table-column label="货值(比索)" width="110" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.goods_value_peso) }}</template>
        </el-table-column>
        <el-table-column label="FULL仓储" width="100" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.storage_peso) }}</template>
        </el-table-column>
        <el-table-column label="货损" width="90" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.loss_peso) }}</template>
        </el-table-column>
        <el-table-column label="ML佣金(比索)" width="115" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.commission_peso) }}</template>
        </el-table-column>
        <el-table-column prop="last_mile_delivery_peso" label="尾程派送费" width="115" align="right" />
        <el-table-column prop="add_fee" label="附加费" width="95" align="right" />
        <el-table-column label="广告费" width="95" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.ad_peso) }}</template>
        </el-table-column>
        <el-table-column label="9%代扣税" width="95" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.tax9_peso) }}</template>
        </el-table-column>
        <el-table-column label="7%补税" width="90" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.tax7_peso) }}</template>
        </el-table-column>
        <el-table-column label="总成本" width="100" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.total_cost_peso) }}</template>
        </el-table-column>
        <el-table-column label="总成本占比" width="95" align="right" class-name="calc-col">
          <template #default="{ row }">{{ (row.total_cost_ratio * 100).toFixed(1) + '%' }}</template>
        </el-table-column>
        <el-table-column label="平台利润(比索)" width="120" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.profit_peso) }}</template>
        </el-table-column>
        <el-table-column label="平台利润(元)" width="110" align="right" class-name="calc-col">
          <template #default="{ row }"><span :class="row.profit_cny < 0 ? 'neg' : 'pos'">{{ fmt(row.profit_cny) }}</span></template>
        </el-table-column>
        <el-table-column label="平台利润率" width="100" align="right" class-name="calc-col">
          <template #default="{ row }"><span :class="row.profit_ratio < 0 ? 'neg' : 'pos'">{{ (row.profit_ratio * 100).toFixed(1) + '%' }}</span></template>
        </el-table-column>
        <el-table-column label="销售毛利(元)" width="110" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.gross_profit_cny) }}</template>
        </el-table-column>
        <el-table-column label="销售毛利率" width="100" align="right" class-name="calc-col">
          <template #default="{ row }">{{ (row.gross_profit_ratio * 100).toFixed(1) + '%' }}</template>
        </el-table-column>
        <el-table-column prop="length_cm" label="长cm" width="80" align="right" />
        <el-table-column prop="width_cm" label="宽cm" width="80" align="right" />
        <el-table-column prop="height_cm" label="高cm" width="80" align="right" />
        <el-table-column prop="weight_g" label="重量(克)" width="90" align="right" />
        <el-table-column label="海运费(自动)" width="100" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.sea_freight) }}</template>
        </el-table-column>
        <el-table-column label="空运费(自动)" width="100" align="right" class-name="calc-col">
          <template #default="{ row }">{{ fmt(row.air_freight) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button v-if="canWrite" link type="primary" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <div class="pagination-bar">
        <span class="pagination-total">当前页共 {{ rows.length }} 条</span>
        <el-pagination
          v-model:current-page="query.page"
          :total="total"
          :page-size="query.pageSize"
          layout="total, prev, pager, next"
          @current-change="load"
        />
        <el-select v-model="query.pageSize" class="page-size-select" @change="load">
          <el-option label="100条/页" :value="100" />
          <el-option label="200条/页" :value="200" />
          <el-option label="500条/页" :value="500" />
        </el-select>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editVisible" title="编辑成本利润" width="560px">
      <el-form :model="editForm" label-width="150px" label-position="left">
        <el-form-item label="产品名称"><span>{{ editForm._name }}</span></el-form-item>
        <el-form-item label="ML佣金比例(%)">
          <el-input-number v-model="editForm.ml_commission_rate" :min="0" :max="100" :precision="2" style="width: 180px" />
          <span class="tip">填百分比数值，如 16.5</span>
        </el-form-item>
        <el-form-item label="售价(比索)">
          <el-input-number v-model="editForm.unit_price" :min="0" :precision="2" style="width: 180px" />
        </el-form-item>
        <el-form-item label="不含税采购成本(元)">
          <el-input-number v-model="editForm.purchase_cost" :min="0" :precision="2" style="width: 180px" />
        </el-form-item>
        <el-form-item label="头程运费(元)">
          <el-input-number v-model="editForm.first_leg_freight" :min="0" :precision="2" style="width: 180px" />
        </el-form-item>
        <el-form-item label="尾程派送费(比索)">
          <el-input-number v-model="editForm.last_mile_delivery_peso" :min="0" :precision="2" style="width: 180px" />
        </el-form-item>
        <el-form-item label="附加费(比索)">
          <el-input-number v-model="editForm.add_fee" :min="0" :precision="2" style="width: 180px" />
        </el-form-item>
        <el-form-item label="尺寸(cm) 长×宽×高">
          <el-input-number v-model="editForm.length_cm" :min="0" :precision="1" style="width: 110px" />
          <span class="tip">×</span>
          <el-input-number v-model="editForm.width_cm" :min="0" :precision="1" style="width: 110px" />
          <span class="tip">×</span>
          <el-input-number v-model="editForm.height_cm" :min="0" :precision="1" style="width: 110px" />
        </el-form-item>
        <el-form-item label="重量(克)">
          <el-input-number v-model="editForm.weight_g" :min="0" :precision="0" style="width: 180px" />
          <span class="tip">用于空运费自动计算：重量/1000×空运单价</span>
        </el-form-item>
        <el-form-item label="海运费(自动计算)">
          <span class="tip">长×宽×高/1000000×海运单价（顶部设置，元/方），保存后自动写入</span>
        </el-form-item>
        <el-form-item label="空运费(自动计算)">
          <span class="tip">重量(克)/1000×空运单价（顶部设置，元/kg），保存后自动写入</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRow">保存</el-button>
      </template>
    </el-dialog>

    <!-- 设置弹窗 -->
    <el-dialog v-model="settingsVisible" title="利润计算设置" width="480px">
      <el-form :model="settings" label-width="150px" label-position="left">
        <el-form-item label="汇率 RMB/比索">
          <el-input-number v-model="settings.rate" :min="0.01" :max="10" :precision="4" :step="0.01" style="width: 180px" />
        </el-form-item>
        <el-form-item label="含税系数">
          <el-input-number v-model="settings.tax_rate" :min="1" :max="2" :precision="2" :step="0.01" style="width: 180px" />
          <span class="tip">13% 增值税 = 1.13</span>
        </el-form-item>
        <el-form-item label="FULL仓储费率(%)">
          <el-input-number v-model="settings.storage" :min="0" :max="100" :precision="1" style="width: 180px" />
        </el-form-item>
        <el-form-item label="货损费率(%)">
          <el-input-number v-model="settings.loss" :min="0" :max="100" :precision="1" style="width: 180px" />
        </el-form-item>
        <el-form-item label="广告费率(%)">
          <el-input-number v-model="settings.ad" :min="0" :max="100" :precision="1" style="width: 180px" />
        </el-form-item>
        <el-form-item label="9%代扣税(%)">
          <el-input-number v-model="settings.tax9" :min="0" :max="100" :precision="1" style="width: 180px" />
        </el-form-item>
        <el-form-item label="7%补税(%)">
          <el-input-number v-model="settings.tax7" :min="0" :max="100" :precision="1" style="width: 180px" />
        </el-form-item>
        <el-form-item label="默认ML佣金比例(%)">
          <el-input-number v-model="settings.comm" :min="0" :max="100" :precision="1" style="width: 180px" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingSettings" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'
import { useAuthStore } from '../stores/auth'
import { buildExportPayload, exportViaServer, todayStr } from '../utils/export'
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum } from '../utils/import'
import { addLog } from '../utils/log'

const auth = useAuthStore()
const canWrite = auth.hasPermission('products.write')

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 200, search: '' })

const settings = reactive({
  rate: 0.38,
  tax_rate: 1.13,
  storage: 0.8,
  loss: 5,
  ad: 8,
  tax9: 9,
  tax7: 7,
  comm: 16.5,
  sea_rate: 3000,
  air_rate: 95,
})

const editVisible = ref(false)
const saving = ref(false)
const savingRates = ref(false)
const editForm = reactive<any>({
  id: '',
  _name: '',
  ml_commission_rate: null,
  unit_price: 0,
  purchase_cost: 0,
  first_leg_freight: 0,
  last_mile_delivery_peso: 0,
  add_fee: 0,
  length_cm: 0,
  width_cm: 0,
  height_cm: 0,
  weight_g: 0,
})

const settingsVisible = ref(false)
const savingSettings = ref(false)
const exporting = ref(false)
const importing = ref(false)
const importFile = ref<HTMLInputElement>()

function fmt(v: any): string {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'
}

async function load() {
  loading.value = true
  try {
    const params: any = { page: query.page, pageSize: query.pageSize }
    if (query.search.trim()) params.search = query.search.trim()
    const { data } = await api.get('/cost-profit', { params })
    rows.value = data.data || []
    total.value = data.count || 0
    Object.assign(settings, data.settings || {})
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e?.response?.data?.error?.message || e?.message || e))
  } finally {
    loading.value = false
  }
}

function openEdit(row: any) {
  Object.assign(editForm, {
    id: row.id,
    _name: row.name,
    ml_commission_rate: row.ml_commission_rate != null ? Math.round(row.ml_commission_rate * 10000) / 100 : settings.comm,
    unit_price: Number(row.unit_price || 0),
    purchase_cost: Number(row.purchase_cost || 0),
    first_leg_freight: Number(row.first_leg_freight || 0),
    last_mile_delivery_peso: Number(row.last_mile_delivery_peso || 0),
    add_fee: Number(row.add_fee || 0),
    length_cm: Number(row.length_cm || 0),
    width_cm: Number(row.width_cm || 0),
    height_cm: Number(row.height_cm || 0),
    weight_g: Number(row.weight_g || 0),
  })
  editVisible.value = true
}

async function saveRow() {
  saving.value = true
  try {
    const payload: any = { id: editForm.id }
    if (editForm.ml_commission_rate != null) payload.ml_commission_rate = Number(editForm.ml_commission_rate) / 100
    payload.unit_price = Number(editForm.unit_price || 0)
    payload.purchase_cost = Number(editForm.purchase_cost || 0)
    payload.first_leg_freight = Number(editForm.first_leg_freight || 0)
    payload.last_mile_delivery_peso = Number(editForm.last_mile_delivery_peso || 0)
    payload.add_fee = Number(editForm.add_fee || 0)
    payload.length_cm = Number(editForm.length_cm || 0)
    payload.width_cm = Number(editForm.width_cm || 0)
    payload.height_cm = Number(editForm.height_cm || 0)
    payload.weight_g = Number(editForm.weight_g || 0)
    const { data } = await api.put('/cost-profit/save', payload)
    const saved = data.data
    const idx = rows.value.findIndex((r) => r.id === saved.id)
    if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...saved }
    editVisible.value = false
    addLog('success', '保存成本利润: ' + saved.name, 'cost_profit')
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e?.response?.data?.error?.message || e?.message || e))
  } finally {
    saving.value = false
  }
}

function openSettings() {
  settingsVisible.value = true
}

async function saveSettings() {
  savingSettings.value = true
  try {
    const { data } = await api.put('/cost-profit/settings', { ...settings })
    Object.assign(settings, data.data)
    settingsVisible.value = false
    addLog('success', '更新利润设置', 'cost_profit')
    ElMessage.success('设置已保存')
    load()
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e?.response?.data?.error?.message || e?.message || e))
  } finally {
    savingSettings.value = false
  }
}

async function saveRates() {
  savingRates.value = true
  try {
    const { data } = await api.put('/cost-profit/settings', {
      sea_rate: Number(settings.sea_rate || 0),
      air_rate: Number(settings.air_rate || 0),
    })
    Object.assign(settings, data.data)
    addLog('success', '更新海运/空运单价', 'cost_profit')
    ElMessage.success('运费单价已保存')
    load()
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e?.response?.data?.error?.message || e?.message || e))
  } finally {
    savingRates.value = false
  }
}

/* ---------- 模板 ---------- */
const TPL_COLS: { label: string; sample?: string | number }[] = [
  { label: '产品名称', sample: '示例商品' },
  { label: '链接', sample: 'MLM20260815001' },
  { label: 'ML佣金比例(%)', sample: 16.5 },
  { label: '售价(比索)', sample: 329 },
  { label: '不含税采购成本(元)', sample: 120 },
  { label: '头程运费(元)', sample: 15 },
  { label: '尾程派送费(比索)', sample: 0 },
  { label: '附加费(比索)', sample: 0 },
  { label: '长cm', sample: 20 },
  { label: '宽cm', sample: 15 },
  { label: '高cm', sample: 10 },
  { label: '重量(克)', sample: 500 },
]

function downloadTpl() {
  downloadTemplate(TPL_COLS, '成本利润表', '成本利润表上传模板.xlsx')
}

/* ---------- 批量上传 ---------- */
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
    const { headers, rows: sheetRows } = await readExcelFile(file)
    const col = buildColMap(headers, {
      name: ['产品名称', '名称', 'name'],
      link: ['链接', '链接ID', 'link_id', 'link'],
      comm: ['ML佣金比例', '佣金比例', '佣金', 'ml_commission_rate'],
      unit_price: ['售价', '售价(比索)', '售价比索', 'unit_price', '价格'],
      purchase_cost: ['不含税采购成本', '采购成本', 'purchase_cost'],
      first_leg_freight: ['头程运费', 'first_leg_freight'],
      last_mile: ['尾程派送', '尾程', 'last_mile_delivery_peso'],
      add_fee: ['附加费', 'add_fee'],
      length: ['长', '长cm', 'length_cm'],
      width: ['宽', '宽cm', 'width_cm'],
      height: ['高', '高cm', 'height_cm'],
      weight: ['重量', '实重', '重量(克)', 'weight_g'],
    })
    if (col.name === undefined && col.link === undefined) {
      ElMessage.error('表头无法识别，请使用下载的模板文件，确保包含"产品名称"或"链接"列')
      return
    }
    // 拉取全量商品用于匹配
    const allMap = new Map<string, any>()
    let page = 1
    for (;;) {
      const { data } = await api.get('/cost-profit', { params: { page, pageSize: 200 } })
      const list = data.data || []
      list.forEach((p: any) => {
        if (p.name) allMap.set(String(p.name).trim(), p)
        if (p.link_id) allMap.set(String(p.link_id).trim(), p)
        if (p.sku) allMap.set(String(p.sku).trim(), p)
      })
      if (!data.count || page * 200 >= data.count) break
      page++
    }
    let ok = 0
    let miss = 0
    for (const r of sheetRows) {
      const name = cellStr(r, col.name)
      const link = cellStr(r, col.link)
      const key = (link || name || '').trim()
      const target = key ? allMap.get(key) : undefined
      if (!target) {
        miss++
        continue
      }
      const payload: any = { id: target.id }
      if (col.comm !== undefined && cellStr(r, col.comm)) payload.ml_commission_rate = cellNum(r, col.comm) / 100
      if (col.unit_price !== undefined) payload.unit_price = cellNum(r, col.unit_price)
      if (col.purchase_cost !== undefined) payload.purchase_cost = cellNum(r, col.purchase_cost)
      if (col.first_leg_freight !== undefined) payload.first_leg_freight = cellNum(r, col.first_leg_freight)
      if (col.last_mile !== undefined) payload.last_mile_delivery_peso = cellNum(r, col.last_mile)
      if (col.add_fee !== undefined) payload.add_fee = cellNum(r, col.add_fee)
      if (col.length !== undefined) payload.length_cm = cellNum(r, col.length)
      if (col.width !== undefined) payload.width_cm = cellNum(r, col.width)
      if (col.height !== undefined) payload.height_cm = cellNum(r, col.height)
      if (col.weight !== undefined) payload.weight_g = cellNum(r, col.weight)
      await api.put('/cost-profit/save', payload)
      ok++
    }
    ElMessage.success(`上传完成：成功 ${ok} 条${miss ? '，未匹配跳过 ' + miss + ' 条' : ''}`)
    addLog('success', '批量上传成本利润', `成功${ok} 未匹配${miss}`)
    load()
  } catch (e: any) {
    ElMessage.error('上传失败: ' + (e?.response?.data?.error?.message || e?.message || e))
  } finally {
    importing.value = false
  }
}

/* ---------- 批量导出 ---------- */
async function onExport() {
  exporting.value = true
  try {
    const list: any[] = []
    let page = 1
    for (;;) {
      const params: any = { page, pageSize: 200 }
      if (query.search.trim()) params.search = query.search.trim()
      const { data } = await api.get('/cost-profit', { params })
      list.push(...(data.data || []))
      if (!data.count || page * 200 >= data.count) break
      page++
    }
    const columns = [
      { key: 'name', label: '产品名称' },
      { key: 'image_text', label: '图片' },
      { key: 'link_id', label: '链接' },
      { key: 'ml_commission_rate', label: 'ML佣金比例', value: (r: any) => (r.ml_commission_rate != null ? (r.ml_commission_rate * 100).toFixed(2) + '%' : settings.comm.toFixed(2) + '%') },
      { key: 'unit_price', label: '售价(比索)' },
      { key: 'sale_price_cny', label: '售价(元)' },
      { key: 'purchase_cost', label: '不含税采购成本(元)' },
      { key: 'taxed_cost_cny', label: '13%含税采购成本(元)' },
      { key: 'taxed_cost_peso', label: '含税采购成本(比索)' },
      { key: 'first_leg_freight', label: '头程运费(元)' },
      { key: 'first_freight_peso', label: '头程运费(比索)' },
      { key: 'goods_value_peso', label: '货值(比索)' },
      { key: 'storage_peso', label: 'FULL仓储' },
      { key: 'loss_peso', label: '货损' },
      { key: 'commission_peso', label: 'ML佣金(比索)' },
      { key: 'last_mile_delivery_peso', label: '尾程派送费' },
      { key: 'add_fee', label: '附加费' },
      { key: 'ad_peso', label: '广告费' },
      { key: 'tax9_peso', label: '9%代扣税' },
      { key: 'tax7_peso', label: '7%补税' },
      { key: 'total_cost_peso', label: '总成本' },
      { key: 'total_cost_ratio', label: '总成本占比', value: (r: any) => (r.total_cost_ratio * 100).toFixed(1) + '%' },
      { key: 'profit_peso', label: '平台利润(比索)' },
      { key: 'profit_cny', label: '平台利润(元)' },
      { key: 'profit_ratio', label: '平台利润率', value: (r: any) => (r.profit_ratio * 100).toFixed(1) + '%' },
      { key: 'gross_profit_cny', label: '销售毛利(元)' },
      { key: 'gross_profit_ratio', label: '销售毛利率', value: (r: any) => (r.gross_profit_ratio * 100).toFixed(1) + '%' },
      { key: 'length_cm', label: '长cm' },
      { key: 'width_cm', label: '宽cm' },
      { key: 'height_cm', label: '高cm' },
      { key: 'weight_g', label: '重量(克)' },
      { key: 'sea_freight', label: '海运费(自动)' },
      { key: 'air_freight', label: '空运费(自动)' },
    ]
    const payload = buildExportPayload({ rows: list, columns, withImages: false })
    await exportViaServer('成本利润表_' + todayStr() + '.xlsx', payload, false, '成本利润表')
  } catch (e: any) {
    ElMessage.error('导出失败: ' + (e?.response?.data?.error?.message || e?.message || e))
  } finally {
    exporting.value = false
  }
}

onMounted(load)
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
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.header-tools {
  display: flex;
  gap: 8px;
}
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.settings-hint {
  color: #909399;
  font-size: 12px;
}
.rate-inputs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #606266;
  font-size: 13px;
  white-space: nowrap;
}
.table-wrap {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}
.calc-col {
  background: #f7f8fa;
}
.pos {
  color: #67c23a;
  font-weight: 600;
}
.neg {
  color: #f56c6c;
  font-weight: 600;
}
.img-empty {
  color: #c0c4cc;
}
.tip {
  color: #909399;
  font-size: 12px;
  margin-left: 6px;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
