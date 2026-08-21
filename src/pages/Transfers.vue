<template>
  <div class="page">
    <div class="page-header">
      <h2>调拨发货管理</h2>
      <div>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增调拨发货</el-button>
      </div>
    </div>

    <div class="filters">
      <el-input v-model="query.tracking_no" placeholder="货件号" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
      <el-select v-model="query.shipping_mode" placeholder="空海运" clearable style="width: 140px" @change="load">
        <el-option label="空运" value="空运" />
        <el-option label="海运" value="海运" />
      </el-select>
      <el-select v-model="query.cargo_status" placeholder="货物状态" clearable style="width: 160px" @change="load">
        <el-option v-for="s in cargoStatuses" :key="s.name" :label="s.name" :value="s.name" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-wrap">
      <el-table v-loading="loading" :data="rows" border stripe height="100%" @selection-change="onSelectionChange" :row-style="rowStyle">
        <el-table-column type="selection" width="46" />
        <el-table-column prop="tracking_no" label="货件号" min-width="160" show-overflow-tooltip />
        <el-table-column prop="cargo_code" label="货代号" min-width="140" show-overflow-tooltip />
        <el-table-column label="货代" min-width="140">
          <template #default="{ row }">{{ forwarderName(row.forwarder_id) }}</template>
        </el-table-column>
        <el-table-column label="空海运" width="100">
          <template #default="{ row }">
            <el-tag :type="row.shipping_mode === '空运' ? 'primary' : 'warning'" effect="plain">{{ row.shipping_mode || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="箱数" width="100" align="right">
          <template #default="{ row }">{{ row.shipping_cartons ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="总数" width="110" align="right">
          <template #default="{ row }">{{ totalQty(row) }}</template>
        </el-table-column>
        <el-table-column label="发货时间" width="120">
          <template #default="{ row }">{{ row.ship_date || '-' }}</template>
        </el-table-column>
        <el-table-column label="货物状态" width="120">
          <template #default="{ row }">
            <el-tag :style="{ backgroundColor: getCargoColor(row.cargo_status), color: getCargoTextColor(row.cargo_status), borderColor: getCargoColor(row.cargo_status) }">
              {{ row.cargo_status || '-' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="160">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row.id)">详情</el-button>
            <el-button link type="primary" @click="openEdit(row.id)">编辑</el-button>
            <el-button link type="success" @click="printWorkOrder(row.id)">打印</el-button>
            <el-button v-if="canWrite" link type="danger" @click="removeOne(row)">删除</el-button>
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

    <el-dialog v-model="createVisible" title="新增调拨发货" width="760px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="货件号" required>
              <el-input v-model="form.tracking_no" placeholder="货件号（唯一）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="货代号">
              <el-input v-model="form.cargo_code" placeholder="货代号" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="货代" required>
              <el-select v-model="form.forwarder_id" placeholder="选择货代" clearable filterable style="width: 100%">
                <el-option v-for="f in forwarders" :key="f.id" :label="f.name" :value="f.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="空海运" required>
              <el-radio-group v-model="form.shipping_mode">
                <el-radio value="空运">空运</el-radio>
                <el-radio value="海运">海运</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="箱数" required>
              <el-input-number v-model="form.shipping_cartons" :min="0" :precision="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="发货时间" required>
              <el-date-picker v-model="form.ship_date" type="date" value-format="YYYY-MM-DD" placeholder="选择发货时间" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="商品明细" required>
          <div class="items-editor">
            <div v-for="(it, idx) in form.items" :key="idx" class="item-row">
              <el-select v-model="it.product_id" filterable placeholder="产品编码 / SKU" style="flex: 1">
                <el-option v-for="p in products" :key="p.id" :label="`${productCode(p)} - ${p.name}`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.quantity" :min="1" :precision="0" placeholder="数量" style="width: 150px" />
              <el-button link type="danger" @click="removeItem(idx)">删除</el-button>
            </div>
            <el-button size="small" @click="addItem">添加明细</el-button>
            <div class="total-hint">总数（明细数量合计）：<b>{{ totalOfItems }}</b></div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="调拨发货详情" width="760px">
      <el-descriptions v-if="detail" :column="2" border>
        <el-descriptions-item label="货件号">{{ detail.tracking_no }}</el-descriptions-item>
        <el-descriptions-item label="货代号">{{ detail.cargo_code || '-' }}</el-descriptions-item>
        <el-descriptions-item label="货代">{{ forwarderName(detail.forwarder_id) }}</el-descriptions-item>
        <el-descriptions-item label="空海运">{{ detail.shipping_mode || '-' }}</el-descriptions-item>
        <el-descriptions-item label="箱数">{{ detail.shipping_cartons ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="总数">{{ totalQty(detail) }}</el-descriptions-item>
        <el-descriptions-item label="发货时间">{{ detail.ship_date || '-' }}</el-descriptions-item>
        <el-descriptions-item label="货物状态">{{ detail.cargo_status || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间" :span="2">{{ formatDate(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="detail" :data="detail.shipment_items || []" border stripe size="small" style="margin-top: 12px">
        <el-table-column label="产品编码" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ productInfo(row.product_id) }}</template>
        </el-table-column>
        <el-table-column label="数量" width="100" align="right">
          <template #default="{ row }">{{ row.quantity }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button type="success" @click="printWorkOrder(detail.id)">打印工单</el-button>
        <el-button v-if="canWrite" type="primary" @click="openEdit(detail.id)">编辑</el-button>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑调拨发货" width="760px" destroy-on-close>
      <el-form :model="editForm" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="货件号" required>
              <el-input v-model="editForm.tracking_no" placeholder="货件号（唯一）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="货代号">
              <el-input v-model="editForm.cargo_code" placeholder="货代号" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="货代" required>
              <el-select v-model="editForm.forwarder_id" placeholder="选择货代" clearable filterable style="width: 100%">
                <el-option v-for="f in forwarders" :key="f.id" :label="f.name" :value="f.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="空海运" required>
              <el-radio-group v-model="editForm.shipping_mode">
                <el-radio value="空运">空运</el-radio>
                <el-radio value="海运">海运</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="箱数" required>
              <el-input-number v-model="editForm.shipping_cartons" :min="0" :precision="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="发货时间" required>
              <el-date-picker v-model="editForm.ship_date" type="date" value-format="YYYY-MM-DD" placeholder="选择发货时间" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="商品明细" required>
          <div class="items-editor">
            <div v-for="(it, idx) in editForm.items" :key="idx" class="item-row">
              <el-select v-model="it.product_id" filterable placeholder="产品编码 / SKU" style="flex: 1">
                <el-option v-for="p in products" :key="p.id" :label="`${productCode(p)} - ${p.name}`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.quantity" :min="1" :precision="0" placeholder="数量" style="width: 150px" />
              <el-button link type="danger" @click="removeEditItem(idx)">删除</el-button>
            </div>
            <el-button size="small" @click="addEditItem">添加明细</el-button>
            <div class="total-hint">总数（明细数量合计）：<b>{{ editTotalOfItems }}</b></div>
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
import { useAuthStore } from '../stores/auth'
import { exportTable, todayStr } from '../utils/export'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('shipment.write'))

function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, tracking_no: '', shipping_mode: '', cargo_status: '' })

function totalQty(row: any) {
  const items = row.shipment_items
  if (!Array.isArray(items) || !items.length) return 0
  return items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
}

async function load() {
  loading.value = true
  try {
    const params: any = { page: query.page, pageSize: query.pageSize, source: 'transfer' }
    if (query.tracking_no.trim()) params.tracking_no = query.tracking_no.trim()
    if (query.shipping_mode) params.shipping_mode = query.shipping_mode
    if (query.cargo_status) params.cargo_status = query.cargo_status
    const { data } = await api.get('/shipments', { params })
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

function rowStyle({ row }: { row: any }) {
  const color = getCargoColor(row.cargo_status)
  if (color && color !== '#FFFFFF') {
    return { backgroundColor: color + '22' }
  }
  return {}
}

const forwarders = ref<any[]>([])
function forwarderName(id: string) {
  return forwarders.value.find((f) => f.id === id)?.name || '-'
}

const products = ref<any[]>([])
function productCode(p: any) {
  return p.code || p.sku || p.id
}
function productInfo(pid: string) {
  const p = products.value.find((x) => x.id === pid)
  return p ? `${productCode(p)} - ${p.name}` : pid
}

const cargoStatuses = ref<any[]>([])
function getCargoColor(name: string) {
  return cargoStatuses.value.find((x) => x.name === name)?.color || '#FFFFFF'
}
function getCargoTextColor(name: string) {
  const color = getCargoColor(name)
  if (!color || color === '#FFFFFF') return '#606266'
  return '#FFFFFF'
}

async function loadOptions() {
  try {
    const [fRes, csRes, pRes] = await Promise.all([
      api.get('/forwarders'),
      api.get('/cargo-statuses'),
      loadAllProducts(),
    ])
    forwarders.value = fRes.data.data ?? []
    cargoStatuses.value = csRes.data.data ?? []
    products.value = pRes
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

async function loadAllProducts(): Promise<any[]> {
  const all: any[] = []
  let page = 1
  const pageSize = 200
  for (;;) {
    const { data } = await api.get('/products', { params: { page, pageSize } })
    const list = data.data ?? []
    all.push(...list)
    if (all.length >= (data.total ?? 0) || list.length < pageSize) break
    page++
  }
  return all
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  tracking_no: '',
  cargo_code: '',
  forwarder_id: '',
  shipping_mode: '空运',
  shipping_cartons: 0,
  ship_date: '',
  items: [] as any[],
})

const totalOfItems = computed(() => form.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0))

function addItem() {
  form.items.push({ product_id: '', quantity: 1 })
}
function removeItem(idx: number) {
  form.items.splice(idx, 1)
}

function openCreate() {
  form.tracking_no = ''
  form.cargo_code = ''
  form.forwarder_id = ''
  form.shipping_mode = '空运'
  form.shipping_cartons = 0
  form.ship_date = ''
  form.items = []
  addItem()
  createVisible.value = true
}

async function save() {
  if (!form.tracking_no.trim()) {
    ElMessage.warning('请填写货件号')
    return
  }
  if (!form.forwarder_id) {
    ElMessage.warning('请选择货代')
    return
  }
  if (!form.shipping_mode) {
    ElMessage.warning('请选择空运/海运')
    return
  }
  if (!form.ship_date) {
    ElMessage.warning('请选择发货时间')
    return
  }
  const items = form.items.filter((it) => it.product_id)
  if (!items.length) {
    ElMessage.warning('请至少添加一条商品明细')
    return
  }
  saving.value = true
  try {
    await api.post('/shipments', {
      tracking_no: form.tracking_no.trim(),
      cargo_code: form.cargo_code.trim() || null,
      forwarder_id: form.forwarder_id,
      shipping_mode: form.shipping_mode,
      shipping_cartons: form.shipping_cartons ?? 0,
      ship_date: form.ship_date,
      items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity })),
      source: 'transfer',
      cargo_status: '转运中',
    })
    ElMessage.success('创建成功，已同步到发货管理')
    createVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const detailVisible = ref(false)
const detail = ref<any>(null)
async function fetchDetail(id: string) {
  const { data } = await api.get(`/shipments/${id}`)
  return data.data
}
async function openDetail(id: string) {
  try {
    detail.value = await fetchDetail(id)
    detailVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载详情失败')
  }
}

const editVisible = ref(false)
const editingId = ref('')
const editForm = reactive({
  tracking_no: '',
  cargo_code: '',
  forwarder_id: '',
  shipping_mode: '空运',
  shipping_cartons: 0,
  ship_date: '',
  items: [] as any[],
})
const editTotalOfItems = computed(() => editForm.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0))

function addEditItem() {
  editForm.items.push({ product_id: '', quantity: 1 })
}
function removeEditItem(idx: number) {
  editForm.items.splice(idx, 1)
}

async function openEdit(id: string) {
  try {
    const d = await fetchDetail(id)
    editingId.value = id
    editForm.tracking_no = d.tracking_no
    editForm.cargo_code = d.cargo_code || ''
    editForm.forwarder_id = d.forwarder_id || ''
    editForm.shipping_mode = d.shipping_mode || '空运'
    editForm.shipping_cartons = d.shipping_cartons ?? 0
    editForm.ship_date = d.ship_date || ''
    editForm.items = (d.shipment_items || []).map((it: any) => ({
      product_id: it.product_id,
      quantity: it.quantity,
    }))
    if (!editForm.items.length) addEditItem()
    editVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载数据失败')
  }
}

async function saveEdit() {
  if (!editForm.tracking_no.trim()) {
    ElMessage.warning('请填写货件号')
    return
  }
  if (!editForm.forwarder_id) {
    ElMessage.warning('请选择货代')
    return
  }
  if (!editForm.shipping_mode) {
    ElMessage.warning('请选择空运/海运')
    return
  }
  if (!editForm.ship_date) {
    ElMessage.warning('请选择发货时间')
    return
  }
  const items = editForm.items.filter((it) => it.product_id)
  if (!items.length) {
    ElMessage.warning('请至少添加一条商品明细')
    return
  }
  saving.value = true
  try {
    await api.patch(`/shipments/${editingId.value}`, {
      tracking_no: editForm.tracking_no.trim(),
      cargo_code: editForm.cargo_code.trim() || null,
      forwarder_id: editForm.forwarder_id,
      shipping_mode: editForm.shipping_mode,
      shipping_cartons: editForm.shipping_cartons ?? 0,
      ship_date: editForm.ship_date,
      items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity })),
    })
    ElMessage.success('修改成功')
    editVisible.value = false
    if (detailVisible.value) {
      detail.value = await fetchDetail(editingId.value)
    }
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function printWorkOrder(id: string) {
  try {
    const d = await fetchDetail(id)
    const items = d.shipment_items || []
    const totalQtyNum = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
    const prod = (pid: string) => products.value.find((x) => x.id === pid)
    const rowsHtml = items
      .map((it: any, i: number) => {
        const p = prod(it.product_id)
        const img = p?.image_text
        const imgHtml = img
          ? `<img src="${img}" style="width:60px;height:60px;object-fit:contain;border:1px solid #ccc;border-radius:3px;background:#fff" onerror="this.style.display='none'" />`
          : `<span style="color:#aaa">-</span>`
        return `
        <tr>
          <td>${i + 1}</td>
          <td>${p?.code || pid}</td>
          <td>${imgHtml}</td>
          <td>${p?.name || '-'}</td>
          <td>${p?.sku || '-'}</td>
          <td>${p?.barcode || '-'}</td>
          <td class="num">${it.quantity}</td>
        </tr>`
      })
      .join('')
    const now = new Date().toLocaleString('zh-CN', { hour12: false })
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>发货工单 - ${d.tracking_no}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "SimSun", sans-serif; color: #000; padding: 24px; }
  h1 { text-align: center; font-size: 26px; letter-spacing: 12px; margin-bottom: 24px; font-weight: 700; }
  .meta { border: 1.5px solid #000; margin-bottom: 16px; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { border: 1px solid #000; padding: 8px 12px; font-size: 14px; }
  .meta .label { background: #f5f5f5; width: 110px; text-align: right; font-weight: 600; }
  .items { border: 1.5px solid #000; margin-bottom: 8px; }
  .items table { width: 100%; border-collapse: collapse; table-layout: auto; }
  .items th, .items td { border: 1px solid #000; padding: 6px 8px; font-size: 13px; text-align: center; vertical-align: middle; word-break: break-all; }
  .items th { background: #f5f5f5; font-weight: 600; }
  .items td.num { text-align: right; font-weight: 600; white-space: nowrap; }
  .sum-row td { background: #fafafa; font-weight: 700; white-space: nowrap; }
  .print-time { text-align: right; margin-top: 14px; font-size: 11px; color: #666; }
  @media print {
    @page { size: A4 portrait; margin: 15mm; }
    body { padding: 0; }
  }
</style>
</head>
<body>
  <h1>发货工单</h1>
  <div class="meta">
    <table>
      <tr>
        <td class="label">货件号</td><td>${d.tracking_no || '-'}</td>
        <td class="label">货代号</td><td>${d.cargo_code || '-'}</td>
      </tr>
      <tr>
        <td class="label">货　代</td><td>${forwarderName(d.forwarder_id)}</td>
        <td class="label">运输方式</td><td>${d.shipping_mode || '-'}</td>
      </tr>
      <tr>
        <td class="label">箱　数</td><td>${d.shipping_cartons ?? '-'} 箱</td>
        <td class="label">发货时间</td><td>${d.ship_date || '-'}</td>
      </tr>
      <tr>
        <td class="label">货物状态</td><td colspan="3">${d.cargo_status || '-'}</td>
      </tr>
    </table>
  </div>
  <div class="items">
    <table>
      <thead>
        <tr>
          <th style="width:46px">序号</th>
          <th style="min-width:110px">产品编码</th>
          <th style="width:76px">图片</th>
          <th style="min-width:150px">产品中文名称</th>
          <th style="min-width:110px">SKU</th>
          <th style="min-width:160px">条形码</th>
          <th style="width:80px">数量</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr class="sum-row">
          <td colspan="6" style="text-align:right">合计数量（总数）</td>
          <td class="num">${totalQtyNum}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="print-time">制单时间：${now}</div>
</body>
</html>`
    const w = window.open('', '_blank', 'width=900,height=900')
    if (!w) {
      ElMessage.warning('浏览器拦截了弹窗，请允许弹出窗口后重试')
      return
    }
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '生成工单失败')
  }
}

const selected = ref<any[]>([])
function onSelectionChange(list: any[]) {
  selected.value = list
}

async function removeOne(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除货件「${row.tracking_no}」吗？此操作不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/shipments/${row.id}`)
    ElMessage.success('删除成功')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 个调拨发货吗？此操作不可恢复。`, '批量删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const ids = selected.value.map((r) => r.id)
  let ok = 0
  let fail = 0
  for (const id of ids) {
    try {
      await api.delete(`/shipments/${id}`)
      ok++
    } catch {
      fail++
    }
  }
  ElMessage.success(`删除完成：成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
  selected.value = []
  load()
}

const exporting = ref(false)
function exportRows() {
  const columns = [
    { key: 'tracking_no', label: '货件号' },
    { key: 'cargo_code', label: '货代号' },
    { key: 'forwarder_id', label: '货代', value: (r: any) => forwarderName(r.forwarder_id) },
    { key: 'shipping_mode', label: '空海运' },
    { key: 'shipping_cartons', label: '箱数' },
    { key: 'total_qty', label: '总数', value: (r: any) => totalQty(r) },
    { key: 'ship_date', label: '发货时间' },
    { key: 'cargo_status', label: '货物状态' },
    { key: 'created_at', label: '创建时间', value: (r: any) => formatDate(r.created_at) },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `调拨发货_${todayStr()}.xlsx`)
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  load()
  loadOptions()
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
  margin-bottom: 16px;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
.items-editor {
  width: 100%;
}
.item-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.total-hint {
  margin-top: 8px;
  font-size: 13px;
  color: #606266;
}
</style>
