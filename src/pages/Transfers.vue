<template>
  <div class="page">
    <div class="page-header">
      <h2>调拨发货管理</h2>
      <div>
        <el-dropdown v-if="canWrite" trigger="click" @command="onExportCmd">
          <el-button :loading="exporting">导出<el-icon class="el-icon--right"><arrow-down /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="images">导出（带图片）</el-dropdown-item>
              <el-dropdown-item command="links">导出（仅链接）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button v-if="canWrite" @click="downloadTransferTemplate">下载模板</el-button>
        <el-button v-if="canWrite" type="primary" plain :loading="importing" @click="triggerTransferImport">批量导入</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增调拨发货</el-button>
        <input ref="transferImportRef" type="file" accept=".xlsx,.xls" style="display: none" @change="onTransferImportChange" />
      </div>
    </div>

    <div class="filters">
      <el-input v-model="query.tracking_no" placeholder="货件号" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
      <el-select v-model="query.shipping_mode" placeholder="空海运" clearable style="width: 140px" @change="load">
        <el-option label="空运" value="空运" />
        <el-option label="海运" value="海运" />
      </el-select>
      <el-select v-model="query.cargo_status" placeholder="货物状态" clearable style="width: 160px" @change="load">
        <el-option v-for="s in cargoStatuses" :key="s.name" :label="s.name" :value="s.name" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-wrap">
      <el-table :resizable="false" v-loading="loading" :data="rows" border stripe height="100%" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46" />
        <el-table-column prop="tracking_no" label="货件号" min-width="160" show-overflow-tooltip />
        <el-table-column prop="cargo_code" label="货代号" min-width="140" show-overflow-tooltip />
        <el-table-column label="货代" min-width="140">
          <template #default="{ row }">{{ forwarderName(row.forwarder_id) }}</template>
        </el-table-column>
        <el-table-column label="店铺" min-width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.store || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓号" min-width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse_no || '-' }}</template>
        </el-table-column>
        <el-table-column label="空海运" width="100">
          <template #default="{ row }">
            <el-tag :type="row.shipping_mode === '空运' ? 'primary' : 'warning'" effect="plain">{{ row.shipping_mode || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="箱数" width="100" align="right">
          <template #default="{ row }">{{ row.shipping_cartons ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="总数" width="110" align="right">
          <template #default="{ row }">{{ totalQty(row) }}</template>
        </el-table-column>
        <el-table-column label="发货时间" width="120">
          <template #default="{ row }">{{ row.ship_date || '-' }}</template>
        </el-table-column>
        <el-table-column label="货物状态" width="120">
          <template #default="{ row }">
            <span>{{ row.cargo_status || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="160">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row.id)">详情</el-button>
            <el-button link type="primary" @click="openEdit(row.id)">编辑</el-button>
            <el-button link type="success" @click="printWorkOrder(row.id)">打印</el-button>
            <el-button v-if="canWrite" link type="danger" @click="removeOne(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pagination-bar">
      <span class="pagination-total">当前页共 {{ rows.length }} 条</span>
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        @current-change="load"
      />
      <el-select v-model="query.pageSize" class="page-size-select" @change="onSizeChange">
        <el-option label="100条/页" :value="100" />
        <el-option label="200条/页" :value="200" />
        <el-option label="500条/页" :value="500" />
      </el-select>
    </div>

    <el-dialog v-model="createVisible" title="新增调拨发货" width="760px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="货件号" required>
              <el-input v-model="form.tracking_no" placeholder="货件号（唯一）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="货代号">
              <el-input v-model="form.cargo_code" placeholder="货代号" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="货代" required>
              <el-select v-model="form.forwarder_id" placeholder="选择货代" clearable filterable style="width: 100%">
                <el-option v-for="f in forwarders" :key="f.id" :label="f.name" :value="f.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="空海运" required>
              <el-radio-group v-model="form.shipping_mode">
                <el-radio value="空运">空运</el-radio>
                <el-radio value="海运">海运</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="箱数" required>
              <el-input-number v-model="form.shipping_cartons" :min="0" :precision="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="发货时间" required>
              <el-date-picker v-model="form.ship_date" type="date" value-format="YYYY-MM-DD" placeholder="选择发货时间" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="商品明细" required>
          <div class="items-editor">
            <div v-for="(it, idx) in form.items" :key="idx" class="item-row">
              <el-select
                v-model="it.product_id"
                filterable
                remote
                reserve-keyword
                :remote-method="onProductRemoteInput"
                :loading="searchingProducts"
                @keyup.enter="onProductSearchEnter"
                @visible-change="onProductDropdownVisible"
                placeholder="输入编码 / 名称，回车搜索"
                style="flex: 1"
              >
                <template #prefix>
                  <img
                    v-if="isImageUrl(imgOf(it.product_id))"
                    :src="thumbOf(it.product_id, 44, 44)"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    @error="onThumbError($event, imgOf(it.product_id))"
                    class="sel-img"
                  />
                </template>
                <el-option v-for="p in productOptions" :key="p.id" :value="p.id" :label="`${productCode(p)} - ${p.name}`">
                  <div class="opt-line">
                    <span class="opt-code">{{ productCode(p) }}</span>
                    <img
                      v-if="isImageUrl(p.image_text)"
                      :src="thumbUrl(p.image_text, 56, 56)"
                      loading="lazy"
                      decoding="async"
                      referrerpolicy="no-referrer"
                      @error="onThumbError($event, p.image_text)"
                      class="opt-img"
                    />
                    <span class="opt-name">{{ p.name }}</span>
                  </div>
                </el-option>
              </el-select>
              <span class="item-unit">{{ unitOf(it.product_id) }}</span>
              <el-input-number v-model="it.quantity" :min="1" :precision="0" placeholder="数量" style="width: 120px" />
              <el-input v-model="it.remark" placeholder="备注" clearable style="width: 160px" />
              <el-button link type="danger" @click="removeItem(idx)">删除</el-button>
            </div>
            <el-button size="small" @click="addItem">添加明细</el-button>
            <div class="total-hint">总数（明细数量合计）：<b>{{ totalOfItems }}</b></div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="调拨发货详情" width="760px" class="transfer-dialog transfer-detail-dialog">
      <el-descriptions v-if="detail" :column="2" border>
        <el-descriptions-item label="货件号">{{ detail.tracking_no }}</el-descriptions-item>
        <el-descriptions-item label="货代号">{{ detail.cargo_code || '-' }}</el-descriptions-item>
        <el-descriptions-item label="货代">{{ forwarderName(detail.forwarder_id) }}</el-descriptions-item>
        <el-descriptions-item label="空海运">{{ detail.shipping_mode || '-' }}</el-descriptions-item>
        <el-descriptions-item label="箱数">{{ detail.shipping_cartons ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="总数">{{ totalQty(detail) }}</el-descriptions-item>
        <el-descriptions-item label="发货时间">{{ detail.ship_date || '-' }}</el-descriptions-item>
        <el-descriptions-item label="货物状态">{{ detail.cargo_status || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间" :span="2">{{ formatDate(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <div class="detail-items-wrap">
        <el-table :resizable="false" v-if="detail" :data="detail.shipment_items || []" border stripe size="small">
          <el-table-column label="产品编码" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ productCodeOf(row.product_id) }}</template>
          </el-table-column>
          <el-table-column label="图片" width="80" align="center">
            <template #default="{ row }">
              <img
                v-if="isImageUrl(imgOf(row.product_id))"
                :src="thumbOf(row.product_id, 96, 96)"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                @error="onThumbError($event, imgOf(row.product_id))"
                class="detail-thumb"
              />
              <span v-else class="muted-thumb">-</span>
            </template>
          </el-table-column>
          <el-table-column label="中文名称" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ productNameOf(row.product_id) }}</template>
          </el-table-column>
          <el-table-column label="SKU" width="110" show-overflow-tooltip>
            <template #default="{ row }">{{ skuOf(row.product_id) }}</template>
          </el-table-column>
          <el-table-column label="单位" width="80" align="center">
            <template #default="{ row }">{{ unitOf(row.product_id) }}</template>
          </el-table-column>
          <el-table-column label="备注" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.remark || '-' }}</template>
          </el-table-column>
          <el-table-column label="数量" width="90" align="right">
            <template #default="{ row }">{{ row.quantity }}</template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button type="success" @click="printWorkOrder(detail.id)">打印工单</el-button>
        <el-button v-if="canWrite" type="primary" @click="openEdit(detail.id)">编辑</el-button>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑调拨发货" width="760px" destroy-on-close class="transfer-dialog transfer-edit-dialog">
      <el-form :model="editForm" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="货件号" required>
              <el-input v-model="editForm.tracking_no" placeholder="货件号（唯一）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="货代号">
              <el-input v-model="editForm.cargo_code" placeholder="货代号" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="货代" required>
              <el-select v-model="editForm.forwarder_id" placeholder="选择货代" clearable filterable style="width: 100%">
                <el-option v-for="f in forwarders" :key="f.id" :label="f.name" :value="f.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="空海运" required>
              <el-radio-group v-model="editForm.shipping_mode">
                <el-radio value="空运">空运</el-radio>
                <el-radio value="海运">海运</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="箱数" required>
              <el-input-number v-model="editForm.shipping_cartons" :min="0" :precision="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="发货时间" required>
              <el-date-picker v-model="editForm.ship_date" type="date" value-format="YYYY-MM-DD" placeholder="选择发货时间" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="货物状态">
              <el-select v-model="editForm.cargo_status" style="width: 100%">
                <el-option v-for="s in cargoStatuses" :key="s.name" :label="s.name" :value="s.name" />
              </el-select>
              <div class="muted-hint">状态由「待发货」变为其他状态时，将自动扣减国内库存</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="店铺">
              <el-input v-model="editForm.store" placeholder="店铺" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="仓号">
              <el-input v-model="editForm.warehouse_no" placeholder="仓号" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="商品明细" required>
          <div class="items-editor">
            <div v-for="(it, idx) in editForm.items" :key="idx" class="item-row">
              <el-select
                v-model="it.product_id"
                filterable
                remote
                reserve-keyword
                :remote-method="onProductRemoteInput"
                :loading="searchingProducts"
                @keyup.enter="onProductSearchEnter"
                @visible-change="onProductDropdownVisible"
                placeholder="输入编码 / 名称，回车搜索"
                style="flex: 1"
              >
                <template #prefix>
                  <img
                    v-if="isImageUrl(imgOf(it.product_id))"
                    :src="thumbOf(it.product_id, 44, 44)"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    @error="onThumbError($event, imgOf(it.product_id))"
                    class="sel-img"
                  />
                </template>
                <el-option v-for="p in productOptions" :key="p.id" :value="p.id" :label="`${productCode(p)} - ${p.name}`">
                  <div class="opt-line">
                    <span class="opt-code">{{ productCode(p) }}</span>
                    <img
                      v-if="isImageUrl(p.image_text)"
                      :src="thumbUrl(p.image_text, 56, 56)"
                      loading="lazy"
                      decoding="async"
                      referrerpolicy="no-referrer"
                      @error="onThumbError($event, p.image_text)"
                      class="opt-img"
                    />
                    <span class="opt-name">{{ p.name }}</span>
                  </div>
                </el-option>
              </el-select>
              <span class="item-unit">{{ unitOf(it.product_id) }}</span>
              <el-input-number v-model="it.quantity" :min="1" :precision="0" placeholder="数量" style="width: 120px" />
              <el-input v-model="it.remark" placeholder="备注" clearable style="width: 160px" />
              <el-button link type="danger" @click="removeEditItem(idx)">删除</el-button>
            </div>
            <el-button size="small" @click="addEditItem">添加明细</el-button>
            <div class="total-hint">总数（明细数量合计）：<b>{{ editTotalOfItems }}</b></div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../services/api'
import { formatDateTime as sysFormatDateTime } from '../utils/system'
import { useAuthStore } from '../stores/auth'
import { ArrowDown } from '@element-plus/icons-vue'
import { exportViaServer, todayStr } from '../utils/export'
import { readExcelFile, buildColMap, cellStr, cellNum, cellDateStr } from '../utils/import'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('shipment.write'))

function formatDate(v: string) {
  return sysFormatDateTime(v)
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const importing = ref(false)
const transferImportRef = ref<HTMLInputElement | null>(null)
const query = reactive({ page: 1, pageSize: 200, tracking_no: '', shipping_mode: '', cargo_status: '' })

const TRANSFER_IMPORT_COLUMNS: { label: string; key: string; required?: boolean; desc?: string }[] = [
  { label: '货件号', key: 'shipment_no', required: true, desc: '必填，唯一；同一货件号多行表示多个明细商品，将聚合为一个调拨单' },
  { label: '货代号', key: 'cargo_code', desc: '选填' },
  { label: '店铺', key: 'store', desc: '选填，如 9店' },
  { label: '货代', key: 'forwarder_name', required: true, desc: '必填，需与系统设置-货代管理中名称完全一致' },
  { label: '空海运', key: 'shipping_mode', desc: '选填，空运/海运' },
  { label: '仓号', key: 'warehouse_no', desc: '选填，如 3仓' },
  { label: '箱数', key: 'shipping_cartons', desc: '选填，数字' },
  { label: '发货时间', key: 'ship_date', desc: '选填，如 2026-08-01' },
  { label: '产品编码', key: 'product_code', required: true, desc: '必填，商品管理中编码/SKU/条码任一' },
  { label: '数量', key: 'quantity', required: true, desc: '必填，大于 0 的数字' },
  { label: '备注', key: 'remark', desc: '选填' },
]

async function downloadTransferTemplate() {
  try {
    const XLSX = await import('xlsx')
    const headers = TRANSFER_IMPORT_COLUMNS.map((c) => c.label)
    const sample = [
      ['FBA-20260801-001', 'AGYQ81745', '9店', '广州永利货代', '海运', '3仓', 10, '2026-08-01', 'AGYQ81745', 300, ''],
      ['FBA-20260801-001', 'AGYQ81745', '9店', '广州永利货代', '海运', '3仓', 10, '2026-08-01', 'B12345', 200, '同货件号第二行明细'],
      ['FBA-20260802-002', 'ZZZ999', '5店', '深圳海通国际', '空运', '5仓', 5, '2026-08-02', 'C67890', 50, ''],
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample])
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length * 2 + 4, 14) }))
    XLSX.utils.book_append_sheet(wb, ws, '调拨导入模板')
    const descRows = TRANSFER_IMPORT_COLUMNS.map((c) => [c.label, c.required ? '必填' : '选填', c.desc || ''])
    const ws2 = XLSX.utils.aoa_to_sheet([['列名', '是否必填', '说明'], ...descRows])
    ws2['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, ws2, '填写说明')
    XLSX.writeFile(wb, `调拨批量导入模板_${todayStr()}.xlsx`)
    ElMessage.success('模板已下载，请按“填写说明”页填写后导入')
  } catch (e: any) {
    ElMessage.error(e?.message || '模板下载失败')
  }
}

function triggerTransferImport() {
  transferImportRef.value?.click()
}

async function onTransferImportChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    const { headers, rows: rawRows } = await readExcelFile(file)
    const colIdx = buildColMap(headers, {
      shipment_no: ['货件号'],
      cargo_code: ['货代号'],
      store: ['店铺'],
      forwarder_name: ['货代'],
      shipping_mode: ['空海运'],
      warehouse_no: ['仓号'],
      shipping_cartons: ['箱数'],
      ship_date: ['发货时间'],
      product_code: ['产品编码'],
      quantity: ['数量'],
      remark: ['备注'],
    })
    if (!('shipment_no' in colIdx) || !('product_code' in colIdx) || !('quantity' in colIdx)) {
      ElMessage.warning('模板缺少必要列（货件号/产品编码/数量），请先下载模板')
      return
    }
    const rows: Record<string, unknown>[] = []
    rawRows.forEach((row, i) => {
      if (!row || (row as any[]).every((c) => c === '' || c === null || c === undefined)) return
      rows.push({
        row_no: i + 2, // 表头占第 1 行，Excel 数据行从第 2 行开始
        shipment_no: cellStr(row, colIdx.shipment_no),
        cargo_code: cellStr(row, colIdx.cargo_code) || null,
        store: cellStr(row, colIdx.store) || null,
        forwarder_name: cellStr(row, colIdx.forwarder_name) || null,
        shipping_mode: cellStr(row, colIdx.shipping_mode) || null,
        warehouse_no: cellStr(row, colIdx.warehouse_no) || null,
        shipping_cartons: cellNum(row, colIdx.shipping_cartons, 0) || null,
        ship_date: cellDateStr(row, colIdx.ship_date) || null,
        product_code: cellStr(row, colIdx.product_code),
        quantity: cellNum(row, colIdx.quantity, 0),
        remark: cellStr(row, colIdx.remark) || null,
      })
    })
    if (!rows.length) {
      ElMessage.warning('模板数据为空，请先下载模板填写后再导入')
      return
    }
    const { data } = await api.post('/shipments/import', { source: 'transfer', rows })
    const r = data?.data ?? {}
    ElMessage.success(
      `导入完成：新增调拨单 ${r.transfer_orders ?? 0} 个（明细 ${r.created ?? 0} 条）${r.failed_rows ? `，失败 ${r.failed_rows} 行` : ''}`
    )
    if (r.errors?.length) {
      const lines = (r.errors as { row: string; message: string }[]).slice(0, 10).map((e) => `第 ${e.row} 行：${e.message}`)
      console.warn('[transfers import]', r.errors)
      ElMessageBox.alert(lines.join('\n') + (r.errors.length > 10 ? `\n...等 ${r.errors.length} 条错误` : ''), '部分行导入失败', { type: 'warning' })
    }
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.message || '导入失败，请检查文件格式')
  } finally {
    importing.value = false
  }
}

function totalQty(row: any) {
  const items = row.shipment_items
  if (!Array.isArray(items) || !items.length) return 0
  return items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
}

async function load() {
  loading.value = true
  try {
    const params: any = { page: query.page, pageSize: query.pageSize, source: 'transfer' }
    if (query.tracking_no.trim()) params.tracking_no = query.tracking_no.trim()
    if (query.shipping_mode) params.shipping_mode = query.shipping_mode
    if (query.cargo_status) params.cargo_status = query.cargo_status
    const { data } = await api.get('/shipments', { params })
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

const forwarders = ref<any[]>([])
function forwarderName(id: string) {
  return forwarders.value.find((f) => f.id === id)?.name || '-'
}

const products = ref<any[]>([])
// 商品池 Map 索引：避免模板中每行多次 products.value.find 线性扫描（明细行越多开销越大）
const productMap = computed(() => {
  const m = new Map<string, any>()
  for (const p of products.value) m.set(p.id, p)
  return m
})
function productCode(p: any) {
  return p.code || p.sku || p.id
}
// Supabase Storage 缩略图：object public URL 转 render/image 变换端点，滚动区只加载小图
const STORAGE_OBJECT_PREFIX = '/storage/v1/object/public/'
const STORAGE_RENDER_PREFIX = '/storage/v1/render/image/public/'
function thumbUrl(url: string, w: number, h: number): string {
  if (url.startsWith('data:image/')) return url
  if (url.includes(STORAGE_OBJECT_PREFIX)) {
    return url.replace(STORAGE_OBJECT_PREFIX, STORAGE_RENDER_PREFIX) + `?width=${w}&height=${h}`
  }
  return url
}
// 明细行/下拉候选小图：已选商品取缩略图（2x 适配高清屏），非 storage 图原样返回
function thumbOf(pid: string, w: number, h: number): string {
  const url = imgOf(pid)
  return url ? thumbUrl(url, w, h) : ''
}
// 缩略图加载失败（如服务端未开启 image transformation）时回退原图，保证功能不受影响
function onThumbError(e: Event, fullUrl: string) {
  const img = e.target as HTMLImageElement
  if (fullUrl && img.src !== fullUrl) img.src = fullUrl
}
// 商品下拉远程搜索：输入关键词后回车触发，与商品管理模块一致
const productOptions = ref<any[]>([])
const searchingProducts = ref(false)
const productSearchKeyword = ref('')

function onProductRemoteInput(kw: string) {
  productSearchKeyword.value = (kw || '').trim()
  // 输入时不立即搜索，先清空候选避免展示全部商品，等回车触发
  if (productSearchKeyword.value) productOptions.value = []
}

async function onProductSearchEnter() {
  await searchProducts(productSearchKeyword.value)
}

function onProductDropdownVisible(visible: boolean) {
  // 打开下拉且无搜索关键词时，展示全量商品候选（保持可浏览选择）
  if (visible && !productSearchKeyword.value) productOptions.value = [...products.value]
}

async function searchProducts(kw: string) {
  searchingProducts.value = true
  try {
    if (!kw) {
      productOptions.value = [...products.value]
      return
    }
    const { data } = await api.get('/products', { params: { search: kw, page: 1, pageSize: 100 } })
    const list = data.data ?? []
    productOptions.value = list
    // 合并进商品池，保证名称/图片等关联显示可用
    const pool = new Map(products.value.map((p) => [p.id, p]))
    list.forEach((p: any) => pool.set(p.id, p))
    products.value = [...pool.values()]
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '商品搜索失败')
  } finally {
    searchingProducts.value = false
  }
}
function productInfo(pid: string) {
  const p = productMap.value.get(pid)
  return p ? `${productCode(p)} - ${p.name}` : pid
}
function productCodeOf(pid: string) {
  const p = productMap.value.get(pid)
  return p ? productCode(p) : pid
}
function skuOf(pid: string) {
  const p = productMap.value.get(pid)
  return p?.sku || '-'
}
function productNameOf(pid: string) {
  const p = productMap.value.get(pid)
  return p ? p.name : '-'
}
function unitOf(pid: string) {
  const p = productMap.value.get(pid)
  return p?.unit || '—'
}
function imgOf(pid: string) {
  const p = productMap.value.get(pid)
  return p?.image_text || ''
}
function isImageUrl(v: unknown): boolean {
  if (typeof v !== 'string' || !v) return false
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:image/')
}

const cargoStatuses = ref<any[]>([])

async function loadOptions() {
  try {
    const [fRes, csRes, pRes] = await Promise.all([
      api.get('/forwarders'),
      api.get('/cargo-statuses'),
      loadAllProducts(),
    ])
    forwarders.value = fRes.data.data ?? []
    cargoStatuses.value = csRes.data.data ?? []
    products.value = pRes
    productOptions.value = [...pRes]
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

async function loadAllProducts(): Promise<any[]> {
  const all: any[] = []
  let page = 1
  const pageSize = 500
  for (;;) {
    const { data } = await api.get('/products', { params: { page, pageSize } })
    const list = data.data ?? []
    all.push(...list)
    if (all.length >= (data.total ?? 0) || list.length < pageSize) break
    page++
  }
  return all
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  tracking_no: '',
  cargo_code: '',
  forwarder_id: '',
  shipping_mode: '空运',
  shipping_cartons: 0,
  ship_date: '',
  items: [] as any[],
})

const totalOfItems = computed(() => form.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0))

function addItem() {
  form.items.push({ product_id: '', quantity: 1, remark: '' })
}
function removeItem(idx: number) {
  form.items.splice(idx, 1)
}

function openCreate() {
  productSearchKeyword.value = ''
  // 不预载全量商品候选，避免渲染数千 option 卡顿；下拉展开或输入回车时按需加载
  productOptions.value = []
  form.tracking_no = ''
  form.cargo_code = ''
  form.forwarder_id = ''
  form.shipping_mode = '空运'
  form.shipping_cartons = 0
  form.ship_date = ''
  form.items = []
  addItem()
  createVisible.value = true
}

async function save() {
  if (!form.tracking_no.trim()) {
    ElMessage.warning('请填写货件号')
    return
  }
  if (!form.forwarder_id) {
    ElMessage.warning('请选择货代')
    return
  }
  if (!form.shipping_mode) {
    ElMessage.warning('请选择空运/海运')
    return
  }
  if (!form.ship_date) {
    ElMessage.warning('请选择发货时间')
    return
  }
  const items = form.items.filter((it) => it.product_id)
  if (!items.length) {
    ElMessage.warning('请至少添加一条商品明细')
    return
  }
  saving.value = true
  try {
    const itemCount = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
    const resp: any = await api.post('/shipments', {
      tracking_no: form.tracking_no.trim(),
      cargo_code: form.cargo_code.trim() || null,
      // 同步写发货管理展示字段，保证发货管理列表可读
      shipment_no: form.tracking_no.trim(),
      product_code: form.cargo_code.trim() || null,
      shipping_qty: itemCount,
      forwarder_id: form.forwarder_id,
      shipping_mode: form.shipping_mode,
      shipping_cartons: form.shipping_cartons ?? 0,
      ship_date: form.ship_date,
      items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, remark: it.remark || null })),
      source: 'transfer',
      cargo_status: '待发货',
    })
    if (resp?.data?.bound) {
      ElMessage.success('创建成功，已绑定发货管理中的同号货件并转为调拨发货')
    } else {
      ElMessage.success('创建成功，已同步到发货管理')
    }
    createVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const detailVisible = ref(false)
const detail = ref<any>(null)
async function fetchDetail(id: string) {
  const { data } = await api.get(`/shipments/${id}`)
  return data.data
}
async function openDetail(id: string) {
  try {
    detail.value = await fetchDetail(id)
    detailVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载详情失败')
  }
}

const editVisible = ref(false)
const editingId = ref('')
const editForm = reactive({
  tracking_no: '',
  cargo_code: '',
  forwarder_id: '',
  shipping_mode: '空运',
  shipping_cartons: 0,
  ship_date: '',
  cargo_status: '待发货',
  store: '',
  warehouse_no: '',
  items: [] as any[],
})
const editTotalOfItems = computed(() => editForm.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0))

function addEditItem() {
  editForm.items.push({ product_id: '', quantity: 1, remark: '' })
}
function removeEditItem(idx: number) {
  editForm.items.splice(idx, 1)
}

async function openEdit(id: string) {
  try {
    const d = await fetchDetail(id)
    productSearchKeyword.value = ''
    // 仅加载已选商品保证回显，避免全量商品候选渲染卡顿；下拉展开或输入回车时按需加载
    const selIds = (d.shipment_items || []).map((it: any) => it.product_id).filter(Boolean)
    productOptions.value = selIds
      .map((pid: string) => products.value.find((p) => p.id === pid))
      .filter(Boolean)
    editingId.value = id
    editForm.tracking_no = d.tracking_no
    editForm.cargo_code = d.cargo_code || ''
    editForm.forwarder_id = d.forwarder_id || ''
    editForm.shipping_mode = d.shipping_mode || '空运'
    editForm.shipping_cartons = d.shipping_cartons ?? 0
    editForm.ship_date = d.ship_date || ''
    editForm.cargo_status = d.cargo_status || '待发货'
    editForm.store = d.store || ''
    editForm.warehouse_no = d.warehouse_no || ''
    editForm.items = (d.shipment_items || []).map((it: any) => ({
      product_id: it.product_id,
      quantity: it.quantity,
      remark: it.remark || '',
    }))
    if (!editForm.items.length) addEditItem()
    editVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载数据失败')
  }
}

async function saveEdit() {
  if (!editForm.tracking_no.trim()) {
    ElMessage.warning('请填写货件号')
    return
  }
  if (!editForm.forwarder_id) {
    ElMessage.warning('请选择货代')
    return
  }
  if (!editForm.shipping_mode) {
    ElMessage.warning('请选择空运/海运')
    return
  }
  if (!editForm.ship_date) {
    ElMessage.warning('请选择发货时间')
    return
  }
  const items = editForm.items.filter((it) => it.product_id)
  if (!items.length) {
    ElMessage.warning('请至少添加一条商品明细')
    return
  }
  saving.value = true
  try {
    const itemCount = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
    const resp: any = await api.patch(`/shipments/${editingId.value}`, {
      tracking_no: editForm.tracking_no.trim(),
      cargo_code: editForm.cargo_code.trim() || null,
      // 同步写发货管理展示字段
      shipment_no: editForm.tracking_no.trim(),
      product_code: editForm.cargo_code.trim() || null,
      shipping_qty: itemCount,
      forwarder_id: editForm.forwarder_id,
      shipping_mode: editForm.shipping_mode,
      shipping_cartons: editForm.shipping_cartons ?? 0,
      ship_date: editForm.ship_date,
      cargo_status: editForm.cargo_status,
      store: editForm.store.trim() || null,
      warehouse_no: editForm.warehouse_no.trim() || null,
      items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, remark: it.remark || null })),
    })
    const saved = resp?.data?.data
    if (resp?.data?.bound) {
      ElMessage.success('修改成功，已绑定发货管理货件号并合并原记录')
    } else {
      ElMessage.success('修改成功')
    }
    editVisible.value = false
    if (detailVisible.value && saved) {
      detail.value = saved
    }
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function printWorkOrder(id: string) {
  try {
    const d = await fetchDetail(id)
    const items = d.shipment_items || []
    const totalQtyNum = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
    const prod = (pid: string) => products.value.find((x) => x.id === pid)
    const unitOfItem = (it: any) => (prod(it.product_id)?.unit || '').trim()
    // 按单位分组：个 → 套 → 对，其余单位放最后；无该单位的组直接跳过
    const UNIT_ORDER = ['个', '套', '对']
    const indexed = items.map((it: any, i: number) => ({ it, idx: i + 1, unit: unitOfItem(it) }))
    const groups: { unit: string; rows: typeof indexed }[] = []
    for (const u of UNIT_ORDER) {
      const rows = indexed.filter((x) => x.unit === u)
      if (rows.length) groups.push({ unit: u, rows })
    }
    const rest = indexed.filter((x) => !UNIT_ORDER.includes(x.unit))
    if (rest.length) groups.push({ unit: '其他', rows: rest })
    const gapRow = `<tr class="gap-row"><td colspan="9"></td></tr>`
    const rowsHtml = groups
      .map((g, gi) => {
        const body = g.rows
          .map(({ it, idx }) => {
            const p = prod(it.product_id)
            const img = p?.image_text
            const imgHtml = img
              ? `<img src="${img}" style="width:var(--img-size,60px);height:var(--img-size,60px);object-fit:contain;border:none;background:#fff" onerror="this.style.display='none'" />`
              : `<span style="color:#aaa">-</span>`
            return `
        <tr>
          <td>${idx}</td>
          <td>${p?.code || it.product_id}</td>
          <td>${imgHtml}</td>
          <td>${p?.name || '-'}</td>
          <td>${p?.sku || '-'}</td>
          <td>${p?.barcode || '-'}</td>
          <td class="num">${it.quantity}</td>
          <td>${p?.unit || '-'}</td>
          <td>${it.remark || '-'}</td>
        </tr>`
          })
          .join('')
        return (gi > 0 ? gapRow : '') + body
      })
      .join('')
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>发货工单 - ${d.tracking_no}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --img-size: 60px; --zoom: 1; }
  body { font-family: "SimSun", "宋体", "Microsoft YaHei", sans-serif; color: #000; padding: 24px; zoom: var(--zoom); }
  h1 { text-align: center; font-size: 24px; letter-spacing: 4px; margin-bottom: 16px; font-weight: 400; }
  .print-toolbar { position: fixed; top: 8px; right: 12px; z-index: 999; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .print-toolbar .btn { border: 1px solid #409EFF; background: #fff; color: #409EFF; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
  .print-toolbar .btn:hover { background: #ecf5ff; }
  .print-toolbar .btn.print-btn { background: #409EFF; color: #fff; }
  .print-toolbar .btn.print-btn:hover { background: #66b1ff; }
  .print-panel { background: #fff; border: 1px solid #dcdfe6; border-radius: 6px; padding: 10px 12px; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: 12px; color: #333; display: none; width: 210px; }
  .print-panel .row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .print-panel .row:last-child { margin-bottom: 0; }
  .print-panel input[type=range] { width: 110px; }
  .print-panel .val { width: 46px; text-align: right; color: #409EFF; }
  .meta { border: 1.5px solid #000; margin-bottom: 8px; }
  .meta table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .meta td { border: 1px solid #000; padding: 3px 6px; font-size: 11pt; text-align: center; vertical-align: middle; word-break: break-all; }
  .items { border: 1.5px solid #000; margin-bottom: 8px; }
  .items table { width: 100%; border-collapse: collapse; table-layout: auto; }
  .items th, .items td { border: 1px solid #000; padding: 4px 6px; font-size: 11pt; text-align: center; vertical-align: middle; word-break: break-all; }
  .items th { font-weight: 600; }
  .items td.num { text-align: center; white-space: nowrap; }
  .gap-row td { border: 1px solid #000 !important; padding: 4px 6px !important; }
  .sum-row td { white-space: nowrap; }
  @media print {
    @page { size: A4 portrait; margin: 0.75in 0.2361in 0.75in 0.1965in; }
    body { padding: 0; }
    .print-toolbar, .print-panel { display: none !important; }
  }
</style>
</head>
<body>
  <div class="print-toolbar">
    <button class="btn print-btn" onclick="window.print()">打印</button>
    <button class="btn" onclick="togglePanel()">调整</button>
    <div class="print-panel" id="panel">
      <div class="row"><span>图片大小</span><input type="range" id="imgSize" min="30" max="120" value="60" oninput="applyAdjust()" /><span class="val" id="imgVal">60px</span></div>
      <div class="row"><span>缩放比例</span><input type="range" id="zoomScale" min="70" max="150" value="100" oninput="applyAdjust()" /><span class="val" id="zoomVal">100%</span></div>
      <div class="row"><button class="btn" onclick="resetAdjust()" style="width:100%">恢复默认</button></div>
    </div>
  </div>
  <h1>发货工单</h1>
  <div class="meta">
    <table>
      <colgroup>
        <col style="width:6.9%"><col style="width:10.4%"><col style="width:10.3%"><col style="width:19.4%"><col style="width:18.7%"><col style="width:7.9%"><col style="width:8%"><col style="width:18.4%">
      </colgroup>
      <tr>
        <td class="label">货件号</td><td colspan="2">${d.tracking_no || '-'}</td>
        <td class="label">货代号</td><td>${d.cargo_code || '-'}</td>
        <td class="label" colspan="2">店铺</td><td>${d.store || '-'}</td>
      </tr>
      <tr>
        <td class="label">货　代</td><td colspan="2">${forwarderName(d.forwarder_id)}</td>
        <td class="label">运输方式</td><td>${d.shipping_mode || '-'}</td>
        <td class="label" colspan="2">仓号</td><td>${d.warehouse_no || '-'}</td>
      </tr>
      <tr>
        <td class="label">箱　数</td><td colspan="2">${d.shipping_cartons ?? '-'}</td>
        <td class="label">发货时间</td><td>${d.ship_date || '-'}</td>
        <td class="label" colspan="2">货物状态</td><td>${d.cargo_status || '-'}</td>
      </tr>
    </table>
  </div>
  <div class="items">
    <table>
      <thead>
        <tr>
          <th style="width:46px">序号</th>
          <th style="min-width:110px">产品编码</th>
          <th style="width:76px">图片</th>
          <th style="min-width:130px">产品中文名称</th>
          <th style="min-width:90px">SKU</th>
          <th style="min-width:120px">条形码</th>
          <th style="width:80px">数量</th>
          <th style="width:60px">单位</th>
          <th style="min-width:110px">备注</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr class="sum-row">
          <td colspan="5" style="text-align:right">合计数量（总数）</td>
          <td></td>
          <td class="num">${totalQtyNum}</td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>
  <script>
  function togglePanel() {
    var p = document.getElementById('panel');
    p.style.display = p.style.display === 'block' ? 'none' : 'block';
  }
  function applyAdjust() {
    var img = document.getElementById('imgSize').value;
    var zoom = document.getElementById('zoomScale').value;
    document.getElementById('imgVal').textContent = img + 'px';
    document.getElementById('zoomVal').textContent = zoom + '%';
    document.documentElement.style.setProperty('--img-size', img + 'px');
    document.documentElement.style.setProperty('--zoom', zoom / 100);
  }
  function resetAdjust() {
    document.getElementById('imgSize').value = 60;
    document.getElementById('zoomScale').value = 100;
    applyAdjust();
  }
<\/script>
</body>
</html>`
    const w = window.open('', '_blank', 'width=900,height=900')
    if (!w) {
      ElMessage.warning('浏览器拦截了弹窗，请允许弹出窗口后重试')
      return
    }
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '生成工单失败')
  }
}

const selected = ref<any[]>([])
function onSelectionChange(list: any[]) {
  selected.value = list
}

async function removeOne(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除货件「${row.tracking_no}」吗？此操作不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/shipments/${row.id}`)
    ElMessage.success('删除成功')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 个调拨发货吗？此操作不可恢复。`, '批量删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const ids = selected.value.map((r) => r.id)
  let ok = 0
  let fail = 0
  for (const id of ids) {
    try {
      await api.delete(`/shipments/${id}`)
      ok++
    } catch {
      fail++
    }
  }
  ElMessage.success(`删除完成：成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
  selected.value = []
  load()
}

const exporting = ref(false)
function onExportCmd(cmd: string) {
  exportRows(cmd === 'images')
}
async function exportRows(withImages = false) {
  // 仅导出勾选的行，未勾选不导出；布局与打印工单一致：货件信息区 + 明细表 + 合计行
  if (!selected.value.length) {
    ElMessage.warning('请先勾选要导出的行')
    return
  }
  // 与打印工单一致：导出前确保商品基础数据已加载，避免商品编码/名称/条形码/单位缺失
  if (!products.value.length) {
    await loadOptions()
  }
  // 与打印工单一致：明细取自详情接口（完整字段），保证导出内容与打印工单完全相同
  const targets: any[] = []
  for (const ship of selected.value) {
    try {
      targets.push(await fetchDetail(ship.id))
    } catch {
      targets.push(ship)
    }
  }
  const prod = (pid: string) => products.value.find((x) => x.id === pid)
  const aoa: any[][] = []
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  const imageCells: { r: number; c: number; url: string }[] = []
  const rowHeightRanges: { s: number; e: number; h: number }[] = []
  const titleRows: number[] = []
  let r = 0
  const push = (row: any[]) => {
    aoa.push(row)
    r++
  }
  // 与参考文件一致：信息区每行 3 组「标签+值」，按模板合并 B:C（值1）/ F:G（标签3）/ H:I（值3）
  const meta = (label1: string, v1: unknown, label2: string, v2: unknown, label3: string, v3: unknown) => {
    const row = r
    aoa.push([label1, v1 ?? '-', '', label2, v2 ?? '-', label3, '', v3 ?? '-', ''])
    merges.push({ s: { r: row, c: 1 }, e: { r: row, c: 2 } })
    merges.push({ s: { r: row, c: 5 }, e: { r: row, c: 6 } })
    merges.push({ s: { r: row, c: 7 }, e: { r: row, c: 8 } })
    r++
  }
  // 与打印工单一致：按单位分组 个→套→对→其他，组间空行，缺组跳过
  const UNIT_ORDER = ['个', '套', '对']
  targets.forEach((ship, idx) => {
    if (idx > 0) {
      push([])
    }
    // 标题行：与参考文件一致「发货工单」，A:I 合并、宋体 24、行高 42（由服务端 styled 处理字体/边框）
    const titleRow = r
    aoa.push(['发货工单', '', '', '', '', '', '', '', ''])
    merges.push({ s: { r: titleRow, c: 0 }, e: { r: titleRow, c: 8 } })
    titleRows.push(titleRow)
    rowHeightRanges.push({ s: titleRow, e: titleRow, h: 42 })
    r++
    // 信息区 3 行（与模板一致：货件号/货代号/店铺、货代/运输方式/仓号、箱数/发货时间/货物状态）行高 20
    const infoStart = r
    meta('货件号', ship.tracking_no, '货代号', ship.cargo_code, '店铺', ship.store)
    meta('货　代', forwarderName(ship.forwarder_id), '运输方式', ship.shipping_mode, '仓号', ship.warehouse_no)
    meta('箱　数', ship.shipping_cartons ?? '-', '发货时间', ship.ship_date, '货物状态', ship.cargo_status)
    rowHeightRanges.push({ s: infoStart, e: infoStart + 2, h: 20 })
    const gapRowIdx = r
    push([])
    rowHeightRanges.push({ s: gapRowIdx, e: gapRowIdx, h: 20 })
    aoa.push(['序号', '产品编码', '图片', '产品中文名称', 'SKU', '条形码', '数量', '单位', '备注'])
    r++
    // 与参考文件一致：表头之后（明细区/组间空行/合计行）行高统一 40，表头与分隔空行保持默认
    const rangeStart = r
    const items = ship.shipment_items || []
    const indexed = items.map((it: any, i: number) => ({ it, idx: i + 1, unit: (prod(it.product_id)?.unit || '').trim() }))
    const groups: { rows: typeof indexed }[] = []
    for (const u of UNIT_ORDER) {
      const rows = indexed.filter((x) => x.unit === u)
      if (rows.length) groups.push({ rows })
    }
    const rest = indexed.filter((x) => !UNIT_ORDER.includes(x.unit))
    if (rest.length) groups.push({ rows: rest })
    groups.forEach((g, gi) => {
      if (gi > 0) {
        push([])
      }
      g.rows.forEach(({ it, idx: seq }) => {
        const p = prod(it.product_id)
        const img = p?.image_text || ''
        const sku = p?.sku || ''
        if (withImages && (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('data:image/'))) {
          imageCells.push({ r, c: 2, url: img })
          aoa.push([seq, p ? productCode(p) : it.product_id, '', p?.name || '', sku, p?.barcode || '', it.quantity, p?.unit || '', it.remark || ''])
        } else {
          aoa.push([seq, p ? productCode(p) : it.product_id, img, p?.name || '', sku, p?.barcode || '', it.quantity, p?.unit || '', it.remark || ''])
        }
        r++
      })
    })
    const total = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0)
    const sumRow = r
    aoa.push(['合计数量（总数）', '', '', '', '', '', total, '', ''])
    merges.push({ s: { r: sumRow, c: 0 }, e: { r: sumRow, c: 5 } })
    r++
    rowHeightRanges.push({ s: rangeStart, e: sumRow, h: 40 })
  })
  exporting.value = true
  try {
    await exportViaServer(
      `调拨发货_${todayStr()}.xlsx`,
      {
        aoa,
        merges,
        // 与参考文件「调拨发货_2026-08-31.xlsx」列宽完全一致（A-I）
        widths: [6.875, 11.875, 8.792, 19.25, 18.625, 10.508, 5.25, 5.875, 17.6],
        rowHeightRanges,
        titleRows,
        styled: true,
        imageCells
      },
      withImages,
      '调拨发货'
    )
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  load()
  loadOptions()
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
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
}
.table-wrap :deep(.el-table) {
  flex: 1;
  min-height: 0;
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
.items-editor {
  width: 100%;
}
.item-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.item-unit {
  width: 48px;
  text-align: center;
  color: #606266;
  font-size: 13px;
  flex-shrink: 0;
}
.total-hint {
  margin-top: 8px;
  font-size: 13px;
  color: #606266;
}
.muted-hint {
  font-size: 12px;
  color: #909399;
  line-height: 32px;
}
.sel-img {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  object-fit: cover;
  vertical-align: middle;
  margin-right: 4px;
  flex-shrink: 0;
}
.opt-line {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.opt-code {
  min-width: 90px;
  font-size: 12px;
  color: #606266;
  font-family: Consolas, monospace;
  flex-shrink: 0;
}
.opt-img {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}
.opt-name {
  font-size: 13px;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail-thumb {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
  display: inline-block;
}
.muted-thumb {
  color: #c0c4cc;
  font-size: 12px;
}
/* 调拨发货弹窗：固定受限高度，明细区内滚，底部按钮固定可见 */
.transfer-dialog {
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  margin: 5vh auto;
}
.transfer-dialog :deep(.el-dialog__header) {
  flex-shrink: 0;
}
.transfer-dialog :deep(.el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 12px;
}
.transfer-dialog :deep(.el-dialog__footer) {
  flex-shrink: 0;
}
/* 编辑弹窗：商品明细区内部滚动，不撑高弹窗 */
.transfer-edit-dialog .items-editor {
  max-height: 42vh;
  overflow-y: auto;
  /* 隔离滚动区重绘：避免滚动时每行图片/输入框的绘制扩散到整个弹窗，降低卡顿 */
  contain: content;
  will-change: scroll-position;
}
/* 详情弹窗：明细表格区内部滚动 */
.detail-items-wrap {
  max-height: 42vh;
  overflow-y: auto;
  margin-top: 12px;
  contain: content;
  will-change: scroll-position;
}
/* 明细行图片：避免高清原图在滚动重绘时反复解码 */
.sel-img,
.opt-img,
.detail-thumb {
  image-rendering: auto;
}
</style>
