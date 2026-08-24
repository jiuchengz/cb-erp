<template>
  <div class="page">
    <div class="page-header">
      <h2>回收站</h2>
      <div class="page-desc">被删除的商品与业务单据暂存于此，可恢复或彻底删除；彻底删除后不可恢复。</div>
    </div>

    <div class="filters">
      <el-select v-model="query.type" placeholder="全部类型" clearable style="width: 200px" @change="onTypeChange">
        <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-wrap">
      <el-table v-loading="loading" :data="rows" border stripe height="100%">
        <el-table-column label="类型" width="130">
          <template #default="{ row }">
            <el-tag :type="typeMap[row.type]?.tag || 'info'" size="small">{{ typeMap[row.type]?.label || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="标题 / 单号" min-width="240">
          <template #default="{ row }">
            <div>{{ row.title || '-' }}</div>
            <div v-if="row.code" class="code-text">{{ row.code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="120">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" size="small">{{ row.status || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="删除时间" min-width="180">
          <template #default="{ row }">{{ formatDateTime(row.deleted_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :loading="row._restoring" @click="restore(row)">恢复</el-button>
            <el-button link type="danger" :loading="row._purging" @click="purge(row)">彻底删除</el-button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../services/api'
import { formatDateTime } from '../utils/system'

interface RecycleItem {
  type: string
  id: string
  title?: string
  code?: string
  status?: string
  deleted_at?: string
  _restoring?: boolean
  _purging?: boolean
}

const typeOptions = [
  { label: '商品', value: 'product' },
  { label: '销售单', value: 'sales_order' },
  { label: '采购单', value: 'purchase_order' },
  { label: '发货单', value: 'shipment' },
  { label: '售后单', value: 'after_sale' },
  { label: '补货单', value: 'replenishment_order' }
]

const typeMap: Record<string, { label: string; tag: string }> = {
  product: { label: '商品', tag: 'primary' },
  sales_order: { label: '销售单', tag: 'success' },
  purchase_order: { label: '采购单', tag: 'warning' },
  shipment: { label: '发货单', tag: 'danger' },
  after_sale: { label: '售后单', tag: 'info' },
  replenishment_order: { label: '补货单', tag: 'warning' }
}

const statusTags: Record<string, string> = {
  draft: 'info',
  pending: 'warning',
  confirmed: 'primary',
  shipped: 'primary',
  completed: 'success',
  cancelled: 'danger',
  refunded: 'danger'
}

function statusTag(s?: string) {
  return statusTags[s || ''] || 'info'
}

const rows = ref<RecycleItem[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ type: '', page: 1, pageSize: 20 })

function onTypeChange() {
  query.page = 1
  load()
}

function onSizeChange() {
  query.page = 1
  load()
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, string | number> = { page: query.page, pageSize: query.pageSize }
    if (query.type) params.type = query.type
    const { data } = await api.get('/recycle-bin', { params })
    const body = data?.data || data || {}
    rows.value = (body.items || []).map((it: RecycleItem) => ({ ...it, _restoring: false, _purging: false }))
    total.value = body.total ?? rows.value.length
  } catch (e: any) {
    ElMessage.error(e?.message || '加载回收站失败')
  } finally {
    loading.value = false
  }
}

async function restore(row: RecycleItem) {
  row._restoring = true
  try {
    await api.post('/recycle-bin/restore', { type: row.type, id: row.id })
    ElMessage.success('已恢复')
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '恢复失败')
  } finally {
    row._restoring = false
  }
}

async function purge(row: RecycleItem) {
  try {
    await ElMessageBox.confirm('彻底删除后不可恢复，确认删除？', '彻底删除', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  row._purging = true
  try {
    await api.post('/recycle-bin/purge', { type: row.type, id: row.id })
    ElMessage.success('已彻底删除')
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '彻底删除失败')
  } finally {
    row._purging = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-desc {
  color: #909399;
  font-size: 13px;
}
.code-text {
  color: #909399;
  font-size: 12px;
}
</style>
