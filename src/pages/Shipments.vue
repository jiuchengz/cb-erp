<template>
  <div class="page">
    <div class="page-header">
      <h2>发货管理</h2>
      <div>
        <el-button v-if="canWrite" :loading="exporting" @click="exportRows">导出</el-button>
        <el-button v-if="canWrite" @click="downloadImportTemplate">导入模板</el-button>
        <el-button v-if="canWrite" type="primary" plain :loading="importing" @click="triggerImport">批量导入</el-button>
        <el-button v-if="canWrite" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" @click="openForwarderDialog">货代管理</el-button>
        <el-button v-if="canWrite" @click="openCargoStatusDialog">状态管理</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增发货单</el-button>
        <input ref="importFileRef" type="file" accept=".xlsx,.xls" style="display: none" @change="onImportFileChange" />
      </div>
    </div>

    <div class="filters">
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 160px" @change="load">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-select v-model="query.bill_check_status" placeholder="账单核对" clearable style="width: 160px" @change="load">
        <el-option v-for="s in billCheckStatusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe :row-style="rowStyle" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column label="发货时间" width="130">
        <template #default="{ row }">
          <span>{{ row.ship_date || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="货代" min-width="130">
        <template #default="{ row }">
          <span>{{ row.forwarders?.name || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="空海运" width="100">
        <template #default="{ row }">
          <span>{{ row.shipping_mode || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="仓号" width="100">
        <template #default="{ row }">
          <span>{{ row.warehouse_no || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="发货箱数" width="100">
        <template #default="{ row }">
          <span>{{ row.shipping_cartons ?? '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="发货数量" width="100">
        <template #default="{ row }">
          <span>{{ row.shipping_qty ?? '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="货件号" min-width="150">
        <template #default="{ row }">
          <span>{{ row.shipment_no || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="货代号" min-width="120">
        <template #default="{ row }">
          <span>{{ row.product_code || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="计费重量/体积" min-width="135">
        <template #default="{ row }">
          <span>{{ row.billable_weight_vol || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="体积差" width="100">
        <template #default="{ row }">
          <span>{{ row.volume_diff || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="计费金额" width="110">
        <template #default="{ row }">
          <span>{{ row.billable_amount ?? '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="运费" width="100">
        <template #default="{ row }">
          <span>{{ calcFreight(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="运费差" width="100">
        <template #default="{ row }">
          <span>{{ calcFreightDiff(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="总运费" width="110">
        <template #default="{ row }">
          <span>{{ calcTotalFreight(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="PULL后台申报数量" min-width="145">
        <template #default="{ row }">
          <span>{{ row.pull_declare_qty ?? '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="(预计)到港时间" min-width="130">
        <template #default="{ row }">
          <span>{{ row.estimated_arrival || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="货物状态" width="120">
        <template #default="{ row }">
          <el-select
            v-if="canWrite"
            :model-value="row.cargo_status || ''"
            size="small"
            :style="{ backgroundColor: getCargoColor(row.cargo_status), width: '110px' }"
            @update:model-value="onChangeCargo(row, $event)"
          >
            <el-option v-for="s in cargoStatuses" :key="s.name" :label="s.name" :value="s.name">
              <span class="dot" :style="{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', backgroundColor: s.color, marginRight: '6px', verticalAlign: 'middle' }" />
              <span>{{ s.name }}</span>
            </el-option>
          </el-select>
          <span v-else>{{ row.cargo_status || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="预约时间" min-width="170">
        <template #default="{ row }">
          <el-date-picker
            v-if="canWrite"
            :model-value="row.appointment_time || null"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="选择时间"
            size="small"
            style="width: 160px"
            @change="(v: string) => onChangeAppointment(row, v)"
          />
          <span v-else>{{ row.appointment_time ? formatDate(row.appointment_time) : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="入仓情况" min-width="130">
        <template #default="{ row }">
          <el-select
            v-if="canWrite"
            :model-value="row.warehouse_status || ''"
            placeholder="未填"
            clearable
            size="small"
            style="width: 120px"
            @update:model-value="onChangeWarehouseStatus(row, $event)"
          >
            <el-option v-for="s in warehouseStatusOptions" :key="s" :label="s" :value="s" />
          </el-select>
          <span v-else>{{ row.warehouse_status || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="实际入仓数量" width="140">
        <template #default="{ row }">
          <el-input-number
            v-if="canWrite"
            :model-value="row.actual_warehouse_qty"
            :min="0"
            :precision="0"
            controls-position="right"
            size="small"
            style="width: 130px"
            placeholder="未填"
            @change="(v: number | undefined) => onChangeActualQty(row, v)"
          />
          <span v-else>{{ row.actual_warehouse_qty ?? '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="异常情况及罚金" min-width="160">
        <template #default="{ row }">
          <el-input
            v-if="canWrite"
            :model-value="row.abnormal_penalty ?? ''"
            placeholder="如 标签不符-罚$50"
            size="small"
            style="width: 150px"
            @change="(v: string) => onChangeAbnormal(row, v)"
          />
          <span v-else>{{ row.abnormal_penalty || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="账单运费核对" min-width="190">
        <template #default="{ row }">
          <div class="bill-check" style="display:flex;align-items:center;gap:4px">
            <el-select
              v-if="canWrite"
              :model-value="row.bill_check_status"
              size="small"
              style="width: 110px"
              @update:model-value="onChangeBillCheck(row, $event)"
            >
              <el-option v-for="s in billCheckStatusOptions" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
            <el-tag v-else size="small">{{ billCheckLabel(row.bill_check_status) }}</el-tag>
            <span v-if="row.bill_check_time && row.bill_check_status === '已核对'" style="font-size:11px;color:#67C23A;white-space:nowrap">{{ formatDateOnly(row.bill_check_time) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <template v-if="canWrite">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeRow(row)">删除</el-button>
          </template>
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

    <el-dialog v-model="createVisible" title="新增发货单" width="600px" destroy-on-close>
      <el-form :model="form" label-width="120px">
        <el-form-item label="仓号">
          <el-select v-model="form.warehouse_no" placeholder="选择仓号" style="width: 100%">
            <el-option label="3仓" value="3仓" />
            <el-option label="5仓" value="5仓" />
          </el-select>
        </el-form-item>
        <el-form-item label="发货时间">
          <el-date-picker v-model="form.ship_date" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="货代">
          <el-select v-model="form.forwarder_id" clearable filterable placeholder="选择货代" style="width: 100%">
            <el-option v-for="f in activeForwarders" :key="f.id" :label="f.name" :value="f.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="发货箱数">
          <el-input v-model.number="form.shipping_cartons" type="number" placeholder="请输入箱数" style="width: 100%" />
        </el-form-item>
        <el-form-item label="发货数量">
          <el-input v-model.number="form.shipping_qty" type="number" placeholder="请输入数量" style="width: 100%" />
        </el-form-item>
        <el-form-item label="空海运">
          <el-select v-model="form.shipping_mode" placeholder="选择运输方式" style="width: 100%">
            <el-option label="空运" value="空运" />
            <el-option label="海运" value="海运" />
          </el-select>
        </el-form-item>
        <el-form-item label="货件号" required>
          <el-input v-model="form.shipment_no" placeholder="请输入货件号" />
        </el-form-item>
        <el-form-item label="货代号">
          <el-input v-model="form.product_code" placeholder="请输入货代号" />
        </el-form-item>
        <el-form-item label="计费重量/体积">
          <el-input v-model="form.billable_weight_vol" placeholder="如 30.8kg/0.17m³" />
        </el-form-item>
        <el-form-item label="体积差">
          <el-input v-model="form.volume_diff" placeholder="如 +0.06m³" />
        </el-form-item>
        <el-form-item label="计费金额">
          <el-input-number v-model="form.billable_amount" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑发货单" width="600px" destroy-on-close>
      <el-form :model="editForm" label-width="120px">
        <el-form-item label="发货时间">
          <el-date-picker v-model="editForm.ship_date" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="货代">
          <el-select v-model="editForm.forwarder_id" clearable filterable placeholder="选择货代" style="width: 100%">
            <el-option v-for="f in activeForwarders" :key="f.id" :label="f.name" :value="f.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="空海运">
          <el-select v-model="editForm.shipping_mode" placeholder="选择运输方式" style="width: 100%">
            <el-option label="空运" value="空运" />
            <el-option label="海运" value="海运" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓号">
          <el-select v-model="editForm.warehouse_no" placeholder="选择仓号" style="width: 100%">
            <el-option label="3仓" value="3仓" />
            <el-option label="5仓" value="5仓" />
          </el-select>
        </el-form-item>
        <el-form-item label="发货箱数">
          <el-input v-model.number="editForm.shipping_cartons" type="number" placeholder="请输入箱数" style="width: 100%" />
        </el-form-item>
        <el-form-item label="发货数量">
          <el-input v-model.number="editForm.shipping_qty" type="number" placeholder="请输入数量" style="width: 100%" />
        </el-form-item>
        <el-form-item label="货件号" required>
          <el-input v-model="editForm.shipment_no" placeholder="请输入货件号" />
        </el-form-item>
        <el-form-item label="货代号">
          <el-input v-model="editForm.product_code" placeholder="请输入货代号" />
        </el-form-item>
        <el-form-item label="计费重量/体积">
          <el-input v-model="editForm.billable_weight_vol" placeholder="如 30.8kg/0.17m³" />
        </el-form-item>
        <el-form-item label="体积差">
          <el-input v-model="editForm.volume_diff" placeholder="如 +0.06m³" />
        </el-form-item>
        <el-form-item label="计费金额">
          <el-input-number v-model="editForm.billable_amount" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="PULL后台申报数量">
          <el-input-number v-model="editForm.pull_declare_qty" :min="0" :precision="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="(预计)到港时间">
          <el-date-picker v-model="editForm.estimated_arrival" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="货物状态">
          <el-select v-model="editForm.cargo_status" placeholder="选择货物状态" style="width: 100%">
            <el-option v-for="s in cargoStatuses" :key="s.name" :label="s.name" :value="s.name">
              <span class="dot" :style="{ backgroundColor: s.color }" />
              <span>{{ s.name }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="预约时间">
          <el-date-picker v-model="editForm.appointment_time" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择时间" style="width: 100%" />
        </el-form-item>
        <el-form-item label="入仓情况">
          <el-select v-model="editForm.warehouse_status" clearable placeholder="选择入仓情况" style="width: 100%">
            <el-option v-for="s in warehouseStatusOptions" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="实际入仓数量">
          <el-input-number v-model="editForm.actual_warehouse_qty" :min="0" :precision="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="异常情况及罚金">
          <el-input v-model="editForm.abnormal_penalty" placeholder="如 标签不符-罚$50" />
        </el-form-item>
        <el-form-item label="账单运费核对">
          <el-select v-model="editForm.bill_check_status" style="width: 100%">
            <el-option v-for="s in billCheckStatusOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="发货单详情" width="760px">
      <el-descriptions v-if="detail" :column="2" border>
        <el-descriptions-item label="运单号">{{ detail.tracking_no }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        <el-descriptions-item label="承运商">{{ detail.carrier || '-' }}</el-descriptions-item>
        <el-descriptions-item label="货代">{{ detail.forwarders?.name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="货物状态">{{ cargoLabel(detail.cargo_status) }}</el-descriptions-item>
        <el-descriptions-item label="入仓情况">{{ detail.warehouse_status || '-' }}</el-descriptions-item>
        <el-descriptions-item label="实际入仓数量">{{ detail.actual_warehouse_qty ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="异常情况及罚金">{{ detail.abnormal_penalty || '-' }}</el-descriptions-item>
        <el-descriptions-item label="账单运费核对">{{ billCheckLabel(detail.bill_check_status) }}</el-descriptions-item>
        <el-descriptions-item label="核对时间">{{ detail.bill_check_time ? formatDate(detail.bill_check_time) : '-' }}</el-descriptions-item>
        <el-descriptions-item label="预约时间">{{ detail.appointment_time ? formatDate(detail.appointment_time) : '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="detail" :data="detail.shipment_items || []" border stripe size="small" style="margin-top: 12px">
        <el-table-column prop="product_id" label="商品ID" min-width="240" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="100" align="right" />
        <el-table-column prop="sales_order_id" label="关联销售单ID" min-width="240" show-overflow-tooltip />
      </el-table>
    </el-dialog>

    <el-dialog v-model="flowVisible" title="状态流转" width="420px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="当前状态">
          <el-tag>{{ statusLabel(flowRow?.status) }}</el-tag>
        </el-form-item>
        <el-form-item label="目标状态" required>
          <el-select v-model="flowTarget" style="width: 100%">
            <el-option v-for="s in nextStatuses(flowRow?.status)" :key="s" :label="statusLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="flowVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitFlow">确认流转</el-button>
      </template>
    </el-dialog>

    <!-- 货代管理弹窗 -->
    <el-dialog v-model="forwarderVisible" title="货代管理" width="680px" destroy-on-close>
      <el-table :data="forwarders" border stripe size="small" max-height="360">
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="contact" label="联系人" width="120">
          <template #default="{ row }">{{ row.contact || '-' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="电话" width="140">
          <template #default="{ row }">{{ row.phone || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editForwarder(row)">编辑</el-button>
            <el-button link :type="row.is_active ? 'warning' : 'success'" @click="toggleForwarder(row)">
              {{ row.is_active ? '停用' : '启用' }}
            </el-button>
            <el-button link type="danger" @click="removeForwarder(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="fw-form">
        <el-input v-model="fwForm.name" placeholder="货代名称(必填)" style="width: 170px" />
        <el-input v-model="fwForm.contact" placeholder="联系人" style="width: 110px" />
        <el-input v-model="fwForm.phone" placeholder="电话" style="width: 130px" />
        <el-input v-model="fwForm.remark" placeholder="备注" style="width: 160px" />
        <el-button type="primary" :loading="fwSaving" @click="saveForwarder">{{ fwEditingId ? '保存修改' : '新增货代' }}</el-button>
        <el-button v-if="fwEditingId" @click="resetFwForm">取消编辑</el-button>
      </div>
    </el-dialog>
    <!-- 货物状态管理弹窗 -->
    <el-dialog v-model="cargoStatusVisible" title="货物状态管理" width="620px" destroy-on-close>
      <el-table :data="cargoStatuses" border stripe size="small" max-height="360">
        <el-table-column prop="sort_order" label="排序" width="80" />
        <el-table-column prop="name" label="状态名称" min-width="150" />
        <el-table-column label="颜色" min-width="160">
          <template #default="{ row }">
            <span class="dot" :style="{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', backgroundColor: row.color, border: '1px solid #dcdfe6', marginRight: '6px', verticalAlign: 'middle' }" />
            <span>{{ row.color }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editCargoStatus(row)">编辑</el-button>
            <el-button link type="danger" @click="removeCargoStatus(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="fw-form">
        <el-input v-model="csForm.name" placeholder="状态名称(必填)" style="width: 180px" />
        <el-color-picker v-model="csForm.color" />
        <el-input v-model="csForm.sort_order" placeholder="排序(数字)" style="width: 130px" />
        <el-button type="primary" :loading="csSaving" @click="saveCargoStatus">{{ csEditingId ? '保存修改' : '新增状态' }}</el-button>
        <el-button v-if="csEditingId" @click="resetCsForm">取消编辑</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../services/api'
import { useAuthStore } from '../stores/auth'
import { exportTable, todayStr } from '../utils/export'
import * as XLSX from 'xlsx'

const auth = useAuthStore()
const canWrite = computed(() => auth.hasPermission('shipment.write'))

const SHIPMENT_FLOW: Record<string, string[]> = {
  PENDING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
}

const statusOptions = [
  { label: '待发货', value: 'PENDING' },
  { label: '已发出', value: 'SHIPPED' },
  { label: '运输中', value: 'IN_TRANSIT' },
  { label: '已送达', value: 'DELIVERED' },
  { label: '已取消', value: 'CANCELLED' },
]

const statusMap: Record<string, { label: string; type: string }> = {
  PENDING: { label: '待发货', type: 'info' },
  SHIPPED: { label: '已发出', type: 'primary' },
  IN_TRANSIT: { label: '运输中', type: 'warning' },
  DELIVERED: { label: '已送达', type: 'success' },
  CANCELLED: { label: '已取消', type: 'danger' },
}

// 货物状态字典（动态从 /api/cargo-statuses 加载，name + color）
const cargoStatuses = ref<any[]>([])

async function loadCargoStatuses() {
  try {
    const { data } = await api.get('/cargo-statuses')
    cargoStatuses.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载货物状态失败')
  }
}

function getCargoColor(s: string) {
  return cargoStatuses.value.find((x) => x.name === s)?.color || '#FFFFFF'
}
function cargoLabel(s: string) {
  return cargoStatuses.value.find((x) => x.name === s)?.name || s || '-'
}

// 整行着色：按 cargo_status 取颜色作为背景，文字色按明暗自适应
function rowStyle({ row }: { row: any }) {
  const color = getCargoColor(row.cargo_status)
  if (!color) return {}
  const c = color.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return { backgroundColor: color, color: luminance > 0.6 ? '#303133' : '#fff' }
}

const warehouseStatusOptions = ['全部入仓', '差异入仓']

const billCheckStatusOptions = [
  { label: '待确认', value: '待确认' },
  { label: '已核对', value: '已核对' },
  { label: '差异确认', value: '差异确认' },
  { label: '差异待确认', value: '差异待确认' },
]

function billCheckLabel(s: string) {
  return billCheckStatusOptions.find((o) => o.value === s)?.label || s || '-'
}

// 新增业务列：只读计算列（对齐旧文件逻辑，保留 2 位小数）
function calcFreight(row: any) {
  const a = parseFloat(row.billable_amount)
  const b = parseFloat(row.billable_weight_vol)
  return !a || !b ? '0.00' : (a * b).toFixed(2)
}
function calcFreightDiff(row: any) {
  const a = parseFloat(row.billable_amount)
  const b = parseFloat(row.volume_diff)
  return !a || !b ? '0.00' : (a * b).toFixed(2)
}
function calcTotalFreight(row: any) {
  return calcFreight(row)
}

function statusLabel(s: string) {
  return statusMap[s]?.label || s
}
function statusType(s: string) {
  return statusMap[s]?.type || 'info'
}
function nextStatuses(s?: string) {
  return (s && SHIPMENT_FLOW[s]) || []
}
function formatDate(v: string) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}
function formatDateOnly(v: string) {
  if (!v) return ''
  const d = new Date(v)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const query = reactive({ page: 1, pageSize: 20, status: '', bill_check_status: '' })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/shipments', { params: query })
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

async function patchShipment(row: any, payload: Record<string, unknown>) {
  try {
    const { data } = await api.patch(`/shipments/${row.id}`, payload)
    Object.assign(row, data.data)
    return true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败')
    load()
    return false
  }
}

function onChangeForwarder(row: any, v: string) {
  patchShipment(row, { forwarder_id: v || null })
}
function onChangeCargo(row: any, v: string) {
  patchShipment(row, { cargo_status: v })
}
function onChangeWarehouseStatus(row: any, v: string) {
  patchShipment(row, { warehouse_status: v || null })
}
function onChangeActualQty(row: any, v: number | undefined) {
  patchShipment(row, { actual_warehouse_qty: v ?? null })
}
function onChangeAbnormal(row: any, v: string) {
  patchShipment(row, { abnormal_penalty: v || null })
}
function onChangeBillCheck(row: any, v: string) {
  patchShipment(row, { bill_check_status: v })
}
function onChangeAppointment(row: any, v: string) {
  patchShipment(row, { appointment_time: v || null })
}

const forwarders = ref<any[]>([])
const activeForwarders = computed(() => forwarders.value.filter((f) => f.is_active))

async function loadAllForwarders(): Promise<any[]> {
  const all: any[] = []
  let page = 1
  const pageSize = 200
  while (true) {
    const res = await api.get('/forwarders', { params: { page, pageSize } })
    const list = res.data.data ?? []
    all.push(...list)
    const total = res.data.total ?? 0
    if (all.length >= total || list.length < pageSize) break
    page++
    if (page > 50) break
  }
  return all
}
async function loadOptions() {
  try {
    forwarders.value = await loadAllForwarders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载基础数据失败')
  }
}

const createVisible = ref(false)
const saving = ref(false)
const form = reactive({
  warehouse_no: '',
  ship_date: '',
  forwarder_id: '',
  shipping_cartons: undefined as number | undefined,
  shipping_qty: undefined as number | undefined,
  shipping_mode: '',
  shipment_no: '',
  product_code: '',
  billable_weight_vol: '',
  volume_diff: '',
  billable_amount: undefined as number | undefined,
})

function openCreate() {
  form.warehouse_no = ''
  form.ship_date = ''
  form.forwarder_id = ''
  form.shipping_cartons = undefined
  form.shipping_qty = undefined
  form.shipping_mode = ''
  form.shipment_no = ''
  form.product_code = ''
  form.billable_weight_vol = ''
  form.volume_diff = ''
  form.billable_amount = undefined
  createVisible.value = true
}

async function save() {
  if (!form.shipment_no.trim()) {
    ElMessage.warning('请输入货件号')
    return
  }
  const payload: any = {
    warehouse_no: form.warehouse_no || null,
    ship_date: form.ship_date || null,
    forwarder_id: form.forwarder_id || null,
    shipping_cartons: form.shipping_cartons ?? 0,
    shipping_qty: form.shipping_qty ?? 0,
    shipping_mode: form.shipping_mode || null,
    shipment_no: form.shipment_no.trim(),
    product_code: form.product_code || null,
    billable_weight_vol: form.billable_weight_vol || null,
    volume_diff: form.volume_diff || null,
    billable_amount: form.billable_amount ?? null,
    // 默认值：货物状态默认转运中、账单核对默认待确认
    cargo_status: '转运中',
    bill_check_status: '待确认',
  }
  saving.value = true
  try {
    await api.post('/shipments', payload)
    ElMessage.success('创建成功')
    createVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// ---- 编辑弹窗 ----
const editVisible = ref(false)
const editSaving = ref(false)
const editForm = ref<any>({})
const editId = ref<string>('')

function openEdit(row: any) {
  editId.value = row.id
  editForm.value = {
    warehouse_no: row.warehouse_no ?? null,
    ship_date: row.ship_date ?? null,
    forwarder_id: row.forwarder_id ?? null,
    shipping_cartons: row.shipping_cartons ?? 0,
    shipping_qty: row.shipping_qty ?? 0,
    shipping_mode: row.shipping_mode ?? null,
    shipment_no: row.shipment_no ?? '',
    product_code: row.product_code ?? null,
    billable_weight_vol: row.billable_weight_vol ?? null,
    volume_diff: row.volume_diff ?? null,
    billable_amount: row.billable_amount ?? null,
    pull_declare_qty: row.pull_declare_qty ?? 0,
    estimated_arrival: row.estimated_arrival ?? null,
    cargo_status: row.cargo_status ?? '转运中',
    appointment_time: row.appointment_time ?? null,
    warehouse_status: row.warehouse_status ?? null,
    actual_warehouse_qty: row.actual_warehouse_qty ?? 0,
    abnormal_penalty: row.abnormal_penalty ?? null,
    bill_check_status: row.bill_check_status ?? '待确认',
  }
  editVisible.value = true
}

async function saveEdit() {
  const f = editForm.value
  if (!f.shipment_no || !String(f.shipment_no).trim()) {
    ElMessage.warning('请输入货件号')
    return
  }
  editSaving.value = true
  try {
    const payload: any = {
      warehouse_no: f.warehouse_no || null,
      ship_date: f.ship_date || null,
      forwarder_id: f.forwarder_id || null,
      shipping_cartons: f.shipping_cartons ?? null,
      shipping_qty: f.shipping_qty ?? null,
      shipping_mode: f.shipping_mode || null,
      shipment_no: String(f.shipment_no).trim(),
      product_code: f.product_code || null,
      billable_weight_vol: f.billable_weight_vol || null,
      volume_diff: f.volume_diff || null,
      billable_amount: f.billable_amount ?? null,
      pull_declare_qty: f.pull_declare_qty ?? null,
      estimated_arrival: f.estimated_arrival || null,
      cargo_status: f.cargo_status,
      appointment_time: f.appointment_time || null,
      warehouse_status: f.warehouse_status || null,
      actual_warehouse_qty: f.actual_warehouse_qty ?? null,
      abnormal_penalty: f.abnormal_penalty || null,
      bill_check_status: f.bill_check_status,
    }
    await api.patch(`/shipments/${editId.value}`, payload)
    ElMessage.success('更新成功')
    editVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败')
  } finally {
    editSaving.value = false
  }
}

// ---- 删除单行 ----
async function removeRow(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除发货单「${row.shipment_no || row.tracking_no || row.id}」吗？`, '删除发货单', {
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

const detailVisible = ref(false)
const detail = ref<any>(null)
async function openDetail(id: string) {
  try {
    const { data } = await api.get(`/shipments/${id}`)
    detail.value = data.data
    detailVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载详情失败')
  }
}

const flowVisible = ref(false)
const flowRow = ref<any>(null)
const flowTarget = ref('')
function openFlow(row: any) {
  flowRow.value = row
  const next = nextStatuses(row.status)
  flowTarget.value = next[0] ?? ''
  flowVisible.value = true
}

async function submitFlow() {
  if (!flowRow.value || !flowTarget.value) return
  saving.value = true
  try {
    await api.patch(`/shipments/${flowRow.value.id}`, { status: flowTarget.value })
    ElMessage.success('状态更新成功')
    flowVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '状态更新失败')
  } finally {
    saving.value = false
  }
}

const selected = ref<any[]>([])
function onSelectionChange(rows: any[]) {
  selected.value = rows
}

const exporting = ref(false)
function exportRows() {
  const columns = [
    { key: 'ship_date', label: '发货时间', value: (r: any) => r.ship_date || '' },
    { key: 'forwarder', label: '货代', value: (r: any) => r.forwarders?.name || '' },
    { key: 'shipping_mode', label: '空海运', value: (r: any) => r.shipping_mode || '' },
    { key: 'warehouse_no', label: '仓号', value: (r: any) => r.warehouse_no || '' },
    { key: 'shipping_cartons', label: '发货箱数', value: (r: any) => r.shipping_cartons ?? '' },
    { key: 'shipping_qty', label: '发货数量', value: (r: any) => r.shipping_qty ?? '' },
    { key: 'shipment_no', label: '货件号', value: (r: any) => r.shipment_no || '' },
    { key: 'product_code', label: '货代号', value: (r: any) => r.product_code || '' },
    { key: 'billable_weight_vol', label: '计费重量/体积', value: (r: any) => r.billable_weight_vol || '' },
    { key: 'volume_diff', label: '体积差', value: (r: any) => r.volume_diff || '' },
    { key: 'billable_amount', label: '计费金额', value: (r: any) => r.billable_amount ?? '' },
    { key: 'freight', label: '运费', value: (r: any) => calcFreight(r) },
    { key: 'freight_diff', label: '运费差', value: (r: any) => calcFreightDiff(r) },
    { key: 'total_freight', label: '总运费', value: (r: any) => calcTotalFreight(r) },
    { key: 'pull_declare_qty', label: 'PULL后台申报数量', value: (r: any) => r.pull_declare_qty ?? '' },
    { key: 'estimated_arrival', label: '(预计)到港时间', value: (r: any) => r.estimated_arrival || '' },
    { key: 'cargo_status', label: '货物状态', value: (r: any) => cargoLabel(r.cargo_status) },
    { key: 'appointment_time', label: '预约时间', value: (r: any) => (r.appointment_time ? formatDate(r.appointment_time) : '') },
    { key: 'warehouse_status', label: '入仓情况', value: (r: any) => r.warehouse_status || '' },
    { key: 'actual_warehouse_qty', label: '实际入仓数量', value: (r: any) => r.actual_warehouse_qty ?? '' },
    { key: 'abnormal_penalty', label: '异常情况及罚金', value: (r: any) => r.abnormal_penalty || '' },
    { key: 'bill_check_status', label: '账单运费核对', value: (r: any) => billCheckLabel(r.bill_check_status) },
    { key: 'bill_check_time', label: '核对时间', value: (r: any) => (r.bill_check_time ? formatDate(r.bill_check_time) : '') },
  ]
  exporting.value = true
  try {
    exportTable(rows.value, columns, `发货列表_${todayStr()}.xlsx`)
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selected.value.length} 个发货单吗？此操作不可恢复。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
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

// ===== 批量导入 / 导入模板 =====
// 导入模板表头（中文列名 + 对应线上 snake_case 字段，顺序对齐旧文件 downloadShipmentsTemplate）
const IMPORT_COLUMNS: { label: string; key: string }[] = [
  { label: '发货时间', key: 'ship_date' },
  { label: '货代', key: 'forwarder' },
  { label: '空海运', key: 'shipping_mode' },
  { label: '仓号', key: 'warehouse_no' },
  { label: '发货箱数', key: 'shipping_cartons' },
  { label: '发货数量', key: 'shipping_qty' },
  { label: '货件号', key: 'shipment_no' },
  { label: '货代号', key: 'product_code' },
  { label: '计费重量/体积', key: 'billable_weight_vol' },
  { label: '体积差', key: 'volume_diff' },
  { label: '计费金额', key: 'billable_amount' },
  { label: '货物状态', key: 'cargo_status' },
  { label: '预约时间', key: 'appointment_time' },
  { label: '入仓情况', key: 'warehouse_status' },
  { label: '实际入仓数量', key: 'actual_warehouse_qty' },
  { label: '异常情况及罚金', key: 'abnormal_penalty' },
  { label: '账单运费核对', key: 'bill_check_status' },
]

// 旧文件模板英文表头 -> snake_case（兼容旧文件下载的模板）
const LEGACY_HEADER_MAP: Record<string, string> = {
  shipDate: 'ship_date',
  forwarder: 'forwarder',
  shippingMode: 'shipping_mode',
  warehouseNo: 'warehouse_no',
  shippingCartons: 'shipping_cartons',
  shippingQty: 'shipping_qty',
  shipmentNo: 'shipment_no',
  productCode: 'product_code',
  billableWeightVol: 'billable_weight_vol',
  volumeDiff: 'volume_diff',
  billableAmount: 'billable_amount',
  cargoStatus: 'cargo_status',
  appointmentTime: 'appointment_time',
  warehouseStatus: 'warehouse_status',
  actualWarehouseQty: 'actual_warehouse_qty',
  abnormalPenalty: 'abnormal_penalty',
  billCheckStatus: 'bill_check_status',
}

const importing = ref(false)
const importFileRef = ref<HTMLInputElement | null>(null)

function triggerImport() {
  importFileRef.value?.click()
}

/** 下载发货导入 Excel 模板（参照旧文件 downloadShipmentsTemplate 写法） */
function downloadImportTemplate() {
  try {
    const headers = IMPORT_COLUMNS.map((c) => c.label)
    const sample = [
      '2026-08-01',
      '广州永利货代',
      '海运',
      '3仓',
      10,
      500,
      'FBA-XXX001',
      'AGYQ81745',
      '31.9kg/0.24m³',
      '+0.06m³',
      5900.4,
      '转运中',
      '2026-08-16 10:00',
      '全部入仓',
      500,
      '',
      '待确认',
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([headers, sample])
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length * 2 + 4, 14) }))
    XLSX.utils.book_append_sheet(wb, ws, '发货导入模板')
    XLSX.writeFile(wb, `发货批量导入模板_${todayStr()}.xlsx`)
    ElMessage.success('模板已下载')
  } catch (e: any) {
    ElMessage.error(e?.message || '模板下载失败')
  }
}

/** 解析 Excel 表头 -> 行数据映射，逐条新增/覆盖并统计结果 */
async function onImportFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importing.value = true
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) {
      ElMessage.warning('Excel 中没有可读取的工作表')
      return
    }
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (aoa.length < 2) {
      ElMessage.warning('模板数据为空，请先下载模板填写后再导入')
      return
    }

    // 表头行 -> snake_case 字段映射
    const headerRow = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim())
    const colIdx: Record<string, number> = {}
    headerRow.forEach((h, i) => {
      const key = IMPORT_COLUMNS.find((c) => c.label === h)?.key || LEGACY_HEADER_MAP[h]
      if (key) colIdx[key] = i
    })
    const hasShipmentNo = 'shipment_no' in colIdx
    if (!hasShipmentNo) {
      ElMessage.warning('模板缺少「货件号」列，请使用导入模板文件')
      return
    }

    // 加载已有货件号 -> id 映射（用于覆盖）
    const existingMap = new Map<string, string>()
    let page = 1
    const pageSize = 200
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data } = await api.get('/shipments', { params: { page, pageSize } })
      const list: any[] = data.data ?? []
      for (const r of list) {
        if (r.shipment_no) existingMap.set(r.shipment_no, r.id)
      }
      if (list.length < pageSize) break
      page++
    }

    const forwarderNameToId = new Map<string, string>()
    for (const f of forwarders.value) forwarderNameToId.set(f.name, f.id)

    const num = (v: unknown): number | null => {
      if (v === '' || v === null || v === undefined) return null
      const n = Number(String(v).trim())
      return Number.isFinite(n) ? n : null
    }
    const str = (v: unknown): string | null => {
      if (v === '' || v === null || v === undefined) return null
      return String(v).trim() || null
    }
    const get = (row: unknown[], key: string) => (colIdx[key] !== undefined ? row[colIdx[key]] : '')

    let created = 0
    let updated = 0
    let failed = 0
    const errors: string[] = []
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i]
      if (!row || (row as unknown[]).every((c) => c === '' || c === null || c === undefined)) continue
      const shipmentNo = str(get(row, 'shipment_no'))
      if (!shipmentNo) {
        failed++
        errors.push(`第 ${i + 1} 行：货件号为空，已跳过`)
        continue
      }
      const forwarderName = str(get(row, 'forwarder'))
      const payload: any = {
        warehouse_no: str(get(row, 'warehouse_no')),
        ship_date: str(get(row, 'ship_date')),
        forwarder_id: forwarderName ? forwarderNameToId.get(forwarderName) || null : null,
        shipping_cartons: num(get(row, 'shipping_cartons')),
        shipping_qty: num(get(row, 'shipping_qty')),
        shipping_mode: str(get(row, 'shipping_mode')),
        shipment_no: shipmentNo,
        product_code: str(get(row, 'product_code')),
        billable_weight_vol: str(get(row, 'billable_weight_vol')),
        volume_diff: str(get(row, 'volume_diff')),
        billable_amount: num(get(row, 'billable_amount')),
        cargo_status: str(get(row, 'cargo_status')) || '转运中',
        appointment_time: str(get(row, 'appointment_time')),
        warehouse_status: str(get(row, 'warehouse_status')),
        actual_warehouse_qty: num(get(row, 'actual_warehouse_qty')),
        abnormal_penalty: str(get(row, 'abnormal_penalty')),
        bill_check_status: str(get(row, 'bill_check_status')) || '待确认',
      }
      try {
        const existingId = existingMap.get(shipmentNo)
        if (existingId) {
          await api.patch(`/shipments/${existingId}`, payload)
          updated++
        } else {
          await api.post('/shipments', payload)
          created++
        }
      } catch (err: any) {
        failed++
        errors.push(`第 ${i + 1} 行（${shipmentNo}）：${err?.response?.data?.error?.message || err?.message || '导入失败'}`)
      }
    }

    ElMessage.success(`导入完成：新增 ${created} 条，覆盖 ${updated} 条${failed ? `，失败 ${failed} 条` : ''}`)
    if (errors.length) {
      console.warn('[shipments import]', errors)
      ElMessageBox.alert(errors.slice(0, 10).join('\n'), '部分行导入失败', { type: 'warning' })
    }
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '导入失败，请检查文件格式')
  } finally {
    importing.value = false
  }
}

// ===== 货代管理 =====
const forwarderVisible = ref(false)
const fwSaving = ref(false)
const fwEditingId = ref('')
const fwForm = reactive({ name: '', contact: '', phone: '', remark: '' })

function resetFwForm() {
  fwEditingId.value = ''
  fwForm.name = ''
  fwForm.contact = ''
  fwForm.phone = ''
  fwForm.remark = ''
}

function openForwarderDialog() {
  resetFwForm()
  loadForwarders()
  forwarderVisible.value = true
}

async function loadForwarders() {
  try {
    forwarders.value = await loadAllForwarders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载货代失败')
  }
}

function editForwarder(row: any) {
  fwEditingId.value = row.id
  fwForm.name = row.name
  fwForm.contact = row.contact || ''
  fwForm.phone = row.phone || ''
  fwForm.remark = row.remark || ''
}

async function saveForwarder() {
  if (!fwForm.name.trim()) {
    ElMessage.warning('请填写货代名称')
    return
  }
  fwSaving.value = true
  try {
    const payload = {
      name: fwForm.name.trim(),
      contact: fwForm.contact.trim() || null,
      phone: fwForm.phone.trim() || null,
      remark: fwForm.remark.trim() || null,
    }
    if (fwEditingId.value) {
      await api.patch(`/forwarders/${fwEditingId.value}`, payload)
      ElMessage.success('修改成功')
    } else {
      await api.post('/forwarders', payload)
      ElMessage.success('新增成功')
    }
    resetFwForm()
    loadForwarders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    fwSaving.value = false
  }
}

async function toggleForwarder(row: any) {
  try {
    await api.patch(`/forwarders/${row.id}`, { is_active: !row.is_active })
    ElMessage.success(row.is_active ? '已停用' : '已启用')
    loadForwarders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '操作失败')
  }
}

async function removeForwarder(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除货代「${row.name}」吗？`, '删除货代', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/forwarders/${row.id}`)
    ElMessage.success('删除成功')
    loadForwarders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

// ===== 货物状态管理 =====
const cargoStatusVisible = ref(false)
const csSaving = ref(false)
const csEditingId = ref('')
const csForm = reactive({ name: '', color: '#FFFFFF', sort_order: 0 })

function resetCsForm() {
  csEditingId.value = ''
  csForm.name = ''
  csForm.color = '#FFFFFF'
  csForm.sort_order = 0
}

function openCargoStatusDialog() {
  resetCsForm()
  loadCargoStatuses()
  cargoStatusVisible.value = true
}

function editCargoStatus(row: any) {
  csEditingId.value = row.id
  csForm.name = row.name
  csForm.color = row.color || '#FFFFFF'
  csForm.sort_order = row.sort_order ?? 0
}

async function saveCargoStatus() {
  if (!csForm.name.trim()) {
    ElMessage.warning('请填写状态名称')
    return
  }
  csSaving.value = true
  try {
    const payload = {
      name: csForm.name.trim(),
      color: csForm.color || '#FFFFFF',
      sort_order: csForm.sort_order ?? 0,
    }
    if (csEditingId.value) {
      await api.patch(`/cargo-statuses/${csEditingId.value}`, payload)
      ElMessage.success('修改成功')
    } else {
      await api.post('/cargo-statuses', payload)
      ElMessage.success('新增成功')
    }
    resetCsForm()
    loadCargoStatuses()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    csSaving.value = false
  }
}

async function removeCargoStatus(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除货物状态「${row.name}」吗？`, '删除货物状态', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/cargo-statuses/${row.id}`)
    ElMessage.success('删除成功')
    loadCargoStatuses()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

onMounted(() => {
  load()
  loadOptions()
  loadCargoStatuses()
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
.items-editor {
  width: 100%;
}
.item-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.bill-check {
  display: flex;
  align-items: center;
  gap: 6px;
}
.check-time {
  font-size: 11px;
  color: #67c23a;
  white-space: nowrap;
}
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 6px;
}
.fw-form {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
  align-items: center;
  flex-wrap: wrap;
}
</style>
