<template>
  <div class="page">
    <div class="page-header">
      <h2>库存管理</h2>
      <el-button v-if="canAdjust" type="primary" @click="openAdjust">调整库存</el-button>
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

        <el-table v-loading="loading" :data="rows" border stripe>
          <el-table-column label="SKU" min-width="140">
            <template #default="{ row }">{{ row.products?.sku }}</template>
          </el-table-column>
          <el-table-column label="商品名称" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.products?.name }}</template>
          </el-table-column>
          <el-table-column label="仓库" min-width="140">
            <template #default="{ row }">{{ row.warehouses?.name }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="库存数量" width="110" align="right" />
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
    warehouses.value = whRes.data.data ?? []
    products.value = prodRes.data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

function onTabChange(name: string | number) {
  if (name === 'tx') loadTx()
}

// 库存列表
const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, sku: '', warehouse_id: '' })

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
</style>
