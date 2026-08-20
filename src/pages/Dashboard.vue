<template>
  <div class="page">
    <div class="page-header">
      <h2>首页</h2>
      <span class="page-tip">数据统计</span>
    </div>

    <el-row :gutter="16" v-loading="loading">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="8" :md="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">{{ card.label }}</div>
          <div class="stat-value">{{ card.value }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="recent-card">
      <template #header>
        <div class="card-header">
          <span>最近发货动态</span>
          <el-button link type="primary" @click="load">刷新</el-button>
        </div>
      </template>
      <el-table v-loading="loading" :data="recentShipments" border stripe empty-text="暂无发货记录">
        <el-table-column prop="tracking_no" label="运单号" min-width="180" />
        <el-table-column label="货代" width="120">
          <template #default="{ row }">{{ row.forwarders?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="空海运" width="100">
          <template #default="{ row }">{{ row.shipping_mode || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓号" width="100">
          <template #default="{ row }">{{ row.warehouse_no || '-' }}</template>
        </el-table-column>
        <el-table-column label="发货数量" width="110">
          <template #default="{ row }">{{ row.shipping_qty ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="货物状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.cargo_status" :style="{ backgroundColor: cargoStatusColors[row.cargo_status] || undefined }" :type="cargoStatusColors[row.cargo_status] ? '' : 'info'">
              {{ row.cargo_status }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" min-width="180">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <div class="stat-note">统计口径：新版暂无仓库类型（国内/海外）与在途字段，国内库存按全部库存合计，海外/在途为 0。</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'

const loading = ref(false)
const stats = ref<any>({
  products_count: 0,
  domestic_stock: 0,
  overseas_stock: 0,
  in_transit_stock: 0,
  shipments_count: 0,
  sales_count: 0,
  after_sales_count: 0,
  recent_shipments: [],
})

// 货物状态固定颜色映射（与发货模块 cargo_statuses 字典解耦，无匹配 fallback info 灰 #909399）
const cargoStatusColors: Record<string, string> = {
  转运中: '#17A2B8',
  到港: '#F0AD4E',
  清关: '#6F42C1',
  已预约: '#007BFF',
  已入仓: '#28A745',
}

const statCards = computed(() => [
  { label: '商品总数', value: stats.value.products_count ?? 0 },
  { label: '国内库存', value: stats.value.domestic_stock ?? 0 },
  { label: '海外库存', value: stats.value.overseas_stock ?? 0 },
  { label: '在途库存', value: stats.value.in_transit_stock ?? 0 },
  { label: '发货记录', value: stats.value.shipments_count ?? 0 },
  { label: '销售订单', value: stats.value.sales_count ?? 0 },
  { label: '售后工单', value: stats.value.after_sales_count ?? 0 },
])

const recentShipments = computed(() => stats.value.recent_shipments || [])

function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/dashboard/stats')
    stats.value = data.data ?? stats.value
  } catch (e: any) {
    // 首次失败自动重试一次（应对后端偶发瞬时错误，如 Supabase 查询抖动误报 403）
    try {
      await new Promise((r) => setTimeout(r, 1500))
      const { data: retryData } = await api.get('/dashboard/stats')
      stats.value = retryData.data ?? stats.value
      return
    } catch (e2: any) {
      ElMessage.error(e2?.response?.data?.error?.message || '加载统计失败')
      return
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
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
.page-tip {
  font-size: 13px;
  color: #909399;
}
.stat-card {
  margin-bottom: 16px;
  text-align: center;
}
.stat-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}
.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}
.recent-card {
  margin-top: 8px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.stat-note {
  margin-top: 12px;
  font-size: 12px;
  color: #909399;
}
</style>
