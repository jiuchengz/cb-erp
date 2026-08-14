<template>
  <div class="page">
    <div class="page-header">
      <h2>商品管理</h2>
      <el-button v-if="canWrite" type="primary" @click="openCreate">新增商品</el-button>
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

    <el-table v-loading="loading" :data="rows" border stripe>
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

    <el-dialog v-model="dialogVisible" title="新增商品" width="720px" destroy-on-close>
      <el-form :model="form" label-width="110px">
        <el-form-item label="SKU" required>
          <el-input v-model="form.sku" placeholder="唯一编码" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" />
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
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'
import { useAuthStore } from '../stores/auth'
import type { Product } from '../types'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('products.write'))

const rows = ref<Product[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, search: '', status: '' })

function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
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
const form = reactive({
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
})

function openCreate() {
  Object.assign(form, {
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
  })
  dialogVisible.value = true
}

async function save() {
  if (!form.sku.trim() || !form.name.trim()) {
    ElMessage.warning('请填写 SKU 和名称')
    return
  }
  saving.value = true
  try {
    await api.post('/products', form)
    ElMessage.success('创建成功')
    dialogVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
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
</style>
