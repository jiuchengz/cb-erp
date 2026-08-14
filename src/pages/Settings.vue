<template>
  <div class="page">
    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="角色管理" name="roles">
        <div class="page-header">
          <h2>角色管理</h2>
          <el-button v-if="canManage" type="primary" @click="openRoleCreate">新增角色</el-button>
        </div>
        <el-table v-loading="rolesLoading" :data="roles" border stripe>
          <el-table-column prop="name" label="角色名" min-width="160" />
          <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
          <el-table-column label="权限数" width="100" align="right">
            <template #default="{ row }">{{ (row.permissions || []).length }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canManage && !row.is_system" link type="primary" @click="openRoleEdit(row)">编辑</el-button>
              <el-button v-if="canManage && !row.is_system" link type="danger" @click="removeRole(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="权限列表" name="permissions">
        <div class="page-header">
          <h2>权限列表</h2>
        </div>
        <el-table v-loading="permsLoading" :data="permissions" border stripe>
          <el-table-column prop="code" label="权限码" min-width="220" />
          <el-table-column prop="name" label="名称" min-width="160" />
          <el-table-column prop="description" label="描述" min-width="260" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="仓库管理" name="warehouses">
        <div class="page-header">
          <h2>仓库管理</h2>
          <el-button v-if="canManage" type="primary" @click="openWhCreate">新增仓库</el-button>
        </div>
        <el-table v-loading="whLoading" :data="warehouses" border stripe>
          <el-table-column prop="name" label="仓库名称" min-width="180" />
          <el-table-column prop="code" label="编码" min-width="120" />
          <el-table-column prop="address" label="地址" min-width="220" show-overflow-tooltip />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canManage" link type="primary" @click="openWhEdit(row)">编辑</el-button>
              <el-button v-if="canManage" link type="danger" @click="removeWh(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="审计日志" name="audit">
        <div class="filters">
          <el-input
            v-model="auditQuery.resource_type"
            placeholder="资源类型"
            clearable
            style="width: 160px"
            @keyup.enter="loadAudit"
            @clear="loadAudit"
          />
          <el-input
            v-model="auditQuery.action"
            placeholder="操作动作"
            clearable
            style="width: 160px"
            @keyup.enter="loadAudit"
            @clear="loadAudit"
          />
          <el-button type="primary" @click="loadAudit">查询</el-button>
        </div>
        <el-table v-loading="auditLoading" :data="auditRows" border stripe>
          <el-table-column prop="user_email" label="操作人" min-width="180" />
          <el-table-column prop="resource_type" label="资源类型" min-width="140" />
          <el-table-column prop="action" label="动作" min-width="120" />
          <el-table-column prop="detail" label="详情" min-width="260" show-overflow-tooltip />
          <el-table-column prop="ip" label="IP" min-width="130" />
          <el-table-column prop="created_at" label="时间" min-width="170">
            <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
          </el-table-column>
        </el-table>
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="auditTotal"
          v-model:current-page="auditQuery.page"
          v-model:page-size="auditQuery.pageSize"
          :page-sizes="[20, 50, 100]"
          @current-change="loadAudit"
          @size-change="onAuditSizeChange"
        />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="roleVisible" :title="roleEditing ? '编辑角色' : '新增角色'" width="560px" destroy-on-close>
      <el-form :model="roleForm" label-width="90px">
        <el-form-item label="角色名" required>
          <el-input v-model="roleForm.name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="roleForm.description" type="textarea" :rows="2" maxlength="256" />
        </el-form-item>
        <el-form-item label="权限">
          <el-select v-model="roleForm.permissions" multiple filterable placeholder="选择权限" style="width: 100%">
            <el-option v-for="p in permissions" :key="p.code" :label="`${p.code} - ${p.name}`" :value="p.code" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRole">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="whVisible" :title="whEditing ? '编辑仓库' : '新增仓库'" width="520px" destroy-on-close>
      <el-form :model="whForm" label-width="90px">
        <el-form-item label="仓库名称" required>
          <el-input v-model="whForm.name" />
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model="whForm.code" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="whForm.address" type="textarea" :rows="2" maxlength="256" />
        </el-form-item>
        <el-form-item v-if="whEditing" label="状态">
          <el-switch v-model="whForm.is_active" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="whVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveWh">保存</el-button>
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
const canManage = computed(() => auth.hasPermission('system.manage'))

function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

const activeTab = ref('roles')
function onTabChange(name: string | number) {
  if (name === 'permissions') loadPermissions()
  if (name === 'warehouses') loadWarehouses()
  if (name === 'audit') loadAudit()
}

// 角色
const roles = ref<any[]>([])
const rolesLoading = ref(false)
async function loadRoles() {
  rolesLoading.value = true
  try {
    const { data } = await api.get('/roles')
    roles.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载角色失败')
  } finally {
    rolesLoading.value = false
  }
}

// 权限
const permissions = ref<any[]>([])
const permsLoading = ref(false)
async function loadPermissions() {
  permsLoading.value = true
  try {
    const { data } = await api.get('/permissions')
    permissions.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载权限失败')
  } finally {
    permsLoading.value = false
  }
}

const roleVisible = ref(false)
const roleEditing = ref<any>(null)
const roleForm = reactive({
  name: '',
  description: '',
  permissions: [] as string[],
})

function openRoleCreate() {
  roleEditing.value = null
  roleForm.name = ''
  roleForm.description = ''
  roleForm.permissions = []
  roleVisible.value = true
  loadPermissions()
}

function openRoleEdit(row: any) {
  roleEditing.value = row
  roleForm.name = row.name
  roleForm.description = row.description || ''
  roleForm.permissions = (row.permissions || []).map((p: any) => (typeof p === 'string' ? p : p.code))
  roleVisible.value = true
  loadPermissions()
}

async function saveRole() {
  if (!roleForm.name.trim()) {
    ElMessage.warning('请填写角色名')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: roleForm.name,
      description: roleForm.description,
      permissions: roleForm.permissions,
    }
    if (roleEditing.value) {
      await api.patch(`/roles/${roleEditing.value.id}`, payload)
    } else {
      await api.post('/roles', payload)
    }
    ElMessage.success(roleEditing.value ? '更新成功' : '创建成功')
    roleVisible.value = false
    loadRoles()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function removeRole(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除角色 ${row.name} 吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/roles/${row.id}`)
    ElMessage.success('删除成功')
    loadRoles()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

// 仓库
const warehouses = ref<any[]>([])
const whLoading = ref(false)
async function loadWarehouses() {
  whLoading.value = true
  try {
    const { data } = await api.get('/warehouses')
    warehouses.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载仓库失败')
  } finally {
    whLoading.value = false
  }
}

const whVisible = ref(false)
const whEditing = ref<any>(null)
const whForm = reactive({
  name: '',
  code: '',
  address: '',
  is_active: true,
})

function openWhCreate() {
  whEditing.value = null
  whForm.name = ''
  whForm.code = ''
  whForm.address = ''
  whForm.is_active = true
  whVisible.value = true
}

function openWhEdit(row: any) {
  whEditing.value = row
  whForm.name = row.name
  whForm.code = row.code || ''
  whForm.address = row.address || ''
  whForm.is_active = row.is_active !== false
  whVisible.value = true
}

async function saveWh() {
  if (!whForm.name.trim()) {
    ElMessage.warning('请填写仓库名称')
    return
  }
  saving.value = true
  try {
    const payload: any = {
      name: whForm.name,
      code: whForm.code,
      address: whForm.address,
    }
    if (whEditing.value) {
      payload.is_active = whForm.is_active
      await api.patch(`/warehouses/${whEditing.value.id}`, payload)
    } else {
      await api.post('/warehouses', payload)
    }
    ElMessage.success(whEditing.value ? '更新成功' : '创建成功')
    whVisible.value = false
    loadWarehouses()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function removeWh(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除仓库 ${row.name} 吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/warehouses/${row.id}`)
    ElMessage.success('删除成功')
    loadWarehouses()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

// 审计日志
const auditRows = ref<any[]>([])
const auditTotal = ref(0)
const auditLoading = ref(false)
const auditQuery = reactive({ page: 1, pageSize: 20, resource_type: '', action: '' })

async function loadAudit() {
  auditLoading.value = true
  try {
    const { data } = await api.get('/audit-logs', { params: auditQuery })
    auditRows.value = data.data ?? []
    auditTotal.value = data.total ?? 0
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载审计日志失败')
  } finally {
    auditLoading.value = false
  }
}

function onAuditSizeChange() {
  auditQuery.page = 1
  loadAudit()
}

const saving = ref(false)

onMounted(() => {
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
