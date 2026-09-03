<template>
  <div class="page">
    <el-tabs v-model="activeTab" @tab-change="onTabChange">
            <el-tab-pane v-if="tabVisible('backup')" label="数据备份" name="backup">
        <div class="page-header">
          <h2>数据备份</h2>
        </div>
        <div class="appearance-card">
          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">一键导出全部核心数据</div>
              <div class="appearance-desc">导出商品、库存、流水、订单、盘点等核心表为 JSON 文件，可用于本地归档或迁移备份</div>
            </div>
            <el-button type="primary" :loading="backupLoading" @click="doBackup">立即导出</el-button>
          </div>
          <div v-if="backupResult" class="backup-result">
            <div>备份时间：{{ formatDate(backupResult.generated_at) }}</div>
            <div>包含 {{ backupResult.tables.length }} 张表：{{ backupResult.tables.join('、') }}</div>
          </div>
        </div>
      </el-tab-pane>
            <el-tab-pane v-if="tabVisible('logo')" label="网站图标" name="logo">
        <div class="page-header">
          <h2>网站图标</h2>
        </div>
        <div class="appearance-card">
          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">浏览器标签页 / 侧边栏 / 登录页图标</div>
              <div class="appearance-desc">上传后系统全局生效：浏览器标签页 favicon、侧边栏品牌图标、登录页标题图标；支持 PNG/JPG/WebP/SVG/ICO，大小不超过 1MB</div>
            </div>
            <div class="logo-preview">
              <img v-if="logoPreview || site.logo" :src="logoPreview || site.logo || ''" class="logo-preview-img" alt="网站图标预览" />
              <div v-else class="logo-preview-empty">默认图标</div>
            </div>
          </div>
          <div v-if="logoDirty" class="logo-edit-wrap">
            <div class="logo-edit" @pointerdown="onEditPointerDown" @pointermove="onEditPointerMove" @pointerup="onEditPointerUp" @pointercancel="onEditPointerUp">
              <img :src="logoPreview || ''" :style="editStyle" class="logo-edit-img" draggable="false" />
            </div>
            <div class="logo-edit-tools">
              <span class="logo-edit-label">大小</span>
              <el-slider v-model="editScale" :min="50" :max="300" :step="5" class="logo-edit-slider" />
              <span class="logo-edit-val">{{ editScale }}%</span>
            </div>
            <div class="logo-edit-hint">拖动图片调整位置，拖动滑块调整大小，保存后全局生效</div>
          </div>
          <div v-if="canManage" class="appearance-row logo-actions">
            <input ref="logoInput" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon" class="hidden-input" @change="onLogoFile" />
            <el-button type="primary" :disabled="logoSaving" @click="chooseLogo">选择图片</el-button>
            <el-button :disabled="!logoDirty" :loading="logoSaving" @click="saveLogo">保存</el-button>
            <el-button v-if="logoDirty" :disabled="logoSaving" @click="cancelEdit">取消调整</el-button>
            <el-button v-if="site.logo && !logoDirty" :disabled="logoSaving" @click="clearLogo">恢复默认</el-button>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="tabVisible('system')" label="系统设置" name="system">
        <div class="page-header">
          <h2>系统设置</h2>
          <el-button v-if="canManage" type="primary" :loading="sysSaving" @click="saveSystemSettings">保存设置</el-button>
        </div>
        <div class="appearance-card">
          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">默认时区</div>
              <div class="appearance-desc">全系统时间、日期、统计均按此默认时区显示；当前默认：墨西哥城 (UTC-6)</div>
            </div>
            <div class="appearance-control">
              <el-select v-model="sysForm.default_timezone" filterable placeholder="选择默认时区" style="width: 280px">
                <el-option v-for="tz in timezoneOptions" :key="tz.tz" :label="tz.label + '（' + tz.country + '）'" :value="tz.tz">
                  <span>{{ tz.label }}</span>&nbsp;
                  <span style="color: #999">{{ tz.country }}</span>
                </el-option>
              </el-select>
            </div>
          </div>

          <el-divider />

          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">默认币种</div>
              <div class="appearance-desc">全系统金额显示与新增单据的默认币种；当前默认：MXN（墨西哥比索）</div>
            </div>
            <div class="appearance-control">
              <el-select v-model="sysForm.default_currency" filterable placeholder="选择默认币种" style="width: 280px">
                <el-option v-for="cur in currencyOptions" :key="cur.code" :label="cur.code + '（' + cur.name + '）'" :value="cur.code">
                  <span>{{ cur.code }}</span>&nbsp;
                  <span style="color: #999">{{ cur.name }}</span>
                </el-option>
              </el-select>
            </div>
          </div>

          <el-divider />

          <div class="appearance-row">
            <div class="appearance-info">
              <div class="appearance-title">回收站（软删除）</div>
              <div class="appearance-desc">开启后，商品、单据等删除操作将先进入回收站，可恢复，降低误删风险</div>
            </div>
            <div class="appearance-control">
              <el-switch v-model="sysForm.soft_delete_enabled" active-text="开启" inactive-text="关闭" />
            </div>
          </div>
        </div>
      </el-tab-pane>

<el-tab-pane v-if="tabVisible('appearance')" label="界面外观" name="appearance">
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

      <el-tab-pane v-if="tabVisible('roles')" label="角色管理" name="roles">
        <div class="page-header">
          <h2>角色管理</h2>
          <el-button v-if="canManage" type="primary" @click="openRoleCreate">新增角色</el-button>
        </div>
        <el-table :resizable="false" v-loading="rolesLoading" :data="roles" border stripe>
          <el-table-column label="角色名" min-width="180">
            <template #default="{ row }">
              <span>{{ row.name }}</span>
              <el-tag v-if="row.is_system" size="small" type="info" style="margin-left: 6px">内置</el-tag>
            </template>
          </el-table-column>
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

      <el-tab-pane v-if="tabVisible('permissions')" label="权限列表" name="permissions">
        <div class="page-header">
          <h2>权限列表</h2>
        </div>
        <el-table :resizable="false" v-loading="permsLoading" :data="permissions" border stripe>
          <el-table-column prop="code" label="权限码" min-width="240" />
          <el-table-column prop="description" label="权限名称（中文）" min-width="320" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>

      <el-tab-pane v-if="tabVisible('warehouses')" label="仓库管理" name="warehouses">
        <div class="page-header">
          <h2>仓库管理</h2>
          <el-button v-if="canWhWrite" type="primary" @click="openWhCreate">新增仓库</el-button>
        </div>
        <el-table :resizable="false" v-loading="whLoading" :data="warehouses" border stripe>
          <el-table-column prop="name" label="仓库名称" min-width="180" />
          <el-table-column prop="code" label="编码" min-width="120" />
          <el-table-column label="仓库类型" width="110">
            <template #default="{ row }">
              <el-tag :type="row.wh_type === 'overseas' ? 'warning' : 'primary'">{{ row.wh_type === 'overseas' ? '海外仓' : '国内仓库' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="仓库层级" width="100">
            <template #default="{ row }">
              <el-tag :type="whKindTag(row).type">{{ whKindTag(row).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="address" label="地址" min-width="220" show-overflow-tooltip />
          <el-table-column label="店铺" min-width="120">
            <template #default="{ row }">
              <span>{{ row.store || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canWhWrite" link type="primary" @click="openWhEdit(row)">编辑</el-button>
              <el-button v-if="canWhWrite" link type="danger" @click="removeWh(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane v-if="tabVisible('usage')" label="数据库用量" name="usage">
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

      <el-tab-pane v-if="tabVisible('audit')" label="审计日志" name="audit">
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
        <el-table :resizable="false" v-loading="auditLoading" :data="auditRows" border stripe>
          <el-table-column prop="user_email" label="操作人" min-width="180" />
          <el-table-column prop="resource_type" label="资源类型" min-width="140" />
          <el-table-column prop="action" label="动作" min-width="120" />
          <el-table-column prop="detail" label="详情" min-width="260" show-overflow-tooltip />
          <el-table-column prop="ip" label="IP" min-width="130" />
          <el-table-column prop="created_at" label="时间" min-width="170">
            <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
          </el-table-column>
        </el-table>
        <div class="pagination-bar">
          <span class="pagination-total">当前页共 {{ auditRows.length }} 条</span>
          <el-pagination
            background
            layout="total, prev, pager, next"
            :total="auditTotal"
            v-model:current-page="auditQuery.page"
            :page-size="auditQuery.pageSize"
            @current-change="loadAudit"
          />
          <el-select v-model="auditQuery.pageSize" class="page-size-select" @change="onAuditSizeChange">
            <el-option label="100条/页" :value="100" />
            <el-option label="200条/页" :value="200" />
            <el-option label="500条/页" :value="500" />
          </el-select>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="roleVisible" :title="roleEditing ? '编辑角色' : '新增角色'" width="720px" destroy-on-close>
      <el-form :model="roleForm" label-width="90px">
        <el-form-item label="角色名" required>
          <el-input v-model="roleForm.name" placeholder="如：运营专员" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="roleForm.description" type="textarea" :rows="2" maxlength="256" />
        </el-form-item>
        <el-form-item label="模块权限">
          <div class="perm-panel">
            <div v-for="grp in permissionGroups" :key="grp.key" class="perm-group">
              <div class="perm-group-head">
                <span class="perm-group-name">{{ grp.label }}</span>
                <el-checkbox :model-value="isModuleAllChecked(grp)" @change="(v: boolean | string | number) => toggleModule(grp.key, !!v)">全选</el-checkbox>
              </div>
              <div class="perm-items">
                <el-checkbox-group v-model="roleForm.permissions" class="perm-checkbox-group">
                  <el-checkbox
                    v-for="p in grp.items"
                    :key="p.code"
                    :label="p.code"
                    class="perm-item"
                  >
                    <span class="perm-item-name">{{ p.description || p.code }}</span>
                    <code class="perm-item-code">{{ p.code }}</code>
                  </el-checkbox>
                </el-checkbox-group>
              </div>
            </div>
            <el-empty v-if="!permissionGroups.length" description="暂无权限数据" :image-size="60" />
            <div class="form-tip">按模块勾选该角色可查看的功能；仓库范围请在「用户管理」中为账号单独绑定</div>
          </div>
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
          <el-radio-group v-model="whForm.wh_type" @change="onWhTypeChange">
            <el-radio value="domestic">国内仓库</el-radio>
            <el-radio value="overseas">海外仓</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="仓库层级" required>
          <el-select v-model="whForm.warehouse_kind" placeholder="选择仓库层级" style="width: 100%" @change="onWhKindChange">
            <el-option label="总仓（head）" value="head" />
            <el-option label="子仓（sub）" value="sub" />
            <el-option label="海外仓（overseas）" value="overseas" />
          </el-select>
          <div class="form-tip">总仓=head（国内总仓，总仓账号可查看全仓数据）；子仓=sub（国内子仓）；海外仓=overseas。总仓/子仓归属国内仓库，海外仓归属海外仓库，保存时自动同步。</div>
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="whForm.address" type="textarea" :rows="2" maxlength="256" />
        </el-form-item>
        <el-form-item label="店铺">
          <el-input v-model="whForm.store" placeholder="填写该仓库对应的店铺名（用于调拨发货/物流模块按店铺区分），可留空" maxlength="100" />
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
import { formatDateTime as sysFormatDateTime, setSystemSettings, DEFAULT_CURRENCIES, fetchExchangeRates } from '../utils/system'
import { useAuthStore } from '../stores/auth'
import { useSiteStore } from '../stores/site'

const auth = useAuthStore()
const site = useSiteStore()
const canManage = computed(() => auth.hasPermission('system.manage'))
// 系统设置页内按权限显隐：canUser 覆盖 角色/权限 标签，canWh 覆盖 仓库管理 标签
const canUser = computed(() => auth.hasPermission('user.read'))
const canWh = computed(() => auth.hasPermission('inventory.read'))
const canWhWrite = computed(() => auth.hasPermission('inventory.write'))

function formatDate(v: string) {
  return sysFormatDateTime(v)
}

// 顶部标签权限映射：system.manage 类（系统设置/备份/图标/界面外观/用量/审计）、user.read 类（角色/权限）、inventory.read 类（仓库）
const TAB_ORDER = ['system', 'backup', 'logo', 'appearance', 'roles', 'permissions', 'warehouses', 'usage', 'audit']
function tabVisible(name: string): boolean {
  switch (name) {
    case 'system':
    case 'backup':
    case 'logo':
    case 'appearance':
    case 'usage':
    case 'audit':
      return auth.hasPermission('system.manage')
    case 'roles':
    case 'permissions':
      return canUser.value
    case 'warehouses':
      return canWh.value
    default:
      return true
  }
}
function defaultTab(): string {
  return TAB_ORDER.find((n) => tabVisible(n)) || 'system'
}

const activeTab = ref(defaultTab())
const backupLoading = ref(false)
const backupResult = ref<any>(null)

// ===== 网站图标 =====
const logoInput = ref<HTMLInputElement | null>(null)
const logoPreview = ref<string | null>(null)
const logoDirty = ref(false)
const logoSaving = ref(false)
const EDIT_SIZE = 128
const editImg = ref<HTMLImageElement | null>(null)
const editScale = ref(100)
const editOffset = ref({ x: 0, y: 0 })
const dragState = ref<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
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
function chooseLogo() {
  logoInput.value?.click()
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
  const fallback = logoPreview.value || ''
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
  logoPreview.value = null
  logoDirty.value = false
  editImg.value = null
  editScale.value = 100
  editOffset.value = { x: 0, y: 0 }
}
function onLogoFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const okType = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(file.type)
  if (!okType) {
    ElMessage.error('仅支持 PNG/JPG/WebP/SVG/ICO 格式')
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
    logoPreview.value = src
    logoDirty.value = true
    loadEditImage(src)
  }
  reader.readAsDataURL(file)
  input.value = ''
}
async function saveLogo() {
  if (!logoPreview.value) return
  logoSaving.value = true
  try {
    await site.saveLogo(renderEdited())
    ElMessage.success('网站图标已保存')
    logoDirty.value = false
    logoPreview.value = null
    editImg.value = null
    editScale.value = 100
    editOffset.value = { x: 0, y: 0 }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    logoSaving.value = false
  }
}
async function clearLogo() {
  logoSaving.value = true
  try {
    await site.saveLogo(null)
    logoPreview.value = null
    logoDirty.value = false
    editImg.value = null
    editScale.value = 100
    editOffset.value = { x: 0, y: 0 }
    ElMessage.success('已恢复默认图标')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '操作失败')
  } finally {
    logoSaving.value = false
  }
}

async function doBackup() {
  backupLoading.value = true
  try {
    const { data } = await api.get('/system/backup')
    const payload = data.data
    backupResult.value = payload
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cb-erp-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`备份完成，共 ${payload.table_count} 张表`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '备份导出失败')
  } finally {
    backupLoading.value = false
  }
}
function onTabChange(name: string | number) {
  if (name === 'permissions' && canUser.value) loadPermissions()
  if (name === 'warehouses' && canWh.value) loadWarehouses()
  if (name === 'usage' && canManage.value) loadDbUsage()
  if (name === 'audit' && canManage.value) loadAudit()
  if (name === 'system' && canManage.value) loadSystemSettings()
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

/* ---------- 系统设置（默认时区 / 默认币种 / 回收站） ---------- */
const timezoneOptions = ref<any[]>([])
const currencyOptions = ref<any[]>([])
const sysForm = reactive({
  default_timezone: 'America/Mexico_City',
  default_currency: 'MXN',
  soft_delete_enabled: false,
})
const sysSaving = ref(false)

async function loadSystemSettings() {
  try {
    const { data } = await api.get('/system-settings')
    const d = data?.data || {}
    timezoneOptions.value = d.timezones || []
    currencyOptions.value = d.currencies || []
    const settings = d.settings || {}
    const tz = settings.default_timezone
    const cur = settings.default_currency
    if (tz?.tz) sysForm.default_timezone = tz.tz
    if (cur?.code) sysForm.default_currency = cur.code
    if (settings.soft_delete_enabled) sysForm.soft_delete_enabled = !!settings.soft_delete_enabled?.enabled
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '系统设置加载失败')
  }
}

async function saveSystemSettings() {
  if (!canManage.value) return
  sysSaving.value = true
  try {
    const { data } = await api.put('/system-settings', {
      default_timezone: sysForm.default_timezone,
      default_currency: sysForm.default_currency,
      soft_delete_enabled: sysForm.soft_delete_enabled,
    })
    const d = data?.data || {}
    const settings = d.settings || {}
    const tz = settings.default_timezone
    const cur = settings.default_currency
    if (tz?.tz) sysForm.default_timezone = tz.tz
    if (cur?.code) sysForm.default_currency = cur.code
    const currency = DEFAULT_CURRENCIES.find((c) => c.code === (cur?.code || ''))
    setSystemSettings(tz?.tz || '', cur?.code || '', currency?.symbol || '')
    fetchExchangeRates() // 保存币种后立即拉取实时汇率，保证页面金额按新币种换算
    ElMessage.success('系统设置已保存')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '系统设置保存失败')
  } finally {
    sysSaving.value = false
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

// 权限按模块分组展示（权限 code 形如 products.read，取模块前缀）
const PERM_MODULE_NAMES: Record<string, string> = {
  products: '商品',
  inventory: '库存',
  sales: '销售',
  shipment: '发货',
  procurement: '采购',
  transfer: '调拨',
  after_sales: '售后',
  replenishment: '补货',
  user: '用户',
  system: '系统',
}
const PERM_MODULE_ORDER = ['products', 'inventory', 'sales', 'shipment', 'procurement', 'transfer', 'after_sales', 'replenishment', 'user', 'system']

const permissionGroups = computed(() => {
  const map = new Map<string, any[]>()
  for (const p of permissions.value) {
    const key = String(p.code || '').split('.')[0]
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  return PERM_MODULE_ORDER.filter((m) => map.has(m)).map((m) => ({
    key: m,
    label: PERM_MODULE_NAMES[m] || m,
    items: map.get(m)!,
  }))
})

function isModuleAllChecked(grp: { key: string; items: any[] }): boolean {
  return grp.items.length > 0 && grp.items.every((p) => roleForm.permissions.includes(p.code))
}

function toggleModule(key: string, checked: boolean | string | number) {
  const grp = permissionGroups.value.find((g) => g.key === key)
  if (!grp) return
  const want = !!checked
  const codes = grp.items.map((p) => p.code)
  if (want) {
    const merged = Array.from(new Set([...roleForm.permissions, ...codes]))
    roleForm.permissions = merged
  } else {
    roleForm.permissions = roleForm.permissions.filter((c: string) => !codes.includes(c))
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
    const payload: any = {
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
  store: '',
  is_active: true,
  wh_type: 'domestic',
  warehouse_kind: 'sub',
})

// 仓库层级辅助：warehouse_kind <-> wh_type 双向同步（head/sub -> domestic，overseas -> overseas）
function kindLabel(kind: string | undefined | null): string {
  if (kind === 'head') return '总仓'
  if (kind === 'overseas') return '海外仓'
  return '子仓'
}
function kindTagType(kind: string | undefined | null): 'danger' | 'warning' | 'primary' {
  if (kind === 'head') return 'danger'
  if (kind === 'overseas') return 'warning'
  return 'primary'
}
function deriveKindFromType(whType?: string | null): string {
  return whType === 'overseas' ? 'overseas' : 'sub'
}
function deriveTypeFromKind(kind: string): string {
  return kind === 'overseas' ? 'overseas' : 'domestic'
}
function whKindTag(row: any): { label: string; type: 'danger' | 'warning' | 'primary' } {
  const kind = row.warehouse_kind ?? deriveKindFromType(row.wh_type)
  return { label: kindLabel(kind), type: kindTagType(kind) }
}
function onWhTypeChange(ty: string | number | boolean | undefined) {
  const t = String(ty ?? '')
  // 用户改 国内/海外 时联动层级：overseas -> 海外仓；domestic 时若当前为海外则回退子仓，否则保留 head/sub
  if (t === 'overseas') whForm.warehouse_kind = 'overseas'
  else if (whForm.warehouse_kind === 'overseas') whForm.warehouse_kind = 'sub'
}
function onWhKindChange(kind: string) {
  whForm.wh_type = deriveTypeFromKind(kind)
}

function openWhCreate() {
  whEditing.value = null
  whForm.name = ''
  whForm.code = ''
  whForm.address = ''
  whForm.store = ''
  whForm.is_active = true
  whForm.wh_type = 'domestic'
  whForm.warehouse_kind = 'sub'
  whVisible.value = true
}

function openWhEdit(row: any) {
  whEditing.value = row
  whForm.name = row.name
  whForm.code = row.code || ''
  whForm.address = row.address || ''
  whForm.store = row.store || ''
  whForm.is_active = row.is_active !== false
  whForm.wh_type = row.wh_type === 'overseas' ? 'overseas' : 'domestic'
  whForm.warehouse_kind = row.warehouse_kind ?? deriveKindFromType(row.wh_type)
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
      store: whForm.store.trim(),
      wh_type: deriveTypeFromKind(whForm.warehouse_kind),
      warehouse_kind: whForm.warehouse_kind,
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
const auditQuery = reactive({ page: 1, pageSize: 200, resource_type: '', action: '' })

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
  if (canUser.value) {
    loadRoles()
    loadPermissions()
  }
  loadAppearance()
  if (canManage.value) loadSystemSettings()
})
</script>

<style scoped>
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}
.pagination-bar .el-pagination {
  margin-top: 0;
}
.pagination-total {
  font-size: 14px;
  color: var(--el-text-color-secondary, #606266);
}
.page-size-select {
  width: 120px;
}
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

/* 网站图标 */
.logo-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 16px;
  background: rgba(127, 127, 127, 0.12);
  overflow: hidden;
}
.logo-preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.logo-preview-empty {
  color: var(--text-2, #888);
  font-size: 12px;
}
.logo-actions {
  margin-top: 4px;
}
.logo-edit-wrap {
  margin-top: 14px;
}
.logo-edit {
  position: relative;
  width: 128px;
  height: 128px;
  border-radius: 16px;
  background: rgba(127, 127, 127, 0.12);
  overflow: hidden;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.logo-edit:active {
  cursor: grabbing;
}
.logo-edit-img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  pointer-events: none;
  will-change: transform;
}
.logo-edit-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  max-width: 320px;
}
.logo-edit-slider {
  flex: 1;
}
.logo-edit-label {
  font-size: 13px;
  color: var(--text-2, #888);
  white-space: nowrap;
}
.logo-edit-val {
  font-size: 12px;
  color: var(--text-2, #888);
  width: 44px;
  text-align: right;
}
.logo-edit-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-3, #aaa);
}
.hidden-input {
  display: none;
}

/* 界面外观 */
.appearance-card {
  max-width: 760px;
  padding: 26px;
  background: var(--glass-bg);  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
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
.backup-result {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f5f7fa;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.8;
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
.form-tip {
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.6;
  margin-top: 2px;
}

/* 权限分组选择 */
.perm-panel {
  width: 100%;
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  padding: 4px 12px 12px;
}
.perm-group {
  border-bottom: 1px dashed var(--el-border-color-lighter, #ebeef5);
  padding: 8px 0 4px;
}
.perm-group:last-child {
  border-bottom: none;
}
.perm-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.perm-group-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--el-text-color-primary, #303133);
}
.perm-items {
  display: block;
}
.perm-checkbox-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 12px;
}
.perm-item {
  height: 32px;
  margin-right: 0;
  white-space: nowrap;
}
.perm-item-name {
  font-size: 13px;
}
.perm-item-code {
  margin-left: 6px;
  font-size: 11px;
  color: var(--ink-3, #909399);
  background: transparent;
}
</style>
