<template>
  <div class="page">
    <div class="page-header">
      <h2>商品管理</h2>
      <div>
        <el-button v-if="canWrite" @click="downloadTpl">下载模板</el-button>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canDelete" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量导入</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增商品</el-button>
        <input ref="importFile" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onImportFile" />
      </div>
    </div>

    <div class="filters">
      <el-input
        v-model="query.search"
        placeholder="搜索 SKU / 名称 / 产品编号 / 链接ID / 条形码"
        clearable
        style="width: 260px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 140px" @change="load">
        <el-option label="启用" value="active" />
        <el-option label="停用" value="inactive" />
      </el-select>
      <el-date-picker
        v-model="salesRange"
        type="daterange"
        range-separator="至"
        start-placeholder="自定义销量起"
        end-placeholder="自定义销量止"
        value-format="YYYY-MM-DD"
        style="width: 280px"
        @change="onSalesRangeChange"
      />
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="profit-bar">
      <span class="profit-label">汇率（RMB/比索）</span>
      <el-input-number v-model="rate" :min="0.01" :max="10" :precision="4" :step="0.01" size="small" />
      <span class="profit-tip">修改汇率后利润列实时重算（只读联动）</span>
    </div>

    <div class="table-wrap">
    <el-table v-loading="loading" :data="rows" border stripe height="100%" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column prop="listing_time" label="上新时间" width="110" />
      <el-table-column prop="code" label="产品编号" min-width="140" show-overflow-tooltip />
      <el-table-column label="图片" width="90">
        <template #default="{ row }">
          <el-tooltip v-if="isImageUrl(row.image_text)" :show-after="200" :offset="10">
            <template #content>
              <img :src="row.image_text" class="img-preview" referrerpolicy="no-referrer" @error="onImgError($event)" />
            </template>
            <img :src="row.image_text" class="product-thumb" referrerpolicy="no-referrer" @error="onImgError($event)" @click="onPreviewImage(row.image_text)" />
          </el-tooltip>
          <div v-else-if="row.image_text" class="img-text-cell" :title="row.image_text">{{ row.image_text }}</div>
          <div v-else class="img-fallback">无图片</div>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
      <el-table-column label="SKU" min-width="140">
        <template #default="{ row }">{{ row.sku || '—' }}</template>
      </el-table-column>
      <el-table-column prop="barcode" label="条形码" min-width="140" />
      <el-table-column prop="category" label="分类" min-width="120" />
      <el-table-column prop="domestic_stock" label="国内库存" width="100" align="right" />
      <el-table-column prop="overseas_stock" label="国外库存" width="100" align="right" />
      <el-table-column prop="in_transit_qty" label="在途数量" width="100" align="right" />
      <el-table-column prop="sales_qty" label="总销量" width="90" align="right" />
      <el-table-column prop="sales_today" label="日销量" width="80" align="right" />
      <el-table-column prop="sales_7d" label="7天销量" width="85" align="right" />
      <el-table-column prop="sales_15d" label="15天销量" width="90" align="right" />
      <el-table-column prop="sales_month" label="月销量" width="80" align="right" />
      <el-table-column label="自定义销量" width="100" align="right">
        <template #default="{ row }">
          <span>{{ salesRange && salesRange.length === 2 ? (row.sales_custom ?? 0) : '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="unit" label="单位" width="80" />
      <el-table-column prop="unit_price" label="售价比索" width="110" align="right" />
      <el-table-column label="售价元" width="100" align="right">
        <template #default="{ row }">{{ money(Number(row.unit_price ?? 0) * rate) }}</template>
      </el-table-column>
      <el-table-column prop="purchase_cost" label="不含税采购成本" width="130" align="right" />
      <el-table-column prop="first_leg_freight" label="头程运费" width="100" align="right" />
      <el-table-column prop="last_mile_delivery_peso" label="尾程派送(比索)" width="130" align="right" />
      <el-table-column label="ML佣金比例" width="110" align="right">
        <template #default="{ row }">{{ pct(row.ml_commission_rate) }}</template>
      </el-table-column>
      <el-table-column label="平台利润(元)" width="120" align="right">
        <template #default="{ row }">
          <span :class="profit(row) >= 0 ? 'profit-pos' : 'profit-neg'">{{ money(profit(row)) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="shipping_mode" label="空海运" width="100" />
      <el-table-column prop="competitor_id" label="竞品ID" min-width="120" show-overflow-tooltip />
      <el-table-column prop="link_id" label="链接ID" min-width="120" show-overflow-tooltip />
      <el-table-column prop="currency" label="币种" width="90" />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">
            {{ row.status === 'active' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="180">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canWrite" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="canDelete" link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

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

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑商品' : '新增商品'" width="720px" destroy-on-close>
      <el-form :model="form" label-width="110px">
        <el-form-item label="SKU">
          <el-input v-model="form.sku" placeholder="选填，可后续补充" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="必填" />
        </el-form-item>
        <el-form-item label="图片">
          <el-input v-model="form.image_text" placeholder="粘贴图片URL或点击本地上传" />
          <el-button size="small" style="margin-top: 6px" @click="imageInput?.click()">本地上传</el-button>
          <input ref="imageInput" type="file" accept="image/*" style="display: none" @change="onImageFileChange" />
          <div v-if="isImageUrl(form.image_text)" style="margin-top: 6px; text-align: center">
            <img
              :src="form.image_text"
              style="max-width: 100%; max-height: 100px; border-radius: 4px; border: 1px solid var(--color-border)"
              referrerpolicy="no-referrer"
              @error="onImgError($event)"
            />
          </div>
        </el-form-item>
        <el-form-item label="产品编号">
          <el-input v-model="form.code" placeholder="老系统 listing code" />
        </el-form-item>
        <el-form-item label="条形码">
          <el-input v-model="form.barcode" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="form.category" />
        </el-form-item>
        <el-form-item label="上新时间">
          <el-input v-model="form.listing_time" placeholder="如 2026-08" />
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="form.unit" />
        </el-form-item>
        <el-form-item label="售价">
          <el-input-number v-model="form.unit_price" :min="0" :precision="2" :step="1" />
        </el-form-item>
        <el-form-item label="采购成本">
          <el-input-number v-model="form.purchase_cost" :min="0" :precision="2" :step="1" />
        </el-form-item>
        <el-form-item label="头程运费">
          <el-input-number v-model="form.first_leg_freight" :min="0" :precision="2" :step="1" />
        </el-form-item>
        <el-form-item label="尾程派送(比索)">
          <el-input-number v-model="form.last_mile_delivery_peso" :min="0" :precision="2" :step="1" />
        </el-form-item>
        <el-form-item label="佣金率">
          <el-input-number v-model="form.ml_commission_rate" :min="0" :max="1" :precision="4" :step="0.001" />
        </el-form-item>
        <el-form-item label="运输方式">
          <el-select v-model="form.shipping_mode" style="width: 100%">
            <el-option label="海运" value="海运" />
            <el-option label="空运" value="空运" />
          </el-select>
        </el-form-item>
        <el-form-item label="链接ID">
          <el-input v-model="form.link_id" />
        </el-form-item>
        <el-form-item label="竞品ID">
          <el-input v-model="form.competitor_id" />
        </el-form-item>
        <el-form-item label="币种">
          <el-select v-model="form.currency" style="width: 100%">
            <el-option label="MXN" value="MXN" />
            <el-option label="CNY" value="CNY" />
            <el-option label="USD" value="USD" />
            <el-option label="PHP" value="PHP" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ editing ? '保存修改' : '保存' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importResultVisible" title="导入结果明细" width="680px" destroy-on-close>
      <div style="max-height: 420px; overflow: auto; font-size: 13px; line-height: 1.8">
        <div
          v-for="(line, i) in importResultLines"
          :key="i"
          :style="{ color: line.startsWith('[失败]') ? '#F56C6C' : '#E6A23C' }"
        >
          {{ line }}
        </div>
        <div v-if="!importResultLines.length" style="color: var(--color-muted)">无明细</div>
      </div>
      <template #footer>
        <el-button @click="importResultVisible = false">关闭</el-button>
        <el-button type="primary" @click="downloadImportResult">下载明细</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="图片预览" width="auto" align-center>
      <div class="preview-box">
        <img :src="previewUrl" class="preview-img" referrerpolicy="no-referrer" @error="onImgError($event)" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute } from 'vue-router'
import { api } from '../services/api'
import { useAuthStore } from '../stores/auth'
import type { Product } from '../types'
import { exportTable, todayStr } from '../utils/export'
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum, extractFloatingImages, compressImageDataUrl } from '../utils/import'
import { addLog } from '../utils/log'

const auth = useAuthStore()
const route = useRoute()
const canWrite = computed(() => auth.hasPermission('products.write'))
const canDelete = computed(() => auth.hasPermission('products.delete'))

const rows = ref<Product[]>([])
const total = ref(0)
const loading = ref(false)
const previewVisible = ref(false)
const previewUrl = ref('')
const query = reactive({ page: 1, pageSize: 20, search: '', status: '', sales_from: '', sales_to: '' })
const rate = ref(0.38)
const salesRange = ref<[string, string] | null>(null)

// 自定义销量区间变化：只传起止日期，切换后回到第一页
function onSalesRangeChange() {
  if (salesRange.value && salesRange.value.length === 2) {
    query.sales_from = salesRange.value[0]
    query.sales_to = salesRange.value[1]
  } else {
    query.sales_from = ''
    query.sales_to = ''
  }
  query.page = 1
  load()
}

// 支持全局搜索跳转：/products?search=关键词（MainLayout 顶栏搜索 Ctrl/⌘K）
watch(
  () => route.query.search,
  (v) => {
    const kw = typeof v === 'string' ? v : ''
    if (query.search === kw) return
    query.search = kw
    query.page = 1
    load()
  }
)

function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

function money(v: number) {
  return Number.isFinite(v) ? v.toFixed(2) : '0.00'
}

function pct(v: unknown) {
  const n = Number(v ?? 0.165)
  return `${(n * 100).toFixed(1)}%`
}

// 平台利润(元) = (售价比索 - 总成本比索) × 汇率
// 总成本比索 = 货值 + 尾程 + 仓储 + 实操 + 佣金 + 广告 + 扣税 + 补偿
function profit(row: Product) {
  const r = rate.value || 0.38
  const sellingPeso = Number(row.unit_price ?? 0)
  const purchase = Number(row.purchase_cost ?? 0)
  const freight = Number(row.first_leg_freight ?? 0)
  const lastMile = Number(row.last_mile_delivery_peso ?? 0)
  const ml = Number(row.ml_commission_rate ?? 0.165) || 0.165
  const taxedPeso = (purchase * 1.13) / r
  const freightPeso = freight / r
  const goodsValue = taxedPeso + freightPeso
  const storage = goodsValue * 0.008
  const operation = goodsValue * 0.05
  const commission = sellingPeso * ml
  const ad = sellingPeso * 0.08
  const tax = sellingPeso * 0.09
  const compensation = sellingPeso * 0.07
  const totalCost = goodsValue + lastMile + storage + operation + commission + ad + tax + compensation
  return (sellingPeso - totalCost) * r
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

function onPreviewImage(url: string) {
  previewUrl.value = url
  previewVisible.value = true
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/products', { params: query })
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

const dialogVisible = ref(false)
const saving = ref(false)
const editing = ref<Product | null>(null)
const imageInput = ref<HTMLInputElement>()

const emptyForm = () => ({
  sku: '',
  name: '',
  code: '',
  barcode: '',
  category: '',
  listing_time: '',
  unit: '套',
  unit_price: 0,
  purchase_cost: 0,
  first_leg_freight: 0,
  last_mile_delivery_peso: 0,
  ml_commission_rate: 0.165,
  shipping_mode: '海运',
  link_id: '',
  competitor_id: '',
  currency: 'MXN',
  status: 'active',
  image_text: '',
})
const form = reactive(emptyForm())

function openCreate() {
  editing.value = null
  Object.assign(form, emptyForm())
  dialogVisible.value = true
}

function openEdit(row: Product) {
  editing.value = row
  Object.assign(form, emptyForm(), {
    sku: row.sku || '',
    name: row.name || '',
    code: row.code || '',
    barcode: row.barcode || '',
    category: row.category || '',
    listing_time: row.listing_time || '',
    unit: row.unit || '套',
    unit_price: row.unit_price ?? 0,
    purchase_cost: row.purchase_cost ?? 0,
    first_leg_freight: row.first_leg_freight ?? 0,
    last_mile_delivery_peso: row.last_mile_delivery_peso ?? 0,
    ml_commission_rate: row.ml_commission_rate ?? 0.165,
    shipping_mode: row.shipping_mode || '海运',
    link_id: row.link_id || '',
    competitor_id: row.competitor_id || '',
    currency: row.currency || 'MXN',
    status: row.status || 'active',
    image_text: row.image_text || '',
  })
  dialogVisible.value = true
}

function onImageFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUrl = String(reader.result || '')
    // 本地图片先压缩（最长边800、质量0.7），避免超大 base64 存入表单
    const compressed = await compressImageDataUrl(dataUrl)
    form.image_text = compressed
  }
  reader.readAsDataURL(file)
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写名称')
    return
  }
  saving.value = true
  try {
    // 本地图片（data URL）先上传 Storage 换取公开 URL，避免大 base64 存库
    let imageText = form.image_text.trim()
    if (imageText.startsWith('data:image/')) {
      try {
        const up = await api.post('/products/upload-image', { base64: imageText, sku: form.sku || 'img' })
        imageText = up.data?.url || imageText
      } catch {
        // 上传失败则保留原值，由后端 schema 长度校验兜底提示
      }
    }
    const payload: Record<string, unknown> = { ...form, image_text: imageText }
    // SKU 未填时以 null 入库（数据库已允许空 SKU），避免空字符串歧义
    if (!payload.sku) payload.sku = null
    if (editing.value) {
      await api.patch(`/products/${editing.value.id}`, payload)
      addLog('success', '编辑商品', form.name)
      ElMessage.success('修改成功')
    } else {
      await api.post('/products', payload)
      addLog('success', '新增商品', form.name)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: Product) {
  try {
    await ElMessageBox.confirm(`确定删除商品「${row.sku || row.name}」吗？此操作不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/products/${row.id}`)
    addLog('success', '删除商品', row.sku || row.name)
    ElMessage.success('删除成功')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

const selected = ref<Product[]>([])
function onSelectionChange(rows: Product[]) {
  selected.value = rows
}

const exporting = ref(false)
function exportRows() {
  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'code', label: '产品编号' },
    { key: 'name', label: '名称' },
    { key: 'barcode', label: '条形码' },
    { key: 'category', label: '分类' },
    { key: 'domestic_stock', label: '国内库存' },
    { key: 'overseas_stock', label: '国外库存' },
    { key: 'in_transit_qty', label: '在途数量' },
    { key: 'sales_qty', label: '总销量' },
    { key: 'sales_today', label: '日销量' },
    { key: 'sales_7d', label: '7天销量' },
    { key: 'sales_15d', label: '15天销量' },
    { key: 'sales_month', label: '月销量' },
    {
      key: 'sales_custom',
      label: '自定义销量',
      value: (r: Product) => (salesRange.value && salesRange.value.length === 2 ? (r.sales_custom ?? 0) : ''),
    },
    { key: 'listing_time', label: '上新时间' },
    { key: 'unit', label: '单位' },
    { key: 'unit_price', label: '售价' },
    { key: 'purchase_cost', label: '采购成本' },
    { key: 'shipping_mode', label: '空海运' },
    { key: 'competitor_id', label: '竞品ID' },
    { key: 'link_id', label: '链接ID' },
    { key: 'currency', label: '币种' },
    {
      key: 'status',
      label: '状态',
      value: (r: Product) => (r.status === 'active' ? '启用' : '停用'),
    },
    {
      key: 'image_text',
      label: '图片链接',
      value: (r: Product) => (isImageUrl(r.image_text) ? r.image_text : ''),
    },
    {
      key: 'created_at',
      label: '创建时间',
      value: (r: Product) => formatDate(r.created_at),
    },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `商品列表_${todayStr()}.xlsx`)
    addLog('info', '导出商品', `共 ${rows.value.length} 条`)
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selected.value.length} 个商品吗？此操作不可恢复。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const ids = selected.value.map((r) => r.id)
  try {
    const { data } = await api.post('/products/batch-delete', { ids })
    ElMessage.success(
      `删除完成：成功 ${data.deleted} 条${data.missing ? `，未找到 ${data.missing} 条` : ''}`
    )
    addLog('info', '批量删除商品', `成功 ${data.deleted} 条${data.missing ? `，未找到 ${data.missing} 条` : ''}`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
  selected.value = []
  load()
}

/* ---------- 下载模板 / 批量导入 ---------- */
const importing = ref(false)
const importFile = ref<HTMLInputElement>()
const importResultVisible = ref(false)
const importResultLines = ref<string[]>([])

function downloadImportResult() {
  const content = '\ufeff' + importResultLines.value.join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `导入结果明细_${todayStr()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadTpl() {
  downloadTemplate(
    [
      { label: 'SKU', sample: 'SKU-NEW-001' },
      { label: '名称', sample: '示例商品' },
      { label: '产品编号', sample: 'LC-2026-001' },
      { label: '条形码', sample: '6901234567890' },
      { label: '分类', sample: '家居' },
      { label: '上新时间', sample: '2026-08' },
      { label: '单位', sample: '套' },
      { label: '售价', sample: 329 },
      { label: '采购成本', sample: 120 },
      { label: '头程运费', sample: 15 },
      { label: '尾程派送(比索)', sample: 0 },
      { label: '佣金率', sample: 0.165 },
      { label: '运输方式', sample: '海运' },
      { label: '链接ID', sample: 'M20260815' },
      { label: '竞品ID', sample: '' },
      { label: '币种', sample: 'MXN' },
      { label: '状态', sample: '启用' },
      { label: '图片链接', sample: '' },
    ],
    '商品导入模板',
    '商品批量导入模板.xlsx'
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
    const fileAb = await file.arrayBuffer()
    const { headers, rows } = await readExcelFile(file)
    const cellImages = await extractFloatingImages(fileAb)
    const col = buildColMap(headers, {
      sku: ['SKU', 'sku', '编码'],
      name: ['名称', 'name', '商品名称'],
      code: ['产品编号', 'code', 'listing code'],
      barcode: ['条形码', 'barcode', '条码'],
      category: ['分类', 'category'],
      listing_time: ['上新时间', 'listing_time'],
      unit: ['单位', 'unit'],
      unit_price: ['售价', 'unit_price', '价格'],
      purchase_cost: ['采购成本', 'purchase_cost'],
      first_leg_freight: ['头程运费', 'first_leg_freight'],
      last_mile_delivery_peso: ['尾程派送(比索)', '尾程派送', 'last_mile_delivery_peso'],
      ml_commission_rate: ['佣金率', 'ml_commission_rate'],
      shipping_mode: ['运输方式', 'shipping_mode', '空海运'],
      link_id: ['链接ID', 'link_id'],
      competitor_id: ['竞品ID', 'competitor_id'],
      currency: ['币种', 'currency'],
      status: ['状态', 'status'],
      image_text: ['图片链接', 'image_text', '图片'],
    })
    if (col.code === undefined || col.name === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"产品编号"和"名称"列')
      return
    }
    // 拉取全量已存在产品编码，避免重复创建
    const exist = new Set<string>()
    let page = 1
    for (;;) {
      const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
      ;(data.data ?? []).forEach((p: any) => {
        if (p.code) exist.add(p.code)
      })
      if (page * 200 >= (data.total ?? 0)) break
      page++
    }
    const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
    const seen = new Set<string>()
    const skipLines: string[] = []
    const items: { payload: Record<string, unknown>; lineNo: number; code: string }[] = []
    rows.forEach((row, idx) => {
      const lineNo = idx + 2
      const code = cut(cellStr(row, col.code), 255)
      const name = cut(cellStr(row, col.name), 200)
      const sku = cut(cellStr(row, col.sku), 200)
      if (!code) {
        skipLines.push(`第${lineNo}行：产品编码为空`)
        return
      }
      if (!name) {
        skipLines.push(`第${lineNo}行：名称为空`)
        return
      }
      if (exist.has(code) || seen.has(code)) {
        skipLines.push(`第${lineNo}行：产品编码「${code}」已存在，跳过`)
        return
      }
      seen.add(code)
      // 佣金率宽容处理：>1 视为百分数（如 16.5 -> 0.165），越界回默认
      let ml = col.ml_commission_rate !== undefined ? cellNum(row, col.ml_commission_rate, 0.165) : 0.165
      if (ml > 1) ml = ml / 100
      if (ml < 0 || ml > 1) ml = 0.165
      const statusRaw = cellStr(row, col.status)
      const urlText = cut(cellStr(row, col.image_text), 255)
      // 浮动图片：Excel 行号（0-based）= idx + 1（表头行=0，首条数据行=1）
      const floatImg = cellImages?.[idx + 1] ? Object.values(cellImages[idx + 1])[0] : ''
      items.push({
        payload: {
          sku: sku || null,
          name,
          code,
          barcode: cut(cellStr(row, col.barcode), 64),
          category: cut(cellStr(row, col.category), 100),
          listing_time: cut(cellStr(row, col.listing_time), 255),
          unit: cut(cellStr(row, col.unit) || '套', 50),
          unit_price: col.unit_price !== undefined ? cellNum(row, col.unit_price) : 0,
          purchase_cost: col.purchase_cost !== undefined ? cellNum(row, col.purchase_cost) : 0,
          first_leg_freight: col.first_leg_freight !== undefined ? cellNum(row, col.first_leg_freight) : 0,
          last_mile_delivery_peso:
            col.last_mile_delivery_peso !== undefined ? cellNum(row, col.last_mile_delivery_peso) : 0,
          ml_commission_rate: ml,
          shipping_mode: cut(cellStr(row, col.shipping_mode) || '海运', 20),
          link_id: cut(cellStr(row, col.link_id), 255),
          competitor_id: cut(cellStr(row, col.competitor_id), 255),
          currency: cut(cellStr(row, col.currency) || 'MXN', 8),
          status: statusRaw === '停用' || statusRaw === 'inactive' ? 'inactive' : 'active',
          image_text: urlText || '',
          image_base64: floatImg && !urlText ? floatImg : '',
        },
        lineNo,
        code,
      })
    })
    // 分批并行创建：按批次首元素是否有图动态切批——无图每批 50 条并发，含图每批 20 条（避免大请求体触发 Vercel 限制），失败逐条记录完整原因
    let ok = 0
    const errLines: string[] = []
    for (let i = 0; i < items.length; ) {
      const hasImg = Boolean(items[i].payload.image_base64)
      const BATCH = hasImg ? 20 : 50
      const batch = items.slice(i, i + BATCH)
      await Promise.all(
        batch.map(async (item) => {
          try {
            await api.post('/products', item.payload)
            ok++
          } catch (err: any) {
            errLines.push(
              `第${item.lineNo}行 产品编码 ${item.code}：${err?.response?.data?.error?.message || err?.message || '创建失败'}`
            )
          }
        })
      )
      i += BATCH
    }
    const summary = `导入完成：成功 ${ok} 条${skipLines.length ? `，跳过 ${skipLines.length} 条` : ''}${
      errLines.length ? `，失败 ${errLines.length} 条` : ''
    }`
    ElMessage.success(summary)
    addLog('info', '批量导入商品', summary)
    if (skipLines.length || errLines.length) {
      importResultLines.value = [
        ...skipLines.map((s) => `[跳过] ${s}`),
        ...errLines.map((s) => `[失败] ${s}`),
      ]
      importResultVisible.value = true
    }
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

onMounted(() => {
  // 首次挂载时读取 URL 搜索参数（如顶栏全局搜索跳转带入）
  const kw = typeof route.query.search === 'string' ? route.query.search : ''
  if (kw) query.search = kw
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
/* 固定右列（操作列）不透明背景：滚动时不再透出下层数据（仅数据单元格，表头保持原样） */
.table-wrap :deep(.el-table__body .el-table-fixed-column--right) {
  background: #fff !important;
}
html.dark .table-wrap :deep(.el-table__body .el-table-fixed-column--right) {
  background: #1e2438 !important;
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
.profit-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 8px);
  background: var(--color-card);
}
.profit-label {
  font-size: 13px;
  color: var(--color-muted);
  white-space: nowrap;
}
.profit-tip {
  font-size: 12px;
  color: var(--color-muted);
}
.profit-pos {
  color: #16a34a;
  font-weight: 600;
}
.profit-neg {
  color: #dc2626;
  font-weight: 600;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
.product-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  vertical-align: middle;
}
.img-preview {
  max-width: 280px;
  max-height: 280px;
  display: block;
}
.preview-box {
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.preview-img {
  max-width: 100px;
  max-height: 100px;
  object-fit: contain;
  display: block;
}
.img-text-cell {
  font-size: 12px;
  color: var(--color-muted);
  max-width: 80px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.img-fallback {
  width: 56px;
  height: 56px;
  line-height: 56px;
  text-align: center;
  color: var(--color-muted);
  background: var(--color-fill);
  border-radius: 4px;
  font-size: 12px;
}
</style>
