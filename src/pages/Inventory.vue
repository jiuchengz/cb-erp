<template>
  <div class="page">
    <div class="page-header">
      <h2>库存管理</h2>
      <div>
        <el-button v-if="canAdjust" @click="downloadTpl">下载模板</el-button>
        <el-button :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canAdjust" type="warning" :loading="importing" @click="triggerImport">批量导入</el-button>
        <el-button v-if="canAdjust" type="primary" @click="openAdjust">调整库存</el-button>
        <input ref="importFile" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onImportFile" />
      </div>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="库存列表" name="list">
        <div class="filters">
          <el-input
            v-model="query.sku"
            placeholder="SKU"
            clearable
            style="width: 200px"
            @keyup.enter="load"
            @clear="load"
          />
          <el-select v-model="query.warehouse_id" placeholder="仓库" clearable style="width: 180px" @change="load">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
          <el-button type="primary" @click="load">查询</el-button>
        </div>

        <el-table v-loading="loading" :data="rows" border stripe :row-class-name="rowClassName">
          <el-table-column label="SKU" min-width="140">
            <template #default="{ row }">{{ row.products?.sku }}</template>
          </el-table-column>
          <el-table-column label="商品名称" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.products?.name }}</template>
          </el-table-column>
          <el-table-column label="仓库" min-width="140">
            <template #default="{ row }">{{ row.warehouses?.name }}</template>
          </el-table-column>
          <el-table-column label="库存数量" width="150" align="right">
            <template #default="{ row }">
              <span :style="{ color: isLowStock(row) ? '#f56c6c' : undefined, fontWeight: isLowStock(row) ? 600 : undefined }">{{ row.quantity }}</span>
              <el-tag v-if="isLowStock(row)" type="danger" size="small" style="margin-left: 6px">低库存预警</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reserved_quantity" label="锁定数量" width="110" align="right" />
          <el-table-column prop="updated_at" label="更新时间" min-width="180">
            <template #default="{ row }">{{ formatDate(row.updated_at) }}</template>
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
      </el-tab-pane>

      <el-tab-pane label="库存流水" name="tx">
        <div class="filters">
          <el-input
            v-model="txQuery.sku"
            placeholder="SKU"
            clearable
            style="width: 200px"
            @keyup.enter="loadTx"
            @clear="loadTx"
          />
          <el-select v-model="txQuery.type" placeholder="类型" clearable style="width: 180px" @change="loadTx">
            <el-option v-for="(label, key) in typeLabels" :key="key" :label="label" :value="key" />
          </el-select>
          <el-button type="primary" @click="loadTx">查询</el-button>
        </div>

        <el-table v-loading="txLoading" :data="txRows" border stripe>
          <el-table-column label="SKU" min-width="140">
            <template #default="{ row }">{{ row.products?.sku }}</template>
          </el-table-column>
          <el-table-column label="商品名称" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.products?.name }}</template>
          </el-table-column>
          <el-table-column label="仓库" min-width="140">
            <template #default="{ row }">{{ row.warehouses?.name }}</template>
          </el-table-column>
          <el-table-column label="类型" width="130">
            <template #default="{ row }">
              <el-tag>{{ typeLabels[row.type] || row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="quantity" label="变动数量" width="110" align="right">
            <template #default="{ row }">
              <span :style="{ color: row.quantity >= 0 ? '#67c23a' : '#f56c6c' }">{{ row.quantity }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="before_quantity" label="变动前" width="100" align="right" />
          <el-table-column prop="after_quantity" label="变动后" width="100" align="right" />
          <el-table-column prop="note" label="备注" min-width="160" show-overflow-tooltip />
          <el-table-column prop="created_at" label="时间" min-width="180">
            <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
          </el-table-column>
        </el-table>

        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="txTotal"
          v-model:current-page="txQuery.page"
          v-model:page-size="txQuery.pageSize"
          :page-sizes="[20, 50, 100]"
          @current-change="loadTx"
          @size-change="onTxSizeChange"
        />
      </el-tab-pane>

      <el-tab-pane label="在途发货" name="intransit">
        <div class="filters">
          <el-input
            v-model="itQuery.tracking_no"
            placeholder="运单号"
            clearable
            style="width: 200px"
            @keyup.enter="loadInTransit"
            @clear="loadInTransit"
          />
          <el-button type="primary" @click="loadInTransit">查询</el-button>
        </div>

        <el-table v-loading="itLoading" :data="itRows" border stripe>
          <el-table-column prop="tracking_no" label="运单号" min-width="160" />
          <el-table-column label="货代" min-width="140">
            <template #default="{ row }">{{ row.forwarders?.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="货物状态" width="110">
            <template #default="{ row }">
              <el-tag :type="itCargoType(row.cargo_status)">{{ itCargoLabel(row.cargo_status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="carrier" label="承运商" min-width="130">
            <template #default="{ row }">{{ row.carrier || '-' }}</template>
          </el-table-column>
          <el-table-column label="预约时间" min-width="170">
            <template #default="{ row }">{{ row.appointment_time ? formatDate(row.appointment_time) : '-' }}</template>
          </el-table-column>
          <el-table-column prop="created_at" label="发货时间" min-width="170">
            <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openItDetail(row.id)">商品明细</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="itTotal"
          v-model:current-page="itQuery.page"
          v-model:page-size="itQuery.pageSize"
          :page-sizes="[20, 50, 100]"
          @current-change="loadInTransit"
          @size-change="onItSizeChange"
        />

        <el-dialog v-model="itDetailVisible" title="在途发货 - 商品明细" width="640px">
          <div v-if="itDetail" style="margin-bottom: 10px">
            <b>{{ itDetail.tracking_no }}</b>
            <span v-if="itDetail.forwarders?.name" style="margin-left: 10px; color: #909399">货代：{{ itDetail.forwarders.name }}</span>
          </div>
          <el-table v-if="itDetail" :data="itDetail.shipment_items || []" border stripe size="small" max-height="360">
            <el-table-column prop="product_id" label="商品ID" min-width="220" show-overflow-tooltip />
            <el-table-column prop="quantity" label="数量" width="100" align="right" />
            <el-table-column prop="sales_order_id" label="关联销售单ID" min-width="200" show-overflow-tooltip />
          </el-table>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="adjustVisible" title="调整库存" width="520px" destroy-on-close>
      <el-form :model="adjustForm" label-width="110px">
        <el-form-item label="商品" required>
          <el-select v-model="adjustForm.product_id" filterable placeholder="选择商品" style="width: 100%">
            <el-option v-for="p in products" :key="p.id" :label="`${p.sku} - ${p.name}`" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="adjustForm.warehouse_id" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="变动数量" required>
          <el-input-number v-model="adjustForm.quantity" :step="1" style="width: 100%" />
          <div class="form-tip">正数入库，负数出库/报损</div>
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="adjustForm.type" style="width: 100%">
            <el-option v-for="(label, key) in typeLabels" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="adjustForm.note" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitAdjust">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'
import { useAuthStore } from '../stores/auth'
import { exportTable, todayStr } from '../utils/export'
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum } from '../utils/import'

const auth = useAuthStore()
const canAdjust = computed(() => auth.hasPermission('inventory.adjust'))

const typeLabels: Record<string, string> = {
  purchase_in: '采购入库',
  sales_out: '销售出库',
  transfer_out: '调拨出库',
  transfer_in: '调拨入库',
  adjustment: '库存调整',
  after_sales_in: '售后退货入库',
  loss: '报损',
  other: '其他',
}

function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

const activeTab = ref('list')
const warehouses = ref<any[]>([])
const products = ref<any[]>([])

async function loadOptions() {
  try {
    const [whRes, prodRes] = await Promise.all([
      api.get('/warehouses'),
      api.get('/products', { params: { page: 1, pageSize: 200 } }),
    ])
    warehouses.value = (whRes.data.data ?? []).filter((w: any) => w.wh_type === 'domestic')
    products.value = prodRes.data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

function onTabChange(name: string | number) {
  if (name === 'tx') loadTx()
  if (name === 'intransit') loadInTransit()
}

// 在途发货
const itRows = ref<any[]>([])
const itTotal = ref(0)
const itLoading = ref(false)
const itQuery = reactive({ page: 1, pageSize: 20, tracking_no: '' })
const itDetailVisible = ref(false)
const itDetail = ref<any>(null)

const itCargoMap: Record<string, { label: string; type: string }> = {
  in_warehouse: { label: '已入仓', type: 'success' },
  transporting: { label: '运输中', type: 'warning' },
  arrived_port: { label: '已到港', type: 'primary' },
  cleared: { label: '已清关', type: 'info' },
}

function itCargoLabel(s: string) {
  return itCargoMap[s]?.label || s || '-'
}
function itCargoType(s: string) {
  return itCargoMap[s]?.type || 'info'
}

async function loadInTransit() {
  itLoading.value = true
  try {
    const { data } = await api.get('/shipments', { params: { ...itQuery, cargo_status: 'transporting' } })
    itRows.value = data.data ?? []
    itTotal.value = data.total ?? 0
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载在途发货失败')
  } finally {
    itLoading.value = false
  }
}

function onItSizeChange() {
  itQuery.page = 1
  loadInTransit()
}

async function openItDetail(id: string) {
  try {
    const { data } = await api.get(`/shipments/${id}`)
    itDetail.value = data.data
    itDetailVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载明细失败')
  }
}

// 库存列表
const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, sku: '', warehouse_id: '' })

// 低库存预警阈值（可配置常量）
const LOW_STOCK_THRESHOLD = 5
function isLowStock(row: any): boolean {
  return Number(row?.quantity) <= LOW_STOCK_THRESHOLD
}
function rowClassName({ row }: any): string {
  return isLowStock(row) ? 'low-stock-row' : ''
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/inventory', { params: query })
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

// 库存流水
const txRows = ref<any[]>([])
const txTotal = ref(0)
const txLoading = ref(false)
const txQuery = reactive({ page: 1, pageSize: 20, sku: '', type: '' })

async function loadTx() {
  txLoading.value = true
  try {
    const { data } = await api.get('/inventory/transactions', { params: txQuery })
    txRows.value = data.data ?? []
    txTotal.value = data.total ?? 0
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载流水失败')
  } finally {
    txLoading.value = false
  }
}

function onTxSizeChange() {
  txQuery.page = 1
  loadTx()
}

// 调整库存
const adjustVisible = ref(false)
const saving = ref(false)
const adjustForm = reactive({
  product_id: '',
  warehouse_id: '',
  quantity: 0,
  type: 'adjustment',
  note: '',
})

function openAdjust() {
  adjustForm.product_id = ''
  adjustForm.warehouse_id = ''
  adjustForm.quantity = 0
  adjustForm.type = 'adjustment'
  adjustForm.note = ''
  adjustVisible.value = true
}

async function submitAdjust() {
  if (!adjustForm.product_id || !adjustForm.warehouse_id) {
    ElMessage.warning('请选择商品和仓库')
    return
  }
  if (adjustForm.quantity === 0) {
    ElMessage.warning('变动数量不能为 0')
    return
  }
  saving.value = true
  try {
    await api.post('/inventory/adjust', adjustForm)
    ElMessage.success('调整成功')
    adjustVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '调整失败')
  } finally {
    saving.value = false
  }
}

const exporting = ref(false)
function exportRows() {
  const columns = [
    { key: 'sku', label: 'SKU', value: (r: any) => r.products?.sku ?? '' },
    { key: 'name', label: '商品名称', value: (r: any) => r.products?.name ?? '' },
    { key: 'warehouse', label: '仓库', value: (r: any) => r.warehouses?.name ?? '' },
    { key: 'quantity', label: '库存数量' },
    { key: 'reserved_quantity', label: '锁定数量' },
    { key: 'updated_at', label: '更新时间', value: (r: any) => formatDate(r.updated_at) },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `库存列表_${todayStr()}.xlsx`)
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

// 批量导入
const importing = ref(false)
const importFile = ref<any>(null)

function downloadTpl() {
  downloadTemplate(
    [
      { label: '商品SKU', sample: 'SKU-DLB-001' },
      { label: '仓库', sample: '默认仓库' },
      { label: '变动数量', sample: 10 },
      { label: '类型', sample: '采购入库' },
      { label: '备注', sample: '示例备注' },
    ],
    '库存导入模板',
    '库存批量导入模板.xlsx'
  )
}

function triggerImport() {
  importFile.value?.click()
}

const typeAliasMap: Record<string, string> = {
  采购入库: 'purchase_in',
  销售出库: 'sales_out',
  调拨出库: 'transfer_out',
  调拨入库: 'transfer_in',
  库存调整: 'adjustment',
  售后退货入库: 'after_sales_in',
  报损: 'loss',
  其他: 'other',
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
      sku: ['商品SKU', 'SKU', '产品编码', '编码', 'code', 'sku'],
      warehouse: ['仓库', '仓库名称', 'warehouse', 'warehouseName'],
      quantity: ['变动数量', '数量', 'quantity', 'qty'],
      type: ['类型', 'type'],
      note: ['备注', 'note', 'remark'],
    })
    if (col.sku === undefined || col.warehouse === undefined || col.quantity === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"商品SKU"、"仓库"和"变动数量"列')
      return
    }
    const skuMap: Record<string, any> = {}
    let page = 1
    for (;;) {
      const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
      ;(data.data ?? []).forEach((p: any) => {
        if (p.sku) skuMap[p.sku] = p
        if (p.code) skuMap[p.code] = p
      })
      if (page * 200 >= (data.total ?? 0)) break
      page++
    }
    const whNameMap: Record<string, any> = {}
    warehouses.value.forEach((w) => {
      whNameMap[w.name] = w
      whNameMap[w.id] = w
    })
    let ok = 0
    const errLines: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const lineNo = i + 2
      const sku = cellStr(row, col.sku)
      const whName = cellStr(row, col.warehouse)
      const qty = cellNum(row, col.quantity)
      if (!sku) {
        errLines.push(`第${lineNo}行：商品SKU为空`)
        continue
      }
      if (!whName) {
        errLines.push(`第${lineNo}行：仓库为空`)
        continue
      }
      if (qty === 0) {
        errLines.push(`第${lineNo}行：变动数量不能为 0`)
        continue
      }
      const product = skuMap[sku]
      if (!product) {
        errLines.push(`第${lineNo}行：SKU「${sku}」未匹配到商品`)
        continue
      }
      const wh = whNameMap[whName]
      if (!wh) {
        errLines.push(`第${lineNo}行：仓库「${whName}」未匹配到仓库`)
        continue
      }
      const typeVal = typeAliasMap[cellStr(row, col.type)] || cellStr(row, col.type) || 'adjustment'
      try {
        await api.post('/inventory/adjust', {
          product_id: product.id,
          warehouse_id: wh.id,
          quantity: qty,
          type: typeVal,
          note: col.note !== undefined ? cellStr(row, col.note) : '',
        })
        ok++
      } catch (err: any) {
        errLines.push(`第${lineNo}行：${err?.response?.data?.error?.message || '调整失败'}`)
      }
    }
    if (errLines.length) {
      ElMessage.warning(`成功 ${ok} 条，失败 ${errLines.length} 条：` + errLines.slice(0, 5).join('；') + (errLines.length > 5 ? ` 等 ${errLines.length} 条` : ''))
    } else {
      ElMessage.success(`成功导入 ${ok} 条`)
    }
    load()
  } catch (err: any) {
    ElMessage.error(err?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

onMounted(() => {
  load()
  loadOptions()
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
.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.low-stock-row {
  background: #fef0f0;
}
</style>
