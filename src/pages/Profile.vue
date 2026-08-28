<template>
  <div class="page profile-page">
    <div class="page-header">
      <h2>个人中心</h2>
    </div>
    <div class="profile-grid">
      <!-- 左侧：头像 -->
      <div class="avatar-card glass-card">
        <div class="avatar-section">
          <div class="avatar-preview">
            <img v-if="avatarPreview" :src="avatarPreview" class="avatar-preview-img" alt="头像预览" />
            <span v-else class="avatar-fallback">{{ initial }}</span>
          </div>
          <div class="avatar-tip">头像将显示在右上角个人菜单中</div>

          <div v-if="avatarDirty" class="avatar-edit-wrap">
            <div class="logo-edit" @pointerdown="onEditPointerDown" @pointermove="onEditPointerMove" @pointerup="onEditPointerUp" @pointercancel="onEditPointerUp">
              <img :src="avatarPreview" :style="editStyle" class="logo-edit-img" draggable="false" />
            </div>
            <div class="logo-edit-tools">
              <span class="logo-edit-label">大小</span>
              <el-slider v-model="editScale" :min="50" :max="300" :step="5" class="logo-edit-slider" />
              <span class="logo-edit-val">{{ editScale }}%</span>
            </div>
            <div class="logo-edit-hint">拖动图片调整位置，拖动滑块调整大小</div>
          </div>

          <div class="avatar-actions">
            <input ref="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" class="hidden-input" @change="onAvatarFile" />
            <el-button type="primary" :disabled="saving" @click="chooseAvatar">选择图片</el-button>
            <el-button :disabled="!avatarDirty" :loading="saving" @click="saveAvatar">保存头像</el-button>
            <el-button v-if="avatarDirty" :disabled="saving" @click="cancelEdit">取消调整</el-button>
            <el-button v-if="hasAvatar && !avatarDirty" :disabled="saving" @click="clearAvatar">清除头像</el-button>
          </div>
        </div>
      </div>

      <!-- 右侧：基本信息 -->
      <div class="info-card glass-card">
        <div class="info-section">
          <h3>基本信息</h3>
          <el-form :model="form" label-width="90px" size="default">
            <el-form-item label="姓名">
              <el-input v-model="form.name" placeholder="请输入姓名" maxlength="100" />
            </el-form-item>
            <el-form-item label="邮箱">
              <el-input :model-value="email" disabled />
            </el-form-item>
            <el-form-item label="角色">
              <div class="role-tags">
                <el-tag v-for="r in auth.roles" :key="r" size="small" style="margin-right: 6px">{{ roleLabel(r) }}</el-tag>
                <span v-if="!auth.roles.length" class="empty-tip">未分配角色</span>
              </div>
            </el-form-item>
            <el-form-item label="创建时间">
              <span class="readonly-text">{{ createdText }}</span>
            </el-form-item>
            <el-form-item label="账号状态">
              <el-tag v-if="isActive" type="success" size="small">启用</el-tag>
              <el-tag v-else type="danger" size="small">停用</el-tag>
            </el-form-item>
          </el-form>
          <div class="info-actions">
            <el-button type="primary" :loading="saving" @click="saveProfile">保存信息</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/services/api'
import { formatDateTime } from '@/utils/system'

const auth = useAuthStore()

/* ---------- 基本信息 ---------- */
const form = reactive({ name: '' })

const email = computed(() => auth.profile?.email || auth.user?.email || '')
const createdText = computed(() => (auth.profile?.created_at ? formatDateTime(auth.profile.created_at) : '—'))
const isActive = computed(() => auth.profile?.is_active ?? true)
const initial = computed(() => (auth.profile?.display_name || auth.user?.email || '?').trim().charAt(0).toUpperCase())

function roleLabel(code: string) {
  const map: Record<string, string> = {
    super_admin: '超级管理员',
    admin: '管理员',
    manager: '经理',
    operator: '操作员'
  }
  return map[code] || code
}

/* ---------- 头像：与系统设置-网站图标一致（选择 -> 裁剪 -> dataURL 保存） ---------- */
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarPreview = ref<string | null>(null)
const avatarDirty = ref(false)
const saving = ref(false)
const EDIT_SIZE = 128
const editImg = ref<HTMLImageElement | null>(null)
const editScale = ref(100)
const editOffset = ref({ x: 0, y: 0 })
const dragState = ref<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

const hasAvatar = computed(() => !!avatarPreview.value)

const editStyle = computed(() => {
  const img = editImg.value
  if (!img) return {}
  const w = img.naturalWidth || 100
  const h = img.naturalHeight || 100
  const scale0 = Math.min(EDIT_SIZE / w, EDIT_SIZE / h)
  const s = scale0 * (editScale.value / 100)
  return {
    width: Math.round(w * s) + 'px',
    height: Math.round(h * s) + 'px',
    transform: `translate(calc(-50% + ${editOffset.value.x}px), calc(-50% + ${editOffset.value.y}px))`,
  }
})

function chooseAvatar() {
  avatarInput.value?.click()
}
function loadEditImage(src: string) {
  editImg.value = null
  editScale.value = 100
  editOffset.value = { x: 0, y: 0 }
  const img = new Image()
  img.onload = () => {
    if (img.naturalWidth && img.naturalHeight) editImg.value = img
  }
  img.onerror = () => {
    ElMessage.warning('该图片格式无法预览编辑，将按原图保存')
  }
  img.src = src
}
function onEditPointerDown(e: PointerEvent) {
  dragState.value = { sx: e.clientX, sy: e.clientY, ox: editOffset.value.x, oy: editOffset.value.y }
  ;(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId)
}
function onEditPointerMove(e: PointerEvent) {
  if (!dragState.value) return
  editOffset.value = {
    x: dragState.value.ox + (e.clientX - dragState.value.sx),
    y: dragState.value.oy + (e.clientY - dragState.value.sy),
  }
}
function onEditPointerUp() {
  dragState.value = null
}
function renderEdited(): string {
  const fallback = avatarPreview.value || ''
  const img = editImg.value
  if (!img) return fallback
  const w = img.naturalWidth || 100
  const h = img.naturalHeight || 100
  const scale0 = Math.min(EDIT_SIZE / w, EDIT_SIZE / h)
  const s = scale0 * (editScale.value / 100)
  const canvas = document.createElement('canvas')
  canvas.width = EDIT_SIZE
  canvas.height = EDIT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return fallback
  ctx.save()
  ctx.translate(EDIT_SIZE / 2 + editOffset.value.x, EDIT_SIZE / 2 + editOffset.value.y)
  ctx.scale(s, s)
  ctx.drawImage(img, -w / 2, -h / 2)
  ctx.restore()
  return canvas.toDataURL('image/png')
}
function cancelEdit() {
  avatarPreview.value = auth.profile?.avatar_url || null
  avatarDirty.value = false
  editImg.value = null
  editScale.value = 100
  editOffset.value = { x: 0, y: 0 }
}
function onAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const okType = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
  if (!okType) {
    ElMessage.error('仅支持 PNG/JPG/WebP 格式')
    input.value = ''
    return
  }
  if (file.size > 1024 * 1024) {
    ElMessage.error('图片不能超过 1MB')
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const src = reader.result as string
    avatarPreview.value = src
    avatarDirty.value = true
    loadEditImage(src)
  }
  reader.readAsDataURL(file)
  input.value = ''
}
async function saveAvatar() {
  if (!avatarDirty.value || !avatarPreview.value) return
  saving.value = true
  try {
    await api.patch('/auth/profile', { avatar: renderEdited() })
    auth.applyProfile({ avatar: renderEdited() })
    avatarDirty.value = false
    editImg.value = null
    editScale.value = 100
    editOffset.value = { x: 0, y: 0 }
    ElMessage.success('头像已保存')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '头像保存失败')
  } finally {
    saving.value = false
  }
}
async function clearAvatar() {
  saving.value = true
  try {
    await api.patch('/auth/profile', { avatar: '' })
    auth.applyProfile({ avatar: null })
    avatarPreview.value = null
    avatarDirty.value = false
    editImg.value = null
    editScale.value = 100
    editOffset.value = { x: 0, y: 0 }
    ElMessage.success('已清除头像')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

/* ---------- 保存基本信息 ---------- */
async function saveProfile() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入姓名')
    return
  }
  saving.value = true
  try {
    await api.patch('/auth/profile', { name: form.name.trim() })
    auth.applyProfile({ name: form.name.trim() })
    ElMessage.success('基本信息已保存')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  form.name = auth.profile?.display_name || auth.user?.user_metadata?.name || ''
  avatarPreview.value = auth.profile?.avatar_url || auth.user?.user_metadata?.avatar || null
})
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 18px; }
.page-header h2 { margin: 0; font-size: 20px; font-weight: 700; color: var(--ink); }

.profile-grid { display: grid; grid-template-columns: 340px 1fr; gap: 18px; align-items: start; }
.glass-card { background: var(--glass-bg); -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%); backdrop-filter: blur(var(--glass-blur)) saturate(180%); border: none; box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight); border-radius: var(--radius-lg); padding: 24px; }

.avatar-section { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.avatar-preview { width: 120px; height: 120px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: linear-gradient(135deg, #38bdf8, #818cf8); box-shadow: 0 12px 28px rgba(99,102,241,.35); flex-shrink: 0; }
.avatar-preview-img { width: 100%; height: 100%; object-fit: cover; }
.avatar-fallback { color: #fff; font-size: 44px; font-weight: 800; }
.avatar-tip { font-size: 12px; color: var(--ink-3); }

.avatar-edit-wrap { width: 100%; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.logo-edit { position: relative; width: 160px; height: 160px; overflow: hidden; border-radius: 16px; background: rgba(15,23,42,.06); cursor: grab; touch-action: none; user-select: none; }
html.dark .logo-edit { background: rgba(255,255,255,.06); }
.logo-edit:active { cursor: grabbing; }
.logo-edit-img { position: absolute; top: 50%; left: 50%; max-width: none; }
.logo-edit-tools { display: flex; align-items: center; gap: 10px; width: 100%; }
.logo-edit-label { font-size: 12px; color: var(--ink-2); flex-shrink: 0; }
.logo-edit-slider { flex: 1; }
.logo-edit-val { font-size: 12px; color: var(--ink-2); min-width: 38px; text-align: right; flex-shrink: 0; }
.logo-edit-hint { font-size: 12px; color: var(--ink-3); }

.avatar-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.hidden-input { display: none; }

.info-section h3 { margin: 0 0 18px; font-size: 16px; font-weight: 700; color: var(--ink); }
.role-tags { display: flex; align-items: center; flex-wrap: wrap; min-height: 28px; }
.empty-tip { font-size: 13px; color: var(--ink-3); }
.readonly-text { font-size: 14px; color: var(--ink-2); }
.info-actions { margin-top: 8px; display: flex; justify-content: flex-end; }

@media (max-width: 900px) {
  .profile-grid { grid-template-columns: 1fr; }
}
</style>
