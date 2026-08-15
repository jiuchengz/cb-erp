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
        placeholder="搜索 SKU / 名称 / 条形码"
        clearable
        style="width: 260px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 140px" @change="load">
        <el-option label="启用" value="active" />
        <el-option label="停用" value="inactive" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column label="图片" width="90">
        <template #default="{ row }">
          <el-tooltip v-if="isImageUrl(row.image_text)" :show-after="200" :offset="10">
            <template #content>
              <img :src="row.image_text" class="img-preview" referrerpolicy="no-referrer" @error="onImgError($event)" />
            </template>
            <img :src="row.image_text" class="product-thumb" referrerpolicy="no-referrer" @error="onImgError($event)" />
          </el-tooltip>
          <div v-else-if="row.image_text" class="img-text-cell" :title="row.image_text">{{ row.image_text }}</div>
          <div v-else class="img-fallback">无图片</div>
        </template>
      </el-table-column>
      <el-table-column prop="sku" label="SKU" min-width="140" />
      <el-table-column prop="code" label="产品编号" min-width="140" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="barcode" label="条形码" min-width="140" />
      <el-table-column prop="category" label="分类" min-width="120" />
      <el-table-column prop="listing_time" label="上新时间" width="110" />
      <el-table-column prop="unit" label="单位" width="80" />
      <el-table-column prop="unit_price" label="售价" width="120" align="right" />
      <el-table-column prop="purchase_cost" label="采购成本" width="120" align="right" />
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
        <el-form-item label="SKU" required>
          <el-input v-model="form.sku" placeholder="唯一编码" :disabled="!!editing" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" />
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
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum, extractFloatingImages } from '../utils/import'
import { addLog } from '../utils/log'

const auth = useAuthStore()
const route = useRoute()
const canWrite = computed(() => auth.hasPermission('products.write'))
const canDelete = computed(() => auth.hasPermission('products.delete'))

const rows = ref<Product[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, search: '', status: '' })

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
  reader.onload = () => {
    form.image_text = String(reader.result || '')
  }
  reader.readAsDataURL(file)
}

async function save() {
  if (!form.sku.trim() || !form.name.trim()) {
    ElMessage.warning('请填写 SKU 和名称')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      const payload: Record<string, unknown> = { ...form }
      delete payload.sku // PATCH schema 不允许更新 sku
      await api.patch(`/products/${editing.value.id}`, payload)
      addLog('success', '编辑商品', form.name)
      ElMessage.success('修改成功')
    } else {
      await api.post('/products', form)
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
  let ok = 0
  let fail = 0
  for (const id of ids) {
    try {
      await api.delete(`/products/${id}`)
      ok++
    } catch {
      fail++
    }
  }
  ElMessage.success(`删除完成：成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
  addLog('info', '批量删除商品', `成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
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
    if (col.sku === undefined || col.name === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"SKU"和"名称"列')
      return
    }
    // 拉取全量已存在 SKU，避免重复创建
    const exist = new Set<string>()
    let page = 1
    for (;;) {
      const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
      ;(data.data ?? []).forEach((p: any) => {
        if (p.sku) exist.add(p.sku)
      })
      if (page * 200 >= (data.total ?? 0)) break
      page++
    }
    const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
    const seen = new Set<string>()
    const skipLines: string[] = []
    const items: { payload: Record<string, unknown>; lineNo: number; sku: string }[] = []
    rows.forEach((row, idx) => {
      const lineNo = idx + 2
      const sku = cut(cellStr(row, col.sku), 64)
      const name = cut(cellStr(row, col.name), 200)
      if (!sku) {
        skipLines.push(`第${lineNo}行：SKU为空`)
        return
      }
      if (!name) {
        skipLines.push(`第${lineNo}行：名称为空`)
        return
      }
      if (exist.has(sku) || seen.has(sku)) {
        skipLines.push(`第${lineNo}行：SKU「${sku}」已存在，跳过`)
        return
      }
      seen.add(sku)
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
          sku,
          name,
          code: cut(cellStr(row, col.code), 255),
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
          image_text: urlText || floatImg || '',
          __floatImg: floatImg && !urlText ? floatImg : '',
        },
        lineNo,
        sku,
      })
    })
    // 分批并行创建（每批 10 条），失败逐条记录完整原因
    let ok = 0
    const errLines: string[] = []
    const BATCH = 10
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      await Promise.all(
        batch.map(async (item) => {
          try {
            const imgB64 = (item.payload as any).__floatImg as string
            delete (item.payload as any).__floatImg
            if (imgB64) {
              try {
                const up = await api.post('/products/upload-image', { base64: imgB64, sku: item.sku })
                item.payload.image_text = up.data?.url || item.payload.image_text
              } catch (upErr: any) {
                errLines.push(
                  `第${item.lineNo}行 SKU ${item.sku}：图片上传失败（${
                    upErr?.response?.data?.error?.message || upErr?.message || '未知错误'
                  }）`
                )
              }
            }
            await api.post('/products', item.payload)
            ok++
          } catch (err: any) {
            errLines.push(
              `第${item.lineNo}行 SKU ${item.sku}：${err?.response?.data?.error?.message || err?.message || '创建失败'}`
            )
          }
        })
      )
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
