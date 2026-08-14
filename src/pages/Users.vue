<template>
  <div class="page">
    <div class="page-header">
      <h2>用户管理</h2>
      <el-button v-if="canWrite" type="primary" @click="openCreate">新增用户</el-button>
    </div>

    <div class="filters">
      <el-input
        v-model="query.email"
        placeholder="邮箱"
        clearable
        style="width: 240px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="email" label="邮箱" min-width="200" />
      <el-table-column prop="name" label="姓名" min-width="140" />
      <el-table-column label="角色" min-width="200">
        <template #default="{ row }">
          <el-tag v-for="r in row.roles" :key="r.id" size="small" style="margin-right: 4px">{{ r.name }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '启用' : '禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="170">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canWrite" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="canDelete && !row.is_super_admin" link type="danger" @click="remove(row)">删除</el-button>
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

    <el-dialog v-model="formVisible" :title="editing ? '编辑用户' : '新增用户'" width="520px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-form-item label="邮箱" required>
          <el-input v-model="form.email" :disabled="!!editing" placeholder="user@example.com" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item v-if="!editing" label="密码" required>
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role_ids" multiple placeholder="选择角色" style="width: 100%">
            <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../services/api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('users.write'))
const canDelete = computed(() => auth.hasPermission('users.delete'))

function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, email: '' })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/users', { params: query })
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

const roles = ref<any[]>([])
async function loadRoles() {
  try {
    const { data } = await api.get('/roles')
    roles.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载角色失败')
  }
}

const formVisible = ref(false)
const saving = ref(false)
const editing = ref<any>(null)
const form = reactive({
  email: '',
  name: '',
  password: '',
  role_ids: [] as string[],
})

function openCreate() {
  editing.value = null
  form.email = ''
  form.name = ''
  form.password = ''
  form.role_ids = []
  formVisible.value = true
}

function openEdit(row: any) {
  editing.value = row
  form.email = row.email
  form.name = row.name || ''
  form.password = ''
  form.role_ids = (row.roles || []).map((r: any) => r.id)
  formVisible.value = true
}

async function save() {
  if (!form.email.trim() || !form.name.trim()) {
    ElMessage.warning('请填写邮箱和姓名')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await api.patch(`/users/${editing.value.id}`, {
        name: form.name,
        role_ids: form.role_ids,
      })
    } else {
      if (!form.password) {
        ElMessage.warning('请填写密码')
        return
      }
      await api.post('/users', {
        email: form.email,
        name: form.name,
        password: form.password,
        role_ids: form.role_ids,
      })
    }
    ElMessage.success(editing.value ? '更新成功' : '创建成功')
    formVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除用户 ${row.email} 吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/users/${row.id}`)
    ElMessage.success('删除成功')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

onMounted(() => {
  load()
  loadRoles()
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
</style>
