<template>
  <div class="page product-total-page">
    <div class="page-header">
      <h2>商品总表</h2>
      <span class="page-sub">一货一行 · 总仓 / 子仓 / 海外仓库存合计</span>
    </div>

    <div class="toolbar">
      <el-input
        v-model="search"
        placeholder="搜索产品编号或名称"
        clearable
        class="toolbar-search"
        @keyup.enter="onSearch"
        @clear="onSearch"
      />
      <el-button type="primary" @click="onSearch">查询</el-button>
      <el-button @click="onReset">重置</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" stripe class="table-main">
      <el-table-column prop="code" label="产品编号" min-width="150" show-overflow-tooltip />
      <el-table-column label="图片" width="72" align="center">
        <template #default="{ row }">
          <el-image
            v-if="row.image_url"
            :src="row.image_url"
            fit="cover"
            class="prod-img"
            :preview-src-list="[row.image_url]"
            preview-teleported
          />
          <span v-else class="img-placeholder">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="unit" label="单位" width="90" align="center" />
      <el-table-column prop="head_stock" label="总仓库存" width="120" align="right" sortable :sort-method="(a: any, b: any) => sortNum(a, b, 'head_stock')" />
      <el-table-column prop="sub_stock" label="子仓合计" width="120" align="right" sortable :sort-method="(a: any, b: any) => sortNum(a, b, 'sub_stock')" />
      <el-table-column prop="overseas_stock" label="海外仓合计" width="120" align="right" sortable :sort-method="(a: any, b: any) => sortNum(a, b, 'overseas_stock')" />
    </el-table>

    <div class="pager-wrap">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="load"
        @size-change="onSizeChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/services/api'

const search = ref('')
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/product-total', {
      params: { search: search.value || undefined, page: page.value, pageSize: pageSize.value }
    })
    rows.value = data.data ?? []
    total.value = data.total ?? 0
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '加载失败'
    const { ElMessage } = await import('element-plus')
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  load()
}

function onReset() {
  search.value = ''
  page.value = 1
  load()
}

function onSizeChange() {
  page.value = 1
  load()
}

function sortNum(a: any, b: any, col: string) {
  return Number(a[col] || 0) - Number(b[col] || 0)
}

function debounceLoad() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
}

onMounted(load)
</script>

<style scoped>
.product-total-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.page-header h2 {
  margin: 0;
  font-size: 20px;
}
.page-sub {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.toolbar-search {
  width: 320px;
}
.prod-img {
  width: 42px;
  height: 42px;
  border-radius: 6px;
  display: inline-block;
  vertical-align: middle;
}
.img-placeholder {
  color: var(--el-text-color-placeholder);
}
.pager-wrap {
  display: flex;
  justify-content: flex-end;
}
</style>
