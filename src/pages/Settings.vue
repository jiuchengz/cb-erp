<template>
  <div class="page">
    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="界面外观" name="appearance">
        <div class="page-header">
          <h2>界面外观</h2>
        </div>
        <div class="appearance-card">
          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">玻璃透明度</div>
              <div class="appearance-desc">调节侧边栏、卡片、弹窗等毛玻璃面板的透明程度，数值越大越不透明</div>
            </div>
            <div class="appearance-control">
              <el-slider v-model="glassOpacity" :min="15" :max="75" :step="1" style="flex: 1" :format-tooltip="(v: number) => v + '%'" @input="applyOpacity" />
              <span class="opacity-value">{{ glassOpacity }}%</span>
            </div>
          </div>

          <el-divider />

          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">背景配色</div>
              <div class="appearance-desc">选择整体背景渐变与光斑配色方案</div>
            </div>
          </div>
          <div class="scheme-grid">
            <div
              v-for="s in schemes"
              :key="s.id"
              class="scheme-item"
              :class="{ active: activeScheme === s.id }"
              @click="applyScheme(s)"
            >
              <div class="scheme-preview" :style="{ background: s.preview }"></div>
              <span class="scheme-name">{{ s.label }}</span>
              <span v-if="activeScheme === s.id" class="scheme-check">✓</span>
            </div>
            <div
              class="scheme-item"
              :class="{ active: activeScheme === 'custom' }"
              @click="openCustom"
            >
              <div class="scheme-preview custom-preview" :style="{ background: customPreview }">
                <span class="custom-icon">🎨</span>
              </div>
              <span class="scheme-name">自定义配色</span>
              <span v-if="activeScheme === 'custom'" class="scheme-check">✓</span>
            </div>
          </div>

          <div v-if="activeScheme === 'custom'" class="custom-panel">
            <div class="custom-panel-title">自由搭配背景渐变</div>
            <div class="custom-row-flex">
              <span class="custom-label">背景渐变色</span>
              <el-color-picker
                v-for="(c, i) in customColors"
                :key="'c' + i"
                v-model="customColors[i]"
              />
              <el-button size="small" @click="randomCustom">随机搭配</el-button>
            </div>
            <div class="custom-row-flex">
              <span class="custom-label">光斑颜色</span>
              <el-color-picker v-model="customGlow[0]" />
              <el-color-picker v-model="customGlow[1]" />
            </div>
            <div class="custom-row-flex">
              <span class="custom-label">渐变方向</span>
              <el-select v-model="customAngle" size="small" style="width: 160px">
                <el-option
                  v-for="a in angleOptions"
                  :key="a.value"
                  :label="a.label"
                  :value="a.value"
                />
              </el-select>
              <el-button type="primary" size="small" @click="applyCustom">应用配色</el-button>
            </div>
          </div>

          <div class="appearance-row custom-row">
            <div class="appearance-info">
              <div class="appearance-title">自定义强调色</div>
              <div class="appearance-desc">调节按钮、选中态等强调色（点击色块取色）</div>
            </div>
            <el-color-picker v-model="accentColor" @change="applyAccent" />
          </div>

          <el-divider />

          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">深色模式</div>
              <div class="appearance-desc">切换深色界面，适合夜间使用</div>
            </div>
            <el-switch v-model="darkMode" @change="applyDarkMode" />
          </div>

          <el-divider />

          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">卡片圆角</div>
              <div class="appearance-desc">调节面板、卡片的圆角大小</div>
            </div>
            <div class="appearance-control">
              <el-slider v-model="cornerRadius" :min="16" :max="36" :step="1" style="flex: 1" :format-tooltip="(v: number) => v + 'px'" @input="applyCorner" />
              <span class="opacity-value">{{ cornerRadius }}px</span>
            </div>
          </div>

          <el-divider />

          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">背景光斑</div>
              <div class="appearance-desc">开启后背景显示柔和渐变光斑，可调节光斑浓度</div>
            </div>
            <el-switch v-model="glowEnabled" @change="applyGlow" />
          </div>
          <div class="appearance-row glow-row">
            <div class="appearance-info">
              <div class="appearance-desc">光斑强度</div>
            </div>
            <div class="appearance-control">
              <el-slider v-model="glowOpacity" :min="10" :max="80" :step="1" :disabled="!glowEnabled" style="flex: 1" :format-tooltip="(v: number) => v + '%'" @input="applyGlowOpacity" />
              <span class="opacity-value">{{ glowOpacity }}%</span>
            </div>
          </div>

          <el-divider />

          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">恢复默认</div>
              <div class="appearance-desc">将以上所有外观设置恢复为系统默认值</div>
            </div>
            <el-button @click="resetAppearance">恢复默认设置</el-button>
          </div>
        </div>
      </el-tab-pane>

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
          <el-table-column label="仓库类型" width="110">
            <template #default="{ row }">
              <el-tag :type="row.wh_type === 'overseas' ? 'warning' : 'primary'">{{ row.wh_type === 'overseas' ? '海外仓' : '国内仓库' }}</el-tag>
            </template>
          </el-table-column>
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

      <el-tab-pane label="数据库用量" name="usage">
        <div class="page-header">
          <h2>数据库用量</h2>
        </div>
        <div class="db-usage-card" v-loading="dbUsageLoading">
          <template v-if="dbUsage && dbUsage.ok">
            <div class="db-usage-head">
              <el-progress
                :percentage="Math.min(dbUsage.percent, 100)"
                :stroke-width="10"
                :show-text="false"
                style="flex: 1; max-width: 420px"
              />
              <span class="db-usage-percent">{{ dbUsage.percent }}%</span>
            </div>
            <div class="db-usage-text">
              数据库已用 {{ dbUsage.usedMB }} MB / {{ dbUsage.quotaMB }} MB，剩余 {{ dbUsage.freeMB }} MB
            </div>
          </template>
          <div v-else-if="dbUsage && dbUsage.ok === false" class="db-usage-warn">
            {{ dbUsage.message }}
          </div>
          <div v-else class="db-usage-warn">数据库用量加载失败</div>
        </div>
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
        <el-form-item label="仓库类型" required>
          <el-radio-group v-model="whForm.wh_type">
            <el-radio value="domestic">国内仓库</el-radio>
            <el-radio value="overseas">海外仓</el-radio>
          </el-radio-group>
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
  if (name === 'usage') loadDbUsage()
  if (name === 'audit') loadAudit()
}

/* ---------- 数据库用量 ---------- */
const dbUsage = ref<any>(null)
const dbUsageLoading = ref(false)

async function loadDbUsage() {
  dbUsageLoading.value = true
  try {
    const { data } = await api.get('/db-usage')
    dbUsage.value = data
  } catch (e: any) {
    dbUsage.value = { ok: false, message: e?.response?.data?.error?.message || '数据库用量加载失败' }
  } finally {
    dbUsageLoading.value = false
  }
}

/* ---------- 界面外观（玻璃透明度 / 背景配色 / 强调色 / 深色 / 圆角 / 光斑） ---------- */
const APPEARANCE_KEY = 'cb_appearance'
const DARK_KEY = 'cb_dark_mode'
const glassOpacity = ref(42)
const activeScheme = ref('aurora')
const accentColor = ref('#3b82f6')
const darkMode = ref(false)
const cornerRadius = ref(28)
const glowEnabled = ref(true)
const glowOpacity = ref(55)

interface AppearanceScheme {
  id: string
  label: string
  colors: string[]
  glow: string[]
  preview: string
  dark?: boolean
}

// 计算颜色相对亮度（0~1），用于判断背景是否偏暗
function colorLuminance(hex: string): number {
  try {
    let h = hex.trim().replace(/^#/, '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    if (h.length !== 6) return 0.5
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  } catch {
    return 0.5
  }
}

function colorsAreDark(colors: string[]): boolean {
  const valid = colors.filter(Boolean)
  if (!valid.length) return false
  const avg = valid.reduce((sum, c) => sum + colorLuminance(c), 0) / valid.length
  return avg < 0.34
}

// 根据背景亮度自动联动暗色模式：深色背景 → 浅色文字体系
function syncDarkByColors(colors: string[]) {
  const dark = colorsAreDark(colors)
  document.documentElement.classList.toggle('dark', dark)
  darkMode.value = dark
  try {
    if (dark) localStorage.setItem(DARK_KEY, '1')
    else localStorage.removeItem(DARK_KEY)
  } catch {
    /* ignore */
  }
}

const schemes: AppearanceScheme[] = [
  {
    id: 'aurora',
    label: '极光蓝紫',
    colors: ['#7dd3fc', '#c4b5fd', '#f9a8d4', '#fde68a'],
    glow: ['#f472b6', '#60a5fa'],
    preview: 'linear-gradient(135deg,#7dd3fc,#c4b5fd,#f9a8d4,#fde68a)',
  },
  {
    id: 'mint',
    label: '薄荷青绿',
    colors: ['#99f6e4', '#a5f3fc', '#bae6fd', '#d9f99d'],
    glow: ['#34d399', '#38bdf8'],
    preview: 'linear-gradient(135deg,#99f6e4,#a5f3fc,#bae6fd,#d9f99d)',
  },
  {
    id: 'sunset',
    label: '落日暖橙',
    colors: ['#fecaca', '#fed7aa', '#fde68a', '#fbcfe8'],
    glow: ['#f97316', '#f43f5e'],
    preview: 'linear-gradient(135deg,#fecaca,#fed7aa,#fde68a,#fbcfe8)',
  },
  {
    id: 'ocean',
    label: '深海静谧',
    colors: ['#bfdbfe', '#c7d2fe', '#e0e7ff', '#a5b4fc'],
    glow: ['#3b82f6', '#6366f1'],
    preview: 'linear-gradient(135deg,#bfdbfe,#c7d2fe,#e0e7ff,#a5b4fc)',
  },
  {
    id: 'mono',
    label: '云灰简约',
    colors: ['#e2e8f0', '#f1f5f9', '#cbd5e1', '#e2e8f0'],
    glow: ['#94a3b8', '#64748b'],
    preview: 'linear-gradient(135deg,#e2e8f0,#f1f5f9,#cbd5e1,#e2e8f0)',
  },
  {
    id: 'sci-fi',
    label: '高级科幻',
    colors: ['#050b1f', '#101d3d', '#0a1233', '#1a0f38'],
    glow: ['#00e5ff', '#9d4edd'],
    preview: 'linear-gradient(135deg,#050b1f,#101d3d,#0a1233,#1a0f38)',
    dark: true,
  },
]

function applyOpacity(v: number | number[]) {
  const val = typeof v === 'number' ? v : v[0] ?? 42
  glassOpacity.value = val
  document.documentElement.style.setProperty('--glass-alpha', String(val / 100))
  saveAppearance()
}

/* ---------- 自定义配色 ---------- */
const CUSTOM_KEY = 'cb_custom_scheme'
const customColors = ref<string[]>(['#7dd3fc', '#c4b5fd', '#f9a8d4', '#fde68a'])
const customGlow = ref<string[]>(['#f472b6', '#60a5fa'])
const customAngle = ref(135)
const angleOptions = [
  { value: 135, label: '135°（默认）' },
  { value: 45, label: '45°' },
  { value: 90, label: '90°' },
  { value: 0, label: '0°（水平）' },
  { value: 180, label: '180°' },
]
const customPreview = computed(
  () => `linear-gradient(${customAngle.value}deg, ${customColors.value.join(',')})`
)

function openCustom() {
  activeScheme.value = 'custom'
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (Array.isArray(saved.colors) && saved.colors.length >= 2) {
        customColors.value = [...saved.colors]
        while (customColors.value.length < 4) customColors.value.push('#f1f5f9')
        customColors.value = customColors.value.slice(0, 4)
      }
      if (Array.isArray(saved.glow) && saved.glow.length >= 2) {
        customGlow.value = [saved.glow[0], saved.glow[1]]
      }
      if (typeof saved.angle === 'number') customAngle.value = saved.angle
    }
  } catch {
    /* ignore */
  }
  applyCustom()
}

function applyCustom() {
  activeScheme.value = 'custom'
  const root = document.documentElement.style
  root.setProperty('--bg-c1', customColors.value[0])
  root.setProperty('--bg-c2', customColors.value[1] ?? customColors.value[0])
  root.setProperty('--bg-c3', customColors.value[2] ?? customColors.value[0])
  root.setProperty('--bg-c4', customColors.value[3] ?? customColors.value[0])
  root.setProperty('--glow-c1', customGlow.value[0])
  root.setProperty('--glow-c2', customGlow.value[1])
  root.setProperty('--bg-angle', customAngle.value + 'deg')
  syncDarkByColors(customColors.value)
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ colors: customColors.value, glow: customGlow.value, angle: customAngle.value }))
  } catch {
    /* ignore */
  }
  saveAppearance()
}

function randomColor(): string {
  const h = Math.floor(Math.random() * 360)
  const s = 55 + Math.floor(Math.random() * 25)
  const l = 65 + Math.floor(Math.random() * 20)
  return `hsl(${h},${s}%,${l}%)`
}

function randomCustom() {
  customColors.value = [randomColor(), randomColor(), randomColor(), randomColor()]
  customGlow.value = [
    `hsl(${Math.floor(Math.random() * 360)},80%,65%)`,
    `hsl(${Math.floor(Math.random() * 360)},80%,65%)`,
  ]
  customAngle.value = angleOptions[Math.floor(Math.random() * angleOptions.length)].value
}

function applyScheme(s: AppearanceScheme) {
  activeScheme.value = s.id
  const root = document.documentElement.style
  root.setProperty('--bg-c1', s.colors[0])
  root.setProperty('--bg-c2', s.colors[1])
  root.setProperty('--bg-c3', s.colors[2])
  root.setProperty('--bg-c4', s.colors[3])
  root.setProperty('--glow-c1', s.glow[0])
  root.setProperty('--glow-c2', s.glow[1])
  root.setProperty('--bg-angle', '135deg')
  syncDarkByColors(s.colors)
  saveAppearance()
}

function applyAccent(c: string | null) {
  if (!c) return
  accentColor.value = c
  document.documentElement.style.setProperty('--accent', c)
  document.documentElement.style.setProperty('--color-primary', c)
  saveAppearance()
}

function applyDarkMode(v: string | number | boolean) {
  const on = Boolean(v)
  darkMode.value = on
  const html = document.documentElement
  const root = html.style
  if (on) {
    html.classList.add('dark')
    // 手动开启深色模式：清除背景内联变量，回退到 html.dark 默认深色背景
    root.removeProperty('--bg-c1')
    root.removeProperty('--bg-c2')
    root.removeProperty('--bg-c3')
    root.removeProperty('--bg-c4')
    root.removeProperty('--glow-c1')
    root.removeProperty('--glow-c2')
    root.removeProperty('--bg-angle')
    try {
      localStorage.setItem(DARK_KEY, '1')
    } catch {
      /* ignore */
    }
  } else {
    html.classList.remove('dark')
    // 手动关闭深色模式：若当前方案是深色系，切回浅色默认方案，避免黑底黑字
    if (colorsAreDark(getCurrentSchemeColors())) {
      applyScheme(schemes[0])
      return
    }
    try {
      localStorage.removeItem(DARK_KEY)
    } catch {
      /* ignore */
    }
  }
  saveAppearance()
}

function getCurrentSchemeColors(): string[] {
  if (activeScheme.value === 'custom') return customColors.value
  const s = schemes.find((x) => x.id === activeScheme.value)
  return s ? s.colors : schemes[0].colors
}

function applyCorner(v: number | number[]) {
  const val = typeof v === 'number' ? v : v[0] ?? 28
  cornerRadius.value = val
  document.documentElement.style.setProperty('--radius-lg', val + 'px')
  saveAppearance()
}

function applyGlow(v: string | number | boolean) {
  const on = Boolean(v)
  glowEnabled.value = on
  document.documentElement.classList.toggle('no-glow', !on)
  saveAppearance()
}

function applyGlowOpacity(v: number | number[]) {
  const val = typeof v === 'number' ? v : v[0] ?? 55
  glowOpacity.value = val
  document.documentElement.style.setProperty('--glow-opacity', String(val / 100))
  saveAppearance()
}

function resetAppearance() {
  glassOpacity.value = 42
  activeScheme.value = 'aurora'
  accentColor.value = '#3b82f6'
  darkMode.value = false
  cornerRadius.value = 28
  glowEnabled.value = true
  glowOpacity.value = 55
  const root = document.documentElement
  const s = schemes[0]
  root.classList.remove('dark', 'no-glow')
  const st = root.style
  st.setProperty('--glass-alpha', '0.42')
  st.setProperty('--radius-lg', '28px')
  st.setProperty('--glow-opacity', '0.55')
  st.setProperty('--accent', '#3b82f6')
  st.setProperty('--color-primary', '#3b82f6')
  st.setProperty('--bg-c1', s.colors[0])
  st.setProperty('--bg-c2', s.colors[1])
  st.setProperty('--bg-c3', s.colors[2])
  st.setProperty('--bg-c4', s.colors[3])
  st.setProperty('--glow-c1', s.glow[0])
  st.setProperty('--glow-c2', s.glow[1])
  st.setProperty('--bg-angle', '135deg')
  try {
    localStorage.removeItem(APPEARANCE_KEY)
    localStorage.removeItem(DARK_KEY)
    localStorage.removeItem(CUSTOM_KEY)
  } catch {
    /* ignore */
  }
  ElMessage.success('已恢复默认外观')
}

function saveAppearance() {
  const isCustom = activeScheme.value === 'custom'
  const s = isCustom ? null : (schemes.find((x) => x.id === activeScheme.value) ?? schemes[0])
  try {
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({
        opacity: glassOpacity.value,
        scheme: isCustom ? 'custom' : s!.id,
        colors: isCustom ? customColors.value : s!.colors,
        glow: isCustom ? customGlow.value : s!.glow,
        angle: isCustom ? customAngle.value : 135,
        accent: accentColor.value,
        radius: cornerRadius.value,
        glowEnabled: glowEnabled.value,
        glowOpacity: glowOpacity.value,
      })
    )
  } catch {
    /* ignore */
  }
}

function loadAppearance() {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (typeof saved.opacity === 'number') {
      glassOpacity.value = saved.opacity
      document.documentElement.style.setProperty('--glass-alpha', String(saved.opacity / 100))
    }
    if (saved.scheme) {
      if (saved.scheme === 'custom' && Array.isArray(saved.colors) && saved.colors.length >= 2) {
        activeScheme.value = 'custom'
        customColors.value = [...saved.colors]
        while (customColors.value.length < 4) customColors.value.push('#f1f5f9')
        customColors.value = customColors.value.slice(0, 4)
        if (Array.isArray(saved.glow) && saved.glow.length >= 2) {
          customGlow.value = [saved.glow[0], saved.glow[1]]
        }
        if (typeof saved.angle === 'number') customAngle.value = saved.angle
        const root = document.documentElement.style
        root.setProperty('--bg-c1', customColors.value[0])
        root.setProperty('--bg-c2', customColors.value[1])
        root.setProperty('--bg-c3', customColors.value[2])
        root.setProperty('--bg-c4', customColors.value[3])
        root.setProperty('--glow-c1', customGlow.value[0])
        root.setProperty('--glow-c2', customGlow.value[1])
        root.setProperty('--bg-angle', customAngle.value + 'deg')
        syncDarkByColors(customColors.value)
      } else {
        const s = schemes.find((x) => x.id === saved.scheme)
        if (s) {
          activeScheme.value = s.id
          const root = document.documentElement.style
          root.setProperty('--bg-c1', s.colors[0])
          root.setProperty('--bg-c2', s.colors[1])
          root.setProperty('--bg-c3', s.colors[2])
          root.setProperty('--bg-c4', s.colors[3])
          root.setProperty('--glow-c1', s.glow[0])
          root.setProperty('--glow-c2', s.glow[1])
          root.setProperty('--bg-angle', '135deg')
          syncDarkByColors(s.colors)
        }
      }
    }
    if (typeof saved.accent === 'string' && saved.accent) {
      accentColor.value = saved.accent
      document.documentElement.style.setProperty('--accent', saved.accent)
      document.documentElement.style.setProperty('--color-primary', saved.accent)
    }
    if (typeof saved.radius === 'number') {
      cornerRadius.value = saved.radius
      document.documentElement.style.setProperty('--radius-lg', saved.radius + 'px')
    }
    if (typeof saved.glowEnabled === 'boolean') {
      glowEnabled.value = saved.glowEnabled
      document.documentElement.classList.toggle('no-glow', !saved.glowEnabled)
    }
    if (typeof saved.glowOpacity === 'number') {
      glowOpacity.value = saved.glowOpacity
      document.documentElement.style.setProperty('--glow-opacity', String(saved.glowOpacity / 100))
    }
  } catch {
    /* ignore */
  }
  try {
    darkMode.value = localStorage.getItem(DARK_KEY) === '1'
    if (darkMode.value) {
      // 手动深色偏好优先：加 dark 并回退到默认深色背景，避免浅背景+浅文字
      document.documentElement.classList.add('dark')
      const root = document.documentElement.style
      root.removeProperty('--bg-c1')
      root.removeProperty('--bg-c2')
      root.removeProperty('--bg-c3')
      root.removeProperty('--bg-c4')
      root.removeProperty('--glow-c1')
      root.removeProperty('--glow-c2')
      root.removeProperty('--bg-angle')
    } else {
      document.documentElement.classList.remove('dark')
    }
  } catch {
    /* ignore */
  }
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
  wh_type: 'domestic',
})

function openWhCreate() {
  whEditing.value = null
  whForm.name = ''
  whForm.code = ''
  whForm.address = ''
  whForm.is_active = true
  whForm.wh_type = 'domestic'
  whVisible.value = true
}

function openWhEdit(row: any) {
  whEditing.value = row
  whForm.name = row.name
  whForm.code = row.code || ''
  whForm.address = row.address || ''
  whForm.is_active = row.is_active !== false
  whForm.wh_type = row.wh_type === 'overseas' ? 'overseas' : 'domestic'
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
      wh_type: whForm.wh_type,
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
  loadAppearance()
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

/* 界面外观 */
.appearance-card {
  max-width: 760px;
  padding: 26px;
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  border: none;
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight);
  border-radius: var(--radius-lg);
}
.appearance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.appearance-info {
  flex-shrink: 0;
}
.appearance-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}
.appearance-desc {
  font-size: 12px;
  color: var(--ink-3);
  margin-top: 4px;
  max-width: 420px;
}
.appearance-control {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 280px;
}
.opacity-value {
  width: 48px;
  text-align: right;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.scheme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 14px;
  margin-top: 4px;
}
.scheme-item {
  position: relative;
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: rgba(255, 255, 255, 0.35);
}
.scheme-item:hover {
  transform: translateY(-2px);
}
.scheme-item.active {
  border-color: var(--accent);
  box-shadow: 0 8px 24px rgba(70, 90, 160, 0.15);
}
.scheme-preview {
  height: 56px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.6);
}
.scheme-name {
  display: block;
  text-align: center;
  font-size: 13px;
  color: var(--ink-2);
  margin-top: 8px;
}
.scheme-check {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.custom-row {
  margin-top: 22px;
}
.custom-preview {
  position: relative;
}
.custom-icon {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 22px;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
}
.custom-panel {
  margin-top: 16px;
  padding: 16px 18px;
  background: rgba(255, 255, 255, 0.35);
  border: 1px dashed rgba(120, 130, 180, 0.4);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.custom-panel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.custom-row-flex {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.custom-label {
  font-size: 13px;
  color: var(--ink-2);
  width: 96px;
  flex-shrink: 0;
}
.glow-row {
  margin-top: 14px;
}
.db-usage-card {
  max-width: 760px;
  padding: 22px 24px;
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  border: none;
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight);
  border-radius: var(--radius-lg);
}
.db-usage-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.db-usage-percent {
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  min-width: 52px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.db-usage-text {
  margin-top: 12px;
  font-size: 13px;
  color: var(--ink-2);
}
.db-usage-warn {
  font-size: 13px;
  color: #e5484d;
}
</style>
