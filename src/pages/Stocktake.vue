<template>
  <div class="page">
    <div class="page-header">
      <h2>库存盘点</h2>
      <div>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新建盘点单</el-button>
      </div>
    </div>

    <div class="filters">
      <el-input v-model="query.stocktake_no" placeholder="盘点单号" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
      <el-select v-model="query.warehouse_id" placeholder="仓库" clearable style="width: 180px" @change="load">
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 140px" @change="load">
        <el-option label="草稿" value="DRAFT" />
        <el-option label="盘点中" value="IN_PROGRESS" />
        <el-option label="已完成" value="COMPLETED" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-wrap">
      <el-table v-loading="loading" :data="rows" border stripe height="100%">
        <el-table-column prop="stocktake_no" label="盘点单号" min-width="170" show-overflow-tooltip />
        <el-table-column prop="warehouse_name" label="仓库" min-width="140" show-overflow-tooltip />
        <el-table-column label="盘点日期" width="120">
          <template #default="{ row }">{{ row.stocktake_date || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="item_count" label="明细数" width="90" align="right" />
        <el-table-column label="差异合计" width="110" align="right">
          <template #default="{ row }">
            <span :class="diffClass(row.total_difference)">{{ fmtDiff(row.total_difference) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
        <el-table-column label="更新时间" width="160">
          <template #default="{ row }">{{ formatDate(row.updated_at || row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <template v-if="canWrite && row.status !== 'COMPLETED'">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="success" @click="audit(row)">审核</el-button>
              <el-button link type="danger" @click="remove(row)">删除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        layout="total, sizes, prev, pager, next"
        :total="total"
        :page-size="query.pageSize"
        :current-page="query.page"
        :page-sizes="[10, 20, 50, 100]"
        @size-change="onSizeChange"
        @current-change="(p: number) => { query.page = p; load() }"
      />
    </div>

    <!-- 新建：先选仓库/日期/备注 -->
    <el-dialog v-model="createVisible" title="新建盘点单" width="480px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="仓库" required>
          <el-select v-model="createForm.warehouse_id" placeholder="请选择盘点仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="盘点日期">
          <el-date-picker v-model="createForm.stocktake_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="默认今天" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.remark" type="textarea" :rows="2" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">创建并录入</el-button>
      </template>
    </el-dialog>

    <!-- 编辑/详情：主信息 + 明细 -->
    <el-dialog
      v-model="editVisible"
      :title="detailMode ? '盘点单详情' : (editRow.status === 'DRAFT' ? '编辑盘点单' : '录入实盘数量')"
      width="860px"
      destroy-on-close
    >
      <div class="st-meta">
        <el-tag :type="statusType(editRow.status)" effect="plain">{{ statusLabel(editRow.status) }}</el-tag>
        <span>单号：{{ editRow.stocktake_no }}</span>
        <span>仓库：{{ editRow.warehouse_name }}</span>
        <span>盘点日期：{{ editRow.stocktake_date || '-' }}</span>
        <span v-if="editRow.remark">备注：{{ editRow.remark }}</span>
      </div>

      <el-table v-loading="saving" :data="editRow.items" border stripe max-height="420">
        <el-table-column label="商品编码" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ productCodeOf(row.product_id) }}</template>
        </el-table-column>
        <el-table-column label="商品名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ productNameOf(row.product_id) }}</template>
        </el-table-column>
        <el-table-column prop="book_quantity" label="账面数量" width="100" align="right">
          <template #default="{ row }">{{ fmtQty(row.book_quantity) }}</template>
        </el-table-column>
        <el-table-column label="实盘数量" width="130" align="right">
          <template #default="{ row }">
            <el-input-number
              v-if="!detailMode && editRow.status !== 'COMPLETED'"
              v-model="row.actual_quantity"
              :min="0"
              :controls="false"
              style="width: 100%"
            />
            <span v-else>{{ fmtQty(row.actual_quantity) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="差异" width="100" align="right">
          <template #default="{ row }">
            <span :class="diffClass(row.difference)">{{ fmtDiff(row.difference) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="140">
          <template #default="{ row }">
            <el-input v-if="!detailMode && editRow.status !== 'COMPLETED'" v-model="row.remark" placeholder="可选" />
            <span v-else>{{ row.remark || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!detailMode && editRow.status !== 'COMPLETED'" label="操作" width="70" fixed="right">
          <template #default="{ $index }">
            <el-button link type="danger" @click="editRow.items.splice($index, 1)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!detailMode && editRow.status !== 'COMPLETED'" class="st-actions">
        <el-button type="primary" plain @click="pickerVisible = true">添加商品</el-button>
        <span class="st-tip">差异 = 实盘 - 账面，审核时将按差异自动修正系统库存</span>
      </div>

      <template #footer>
        <el-button @click="editVisible = false">关闭</el-button>
        <el-button v-if="!detailMode && canWrite && editRow.status !== 'COMPLETED'" type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 商品选择 -->
    <el-dialog v-model="pickerVisible" title="选择商品" width="760px" destroy-on-close>
      <div class="filters">
        <el-input v-model="pickerQuery" placeholder="搜索编码 / SKU / 名称" clearable style="width: 240px" @keyup.enter="applyPicker" @clear="applyPicker" />
        <el-button type="primary" @click="applyPicker">搜索</el-button>
        <span class="st-tip">共 {{ pickerTotal }} 个商品，勾选后点击添加</span>
      </div>
      <el-table
        v-loading="pickerLoading"
        :data="pickerRows"
        border
        stripe
        height="380"
        @selection-change="(v: any[]) => (pickerSelection = v)"
      >
        <el-table-column type="selection" width="46" :selectable="(row: any) => !editRow.items.some((it: any) => it.product_id === row.id)" />
        <el-table-column label="编码" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ productCode(row) }}</template>
        </el-table-column>
        <el-table-column label="名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name }}</template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="80" />
        <el-table-column label="当前库存" width="110" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="addProduct(row)">已选，点击添加</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          layout="total, prev, pager, next"
          :total="pickerTotal"
          :page-size="pickerPageSize"
          :current-page="pickerPage"
          @current-change="(p: number) => { pickerPage = p; loadPicker() }"
        />
      </div>
      <template #footer>
        <el-button @click="pickerVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!pickerSelection.length" @click="addSelected">添加所选 ({{ pickerSelection.length }})</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../services/api'
import { formatDateTime } from '../utils/system'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('inventory.adjust'))

function formatDate(v: string) {
  return formatDateTime(v)
}
function fmtQty(v: any) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
function fmtDiff(v: any) {
  const n = Number(v || 0)
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2)
  return n > 0 ? `+${s}` : s
}
function diffClass(v: any) {
  const n = Number(v || 0)
  return n > 0 ? 'diff-pos' : n < 0 ? 'diff-neg' : 'diff-zero'
}
function statusLabel(s: string) {
  return { DRAFT: '草稿', IN_PROGRESS: '盘点中', COMPLETED: '已完成' }[s] || s
}
function statusType(s: string): any {
  return { DRAFT: 'info', IN_PROGRESS: 'warning', COMPLETED: 'success' }[s] || 'info'
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, stocktake_no: '', warehouse_id: '', status: '' })

async function load() {
  loading.value = true
  try {
    const params: any = { page: query.page, pageSize: query.pageSize }
    if (query.stocktake_no.trim()) params.stocktake_no = query.stocktake_no.trim()
    if (query.warehouse_id) params.warehouse_id = query.warehouse_id
    if (query.status) params.status = query.status
    const { data } = await api.get('/stocktakes', { params })
    rows.value = data.data ?? []
    total.value = data.total ?? 0
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function onSizeChange(size: number) {
  query.pageSize = size
  query.page = 1
  load()
}

const warehouses = ref<any[]>([])
const products = ref<any[]>([])

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

function productCode(p: any) {
  return p.code || p.sku || p.id
}
function productCodeOf(pid: string) {
  const p = products.value.find((x) => x.id === pid)
  return p ? productCode(p) : pid
}
function productNameOf(pid: string) {
  const p = products.value.find((x) => x.id === pid)
  return p ? p.name : '-'
}

// ---- 新建 ----
const createVisible = ref(false)
const saving = ref(false)
const createForm = reactive({ warehouse_id: '', stocktake_date: '', remark: '' })

function openCreate() {
  createForm.warehouse_id = ''
  createForm.stocktake_date = new Date().toISOString().slice(0, 10)
  createForm.remark = ''
  createVisible.value = true
}

async function submitCreate() {
  if (!createForm.warehouse_id) {
    ElMessage.warning('请选择盘点仓库')
    return
  }
  saving.value = true
  try {
    const { data } = await api.post('/stocktakes', {
      warehouse_id: createForm.warehouse_id,
      stocktake_date: createForm.stocktake_date || null,
      remark: createForm.remark || null,
    })
    createVisible.value = false
    await load()
    const row = rows.value.find((r) => r.id === data.data?.id)
    if (row) openEdit(row)
    else ElMessage.success('盘点单已创建')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

// ---- 编辑 / 详情 ----
const editVisible = ref(false)
const detailMode = ref(false)
const editRow = ref<any>({ status: 'DRAFT', items: [] })

async function loadDetail(id: string) {
  const { data } = await api.get(`/stocktakes/${id}`)
  return data.data
}

async function openEdit(row: any) {
  detailMode.value = false
  editVisible.value = true
  editRow.value = { ...row, items: [] }
  try {
    editRow.value = await loadDetail(row.id)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载详情失败')
  }
}

async function openDetail(row: any) {
  detailMode.value = true
  editVisible.value = true
  editRow.value = { ...row, items: [] }
  try {
    editRow.value = await loadDetail(row.id)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载详情失败')
  }
}

async function saveEdit() {
  if (!editRow.value.items.length) {
    ElMessage.warning('请至少添加一个盘点商品')
    return
  }
  const dup = new Set(editRow.value.items.map((it: any) => it.product_id))
  if (dup.size !== editRow.value.items.length) {
    ElMessage.warning('存在重复商品，请移除后保存')
    return
  }
  saving.value = true
  try {
    await api.patch(`/stocktakes/${editRow.value.id}`, {
      warehouse_id: editRow.value.warehouse_id,
      stocktake_date: editRow.value.stocktake_date || null,
      remark: editRow.value.remark || null,
      status: editRow.value.status === 'DRAFT' ? 'IN_PROGRESS' : editRow.value.status,
      items: editRow.value.items.map((it: any) => ({
        product_id: it.product_id,
        actual_quantity: Number(it.actual_quantity || 0),
        remark: it.remark || null,
      })),
    })
    ElMessage.success('已保存')
    editVisible.value = false
    await load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// ---- 审核 ----
async function audit(row: any) {
  try {
    await ElMessageBox.confirm(
      `审核后将按「实盘 - 账面」差异自动修正系统库存并写入流水，且不可重复审核。确认审核盘点单 ${row.stocktake_no} 吗？`,
      '审核确认',
      { type: 'warning', confirmButtonText: '确认审核', cancelButtonText: '取消' }
    )
    saving.value = true
    const { data } = await api.post(`/stocktakes/${row.id}/audit`)
    const diff = Number(data.total_difference || 0)
    ElMessage.success(`审核完成，库存差异合计 ${fmtDiff(diff)}`)
    await load()
  } catch (e: any) {
    if (e === 'cancel' || e?.message === 'cancel') return
    ElMessage.error(e?.response?.data?.error?.message || '审核失败')
  } finally {
    saving.value = false
  }
}

// ---- 删除 ----
async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除盘点单 ${row.stocktake_no} 吗？`, '删除确认', { type: 'warning' })
    await api.delete(`/stocktakes/${row.id}`)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e === 'cancel' || e?.message === 'cancel') return
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

// ---- 商品选择 ----
const pickerVisible = ref(false)
const pickerQuery = ref('')
const pickerLoading = ref(false)
const pickerRows = ref<any[]>([])
const pickerTotal = ref(0)
const pickerPage = ref(1)
const pickerPageSize = 10
const pickerSelection = ref<any[]>([])

async function loadPicker() {
  pickerLoading.value = true
  try {
    const params: any = { page: pickerPage.value, pageSize: pickerPageSize }
    if (pickerQuery.value.trim()) params.search = pickerQuery.value.trim()
    const { data } = await api.get('/products', { params })
    pickerRows.value = data.data ?? []
    pickerTotal.value = data.total ?? 0
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载商品失败')
  } finally {
    pickerLoading.value = false
  }
}

function applyPicker() {
  pickerPage.value = 1
  loadPicker()
}

function openPicker() {
  pickerVisible.value = true
  pickerQuery.value = ''
  pickerSelection.value = []
  pickerPage.value = 1
  loadPicker()
}

function addProduct(row: any) {
  if (editRow.value.items.some((it: any) => it.product_id === row.id)) return
  editRow.value.items.push({
    product_id: row.id,
    book_quantity: 0,
    actual_quantity: 0,
    difference: 0,
    remark: '',
  })
  // 从后端取账面数量
  api.get('/inventory', { params: { product_id: row.id, warehouse_id: editRow.value.warehouse_id } }).then(({ data }) => {
    const inv = (data.data ?? [])[0]
    if (inv) {
      const it = editRow.value.items.find((x: any) => x.product_id === row.id)
      if (it) {
        it.book_quantity = Number(inv.quantity || 0)
        it.difference = Number(it.actual_quantity || 0) - it.book_quantity
      }
    }
  })
}

function addSelected() {
  for (const row of pickerSelection.value) addProduct(row)
  pickerSelection.value = []
  ElMessage.success('已添加所选商品')
}

onMounted(async () => {
  load()
  try {
    const [whRes, prods] = await Promise.all([api.get('/warehouses'), loadAllProducts()])
    warehouses.value = whRes.data.data ?? []
    products.value = prods
  } catch (e) {
    ElMessage.error('加载基础数据失败')
  }
})
</script>

<style scoped>
.st-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #606266;
}
.st-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.st-tip {
  font-size: 12px;
  color: #909399;
}
.diff-pos {
  color: #e6a23c;
  font-weight: 600;
}
.diff-neg {
  color: #f56c6c;
  font-weight: 600;
}
.diff-zero {
  color: #909399;
}
</style>
