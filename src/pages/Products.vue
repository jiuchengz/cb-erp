<template>
  <div class="page">
    <div class="page-header">
      <h2>商品管理</h2>
      <div class="profit-bar">
        <span class="profit-label">汇率（RMB/比索）</span>
        <el-input-number v-model="rate" :min="0.01" :max="10" :precision="4" :step="0.01" size="small" />
        <span class="profit-tip">利润列实时重算（只读联动）</span>
      </div>
      <div>
        <el-button v-if="canWrite" @click="downloadTpl">下载模板</el-button>
        <el-dropdown v-if="canWrite" trigger="click" @command="onExportCmd">
          <el-button :loading="exporting">导出<el-icon class="el-icon--right"><arrow-down /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="images">导出（带图片）</el-dropdown-item>
              <el-dropdown-item command="links">导出（仅链接）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button v-if="canWrite" :disabled="!selected.length" @click="openBatchEdit">
          批量编辑{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canDelete" type="danger" :disabled="!selected.length" @click="batchRemove">
          批量删除{{ selected.length ? `(${selected.length})` : '' }}
        </el-button>
        <el-button v-if="canWrite" type="warning" :loading="importing" @click="triggerImport">批量导入</el-button>
        <el-button v-if="canWrite" type="primary" @click="openCreate">新增商品</el-button>
        <input ref="importFile" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onImportFile" />
      </div>
    </div>

    <div class="filters">
      <el-input
        v-model="query.search"
        placeholder="搜索 SKU / 名称 / 产品编号 / 链接ID / 条形码"
        clearable
        style="width: 260px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 140px" @change="load">
        <el-option label="启用" value="active" />
        <el-option label="停用" value="inactive" />
      </el-select>
      <el-select v-if="warehouses.length > 1" v-model="query.warehouse_id" placeholder="仓库" clearable style="width: 160px" @change="load">
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
      <el-dropdown trigger="click" @command="onSalesRangeCommand">
        <el-button>
          {{ salesRangeLabel }}
          <el-icon class="el-icon--right"><arrow-down /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu style="width: 180px; padding: 6px">
            <el-dropdown-item command="all" :class="{ 'sales-range-active': salesRangeKey === 'all' }">全部时间</el-dropdown-item>
            <el-dropdown-item command="today" :class="{ 'sales-range-active': salesRangeKey === 'today' }">今日</el-dropdown-item>
            <el-dropdown-item command="7d" :class="{ 'sales-range-active': salesRangeKey === '7d' }">近7天</el-dropdown-item>
            <el-dropdown-item command="15d" :class="{ 'sales-range-active': salesRangeKey === '15d' }">近15天</el-dropdown-item>
            <el-dropdown-item command="30d" :class="{ 'sales-range-active': salesRangeKey === '30d' }">近30天</el-dropdown-item>
            <el-dropdown-item command="custom" :class="{ 'sales-range-active': salesRangeKey === 'custom' }">自定义</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-date-picker
        v-model="customSalesRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        clearable
        style="width: 200px"
        @change="onDateRangeChange"
      />
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-wrap">
    <el-table :resizable="false" v-loading="loading" :data="pagedRows" border stripe height="100%" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column prop="code" label="产品编号" min-width="140" show-overflow-tooltip />
      <el-table-column label="仓库" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <template v-if="(row.warehouse_ids || []).length">
            <el-tag v-for="wid in row.warehouse_ids" :key="wid" size="small" effect="plain" style="margin: 1px 4px 1px 0">{{ warehouseName(wid) }}</el-tag>
          </template>
          <span v-else class="form-tip">未绑定</span>
        </template>
      </el-table-column>
      <el-table-column label="图片" width="90">
        <template #default="{ row }">
          <el-tooltip v-if="isImageUrl(row.image_text)" :show-after="200" :offset="10">
            <template #content>
              <img :src="row.image_text" class="img-preview" referrerpolicy="no-referrer" @error="onImgError($event)" />
            </template>
            <img :src="row.image_text" class="product-thumb" referrerpolicy="no-referrer" @error="onImgError($event)" @click="onPreviewImage(row.image_text)" />
          </el-tooltip>
          <div v-else-if="row.image_text" class="img-text-cell" :title="row.image_text">{{ row.image_text }}</div>
          <div v-else class="img-fallback">无图片</div>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="link_id" label="链接ID" min-width="120" show-overflow-tooltip />
      <el-table-column label="SKU" min-width="140">
        <template #default="{ row }">{{ row.sku || '—' }}</template>
      </el-table-column>
      <el-table-column prop="barcode" label="条形码" min-width="140" />
      <el-table-column label="单位" width="90">
        <template #default="{ row }">{{ row.unit || '—' }}</template>
      </el-table-column>
      <el-table-column label="备注" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.remark || '—' }}</template>
      </el-table-column>
      <el-table-column prop="domestic_stock" label="国内库存" width="100" align="right">
        <template #header>
          <span class="sortable-header" @click="toggleSort('domestic_stock')">国内库存<el-icon class="sort-icon" :class="{ active: !!sortDir('domestic_stock') }"><sort v-if="!sortDir('domestic_stock')" /><arrow-up v-else-if="sortDir('domestic_stock') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
      </el-table-column>
      <el-table-column prop="overseas_stock" label="国外库存" width="100" align="right">
        <template #header>
          <span class="sortable-header" @click="toggleSort('overseas_stock')">国外库存<el-icon class="sort-icon" :class="{ active: !!sortDir('overseas_stock') }"><sort v-if="!sortDir('overseas_stock')" /><arrow-up v-else-if="sortDir('overseas_stock') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
      </el-table-column>
      <el-table-column label="库存预警" width="110" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.out_of_stock" type="danger" effect="dark" size="small">断货</el-tag>
          <el-tag v-else-if="row.low_stock" type="warning" effect="plain" size="small">低库存</el-tag>
          <el-tag v-else type="success" effect="plain" size="small">正常</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="in_transit_qty" label="在途数量" width="110" align="right">
        <template #header>
          <span class="sortable-header" @click="toggleSort('in_transit_qty')">在途数量<el-icon class="sort-icon" :class="{ active: !!sortDir('in_transit_qty') }"><sort v-if="!sortDir('in_transit_qty')" /><arrow-up v-else-if="sortDir('in_transit_qty') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
        <template #default="{ row }">
          <el-link type="primary" :underline="false" @click="openTrack(row)">{{ row.in_transit_qty ?? 0 }}</el-link>
        </template>
      </el-table-column>
      <el-table-column prop="sales_qty" :label="salesColumnLabel" width="120" align="right">
        <template #header>
          <span class="sortable-header" @click="toggleSort('sales_qty')">{{ salesColumnLabel }}<el-icon class="sort-icon" :class="{ active: !!sortDir('sales_qty') }"><sort v-if="!sortDir('sales_qty')" /><arrow-up v-else-if="sortDir('sales_qty') === 'ascending'" /><arrow-down v-else /></el-icon></span>
        </template>
        <template #default="{ row }">
          <el-link type="primary" :underline="false" @click="openTrack(row)">{{ row.sales_qty ?? 0 }}</el-link>
        </template>
      </el-table-column>
      <el-table-column label="售价" width="120" align="right">
        <template #default="{ row }">{{ formatMoney(row.sale_price ?? row.unit_price) }}</template>
      </el-table-column>
      <el-table-column :label="'不含税采购成本(' + getCurrencyCode() + ')'" width="130" align="right">
        <template #default="{ row }">{{ formatMoneyFrom(row.purchase_cost, row.currency || 'MXN') }}</template>
      </el-table-column>
      <el-table-column :label="'头程运费(' + getCurrencyCode() + ')'" width="100" align="right">
        <template #default="{ row }">{{ formatMoneyFrom(row.first_leg_freight, row.currency || 'MXN') }}</template>
      </el-table-column>
      <el-table-column :label="'尾程派送(' + getCurrencyCode() + ')'" width="130" align="right">
        <template #default="{ row }">{{ formatMoney(row.last_mile_delivery_peso) }}</template>
      </el-table-column>
      <el-table-column label="ML佣金比例" width="110" align="right">
        <template #default="{ row }">{{ pct(row.ml_commission_rate) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openTrack(row)">明细</el-button>
          <el-button v-if="canWrite" link type="primary" @click="openEdit(row as Product)">编辑</el-button>
          <el-button v-if="canDelete" link type="danger" @click="remove(row as Product)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <div class="pagination-bar">
      <span class="pagination-total">当前页共 {{ pagedRows.length }} 条</span>
      <el-pagination
        v-if="query.pageSize > 0"
        background
        layout="total, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        @current-change="onPageChange"
      />
      <span v-else class="pagination-total">共 {{ total }} 条</span>
      <el-select v-model="query.pageSize" class="page-size-select" @change="onSizeChange">
        <el-option label="100条/页" :value="100" />
        <el-option label="200条/页" :value="200" />
        <el-option label="500条/页" :value="500" />
        <el-option label="全部" :value="0" />
      </el-select>
    </div>

        <el-drawer v-model="trackVisible" :title="trackTitle" size="900px" destroy-on-close class="track-drawer">
      <div v-loading="trackLoading">
        <template v-if="trackData">
          <div class="track-summary">
            <el-descriptions :column="4" border size="small">
              <el-descriptions-item label="SKU">{{ trackData.product.sku || '—' }}</el-descriptions-item>
              <el-descriptions-item label="产品编号">{{ trackData.product.code || '—' }}</el-descriptions-item>
              <el-descriptions-item label="链接ID">{{ trackData.product.link_id || '—' }}</el-descriptions-item>
              <el-descriptions-item label="海外库存">{{ trackData.product.overseas_stock ?? 0 }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="track-filter-bar">
            <span class="track-filter-label">统计周期：</span>
            <el-radio-group v-model="trackSalesRange" size="small" @change="onTrackRangeChange">
              <el-radio-button value="7d">近7天</el-radio-button>
              <el-radio-button value="15d">近15天</el-radio-button>
              <el-radio-button value="30d">近30天</el-radio-button>
            </el-radio-group>
            <span class="track-filter-hint">曲线图自动对比上一周期（环比）</span>
          </div>

          <!-- 曲线图：统计周期 vs 环比周期 -->
          <div class="chart-card">
            <div class="chart-head">
              <span class="chart-title">销量趋势（实际销量 = 销量 − 退款）</span>
              <span class="chart-legend">
                <span class="legend-item"><i class="dot blue"></i>统计周期：{{ trackChart.curLabel || '—' }}</span>
                <span class="legend-item"><i class="dot orange"></i>环比周期：{{ trackChart.prevLabel || '—' }}</span>
              </span>
            </div>
            <div class="chart-wrap">
              <div ref="lineTipEl" class="chart-tip"></div>
              <svg ref="lineSvgEl" viewBox="0 0 760 240"></svg>
              <div v-if="!hasLineData" class="chart-empty">所选周期暂无销量数据</div>
            </div>
          </div>

          <!-- 直方图：平台销量分布 -->
          <div class="chart-card">
            <div class="chart-head">
              <span class="chart-title">平台销量分布（{{ trackChart.curLabel || '统计周期' }} 合计 {{ trackChart.total }} 件）</span>
            </div>
            <div class="chart-wrap">
              <div ref="barTipEl" class="chart-tip"></div>
              <svg ref="barSvgEl" viewBox="0 0 760 210"></svg>
              <div v-if="!trackChart.platforms.length" class="chart-empty">暂无平台销量数据</div>
            </div>
          </div>

          <el-collapse v-model="trackOpenPanels" class="track-collapse">
            <el-collapse-item name="shipments">
              <template #title>
                <span class="collapse-title">在途 / 发货批次（{{ trackShipments.length }} / {{ trackData.shipments.length }}）</span>
              </template>
              <div class="collapse-body">
                <div class="track-filter-bar">
                  <span class="track-filter-label">筛选状态：</span>
                  <el-radio-group v-model="trackShipFilter" size="small">
                    <el-radio-button value="全部">全部</el-radio-button>
                    <el-radio-button v-for="st in trackCargoStatuses" :key="st.name" :value="st.name">{{ st.name }}</el-radio-button>
                  </el-radio-group>
                </div>
                <el-table :resizable="false" :data="trackShipments" border size="small" max-height="280">
                  <el-table-column label="货件号" min-width="150" show-overflow-tooltip>
                    <template #default="{ row }">{{ row.tracking_no || row.cargo_code || '—' }}</template>
                  </el-table-column>
                  <el-table-column prop="ship_date" label="发货日期" width="110" />
                  <el-table-column label="货物状态" width="110">
                    <template #default="{ row }">
                      <el-tag v-if="row.cargo_status === '已入仓'" type="success" size="small">{{ row.cargo_status || '—' }}</el-tag>
                      <el-tag v-else type="warning" size="small">{{ row.cargo_status || '—' }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="estimated_arrival" label="预计到港" width="110" />
                  <el-table-column label="状态更新" width="160">
                    <template #default="{ row }">{{ formatDate(row.updated_at) }}</template>
                  </el-table-column>
                  <el-table-column prop="quantity" label="数量" width="80" align="right" />
                  <el-table-column prop="forwarder" label="货代" min-width="100" show-overflow-tooltip />
                </el-table>
                <div v-if="!trackData.shipments.length" class="track-empty">暂无发货批次记录</div>
              </div>
            </el-collapse-item>

            <el-collapse-item name="sales">
              <template #title>
                <span class="collapse-title">销量明细（{{ trackSalesRangeLabel }}，{{ trackSales.length }} 行）</span>
              </template>
              <div class="collapse-body">
                <el-table :resizable="false" :data="trackSales" border size="small" max-height="300">
                  <el-table-column prop="sale_date" label="日期" width="120" />
                  <el-table-column prop="platform" label="平台" width="140" />
                  <el-table-column prop="quantity" label="销量" width="100" align="right" />
                  <el-table-column prop="refund_qty" label="退款" width="100" align="right" />
                  <el-table-column label="实际销量" width="100" align="right">
                    <template #default="{ row }">{{ Number(row.quantity || 0) - Number(row.refund_qty || 0) }}</template>
                  </el-table-column>
                  <el-table-column :label="'单价(' + getCurrencyCode() + ')'" width="110" align="right">
                    <template #default="{ row }">{{ formatMoney(row.unit_price) }}</template>
                  </el-table-column>
                </el-table>
                <div v-if="!trackSales.length" class="track-empty">所选时间范围内暂无销量数据</div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </template>
      </div>
    </el-drawer>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑商品' : '新增商品'" width="720px" destroy-on-close>
      <el-form :model="form" label-width="110px">
        <el-form-item label="可售仓库" required>
          <div style="width: 100%">
            <div
              v-for="(b, bi) in form.bindings"
              :key="b.key"
              style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center; width: 100%"
            >
              <el-select v-model="b.warehouse_id" filterable placeholder="选择仓库" style="flex: 1.4">
                <el-option
                  v-for="w in warehouses"
                  :key="w.id"
                  :label="`${w.name}（${w.code}）${w.wh_type === 'overseas' ? '·海外' : ''}`"
                  :value="w.id"
                  :disabled="form.bindings.some((o: any) => o.key !== b.key && o.warehouse_id === w.id)"
                />
              </el-select>
              <el-input-number v-model="b.sale_price" :min="0" :precision="2" :step="1" placeholder="该仓售价" style="width: 180px" />
              <el-button v-if="form.bindings.length > 1" type="danger" link @click="removeBinding(bi)">移除</el-button>
            </div>
            <el-button type="primary" link @click="addBinding">+ 加绑仓库</el-button>
            <div class="form-tip">商品为公司级主档、编码全库唯一；同一商品可绑定多个仓库售卖，售价按仓库分别维护，采购成本等不区分仓库</div>
          </div>
        </el-form-item>
        <el-form-item label="SKU">
          <el-input v-model="form.sku" placeholder="选填，可后续补充" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="必填" />
        </el-form-item>
        <el-form-item label="图片">
          <el-input v-model="form.image_text" placeholder="粘贴图片URL或点击本地上传" />
          <el-button size="small" style="margin-top: 6px" @click="imageInput?.click()">本地上传</el-button>
          <input ref="imageInput" type="file" accept="image/*" style="display: none" @change="onImageFileChange" />
          <div v-if="isImageUrl(form.image_text)" style="margin-top: 6px; text-align: center">
            <img
              :src="form.image_text"
              style="max-width: 100%; max-height: 100px; border-radius: 4px; border: 1px solid var(--color-border)"
              referrerpolicy="no-referrer"
              @error="onImgError($event)"
            />
          </div>
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
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="选填，商品备注说明" />
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
        <el-form-item label="安全库存">
          <el-input-number v-model="form.safety_stock" :min="0" :precision="0" style="width: 100%" />
          <div class="form-tip">可售库存低于该值将触发低库存预警，0 表示不预警</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ editing ? '保存修改' : '保存' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="batchEditVisible" title="批量编辑商品" width="560px" destroy-on-close>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="将同时对选中的商品应用以下修改，未填写的字段保持不变。售价按仓库维护：列表筛选了仓库则仅作用于该仓库售价，否则作用于商品全部可见绑定仓"
        style="margin-bottom: 16px"
      />
      <el-form label-width="110px">
        <el-form-item label="修改售价">
          <div style="display: flex; gap: 8px; width: 100%">
            <el-select v-model="batchEdit.priceMode" style="width: 140px">
              <el-option label="直接设为" value="fixed" />
              <el-option label="按百分比调整" value="percent" />
            </el-select>
            <el-input-number
              v-model="batchEdit.unitPrice"
              :min="batchEdit.priceMode === 'percent' ? -99 : 0"
              :precision="2"
              :step="batchEdit.priceMode === 'percent' ? 1 : 10"
              placeholder="售价"
              style="flex: 1"
            />
            <span v-if="batchEdit.priceMode === 'percent'" class="form-tip" style="white-space: nowrap">
              %（正涨负降）
            </span>
          </div>
        </el-form-item>
        <el-form-item label="修改分类">
          <el-input v-model="batchEdit.category" placeholder="留空则不修改分类" clearable />
        </el-form-item>
        <el-form-item label="修改状态">
          <el-select v-model="batchEdit.status" clearable placeholder="留空则不修改状态" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
        </el-form-item>
        <el-form-item label="安全库存">
          <el-input-number v-model="batchEdit.safetyStock" :min="0" :precision="0" placeholder="留空则不修改" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchEditing" @click="submitBatchEdit">应用修改</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importWhVisible" title="选择导入仓库" width="460px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon title="批量导入将把商品全部归入所选仓库，同一产品编号已在目标仓库存在时将跳过" style="margin-bottom: 16px" />
      <el-form label-width="90px">
        <el-form-item label="目标仓库" required>
          <el-select v-model="importTargetWarehouseId" filterable placeholder="选择导入目标仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="`${w.name}（${w.code}）`" :value="w.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="importWhVisible = false">取消</el-button>
        <el-button type="primary" @click="chooseFileForImport">下一步：选择文件</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importResultVisible" title="导入结果明细" width="680px" destroy-on-close>
      <div style="max-height: 420px; overflow: auto; font-size: 13px; line-height: 1.8">
        <div
          v-for="(line, i) in importResultLines"
          :key="i"
          :style="{ color: line.startsWith('[失败]') ? '#F56C6C' : '#E6A23C' }"
        >
          {{ line }}
        </div>
        <div v-if="!importResultLines.length" style="color: var(--color-muted)">无明细</div>
      </div>
      <template #footer>
        <el-button @click="importResultVisible = false">关闭</el-button>
        <el-button type="primary" @click="downloadImportResult">下载明细</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="图片预览" width="auto" align-center>
      <div class="preview-box">
        <img :src="previewUrl" class="preview-img" referrerpolicy="no-referrer" @error="onImgError($event)" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, onMounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowUp, Sort } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { api } from '../services/api'
import { formatDateTime as sysFormatDateTime, formatMoney, formatMoneyFrom, getCurrencyCode } from '../utils/system'
import { useAuthStore } from '../stores/auth'
import type { Product } from '../types'
import { buildExportPayload, exportViaServer, todayStr } from '../utils/export'
import { downloadTemplate, readExcelFile, buildColMap, cellStr, cellNum, extractFloatingImages, compressImageDataUrl } from '../utils/import'
import { addLog } from '../utils/log'

const auth = useAuthStore()
const route = useRoute()
const canWrite = computed(() => auth.hasPermission('products.write'))
const canDelete = computed(() => auth.hasPermission('products.delete'))

const rows = ref<Product[]>([])
const total = ref(0)
const loading = ref(false)
const previewVisible = ref(false)
const previewUrl = ref('')
const query = reactive({ page: 1, pageSize: 200, search: '', status: '', warehouse_id: '' })
const rate = ref(0.38)

// 可见仓库：普通账号由后端按角色绑定过滤，super_admin 全量
const warehouses = ref<any[]>([])
const warehousesLoading = ref(false)
async function loadWarehouses() {
  warehousesLoading.value = true
  try {
    const { data } = await api.get('/warehouses')
    warehouses.value = data.data ?? []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载仓库列表失败')
  } finally {
    warehousesLoading.value = false
  }
}
function warehouseName(id: string | null | undefined): string {
  if (!id) return '—'
  return warehouses.value.find((w: any) => w.id === id)?.name || id.slice(0, 8)
}

// 多列排序状态：数组顺序即排序优先级（先点击的为主排序），支持多列同时排序
const sortStates = ref<{ prop: string; order: 'ascending' | 'descending' }[]>([])

// 销量时间范围下拉
const salesRangeKey = ref('all') // all | today | 7d | 15d | 30d | custom
const customSalesRange = ref<[string, string] | null>(null)
const salesFrom = ref('')
const salesTo = ref('')

const salesRangePresets: Record<string, { label: string; from: () => string; to: () => string }> = {
  today: {
    label: '今日',
    from: () => todayStr(),
    to: () => todayStr(),
  },
  '7d': {
    label: '近7天',
    from: () => daysAgoStr(6),
    to: () => todayStr(),
  },
  '15d': {
    label: '近15天',
    from: () => daysAgoStr(14),
    to: () => todayStr(),
  },
  '30d': {
    label: '近30天',
    from: () => daysAgoStr(29),
    to: () => todayStr(),
  },
}

function daysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const salesRangeLabel = computed(() => {
  if (salesRangeKey.value === 'all') return '全部时间'
  if (salesRangeKey.value === 'custom') return customSalesRange.value?.length ? `${customSalesRange.value[0]} ~ ${customSalesRange.value[1]}` : '自定义'
  return salesRangePresets[salesRangeKey.value].label
})

const salesColumnLabel = computed(() => '销量')

function onSalesRangeCommand(cmd: string) {
  if (cmd === 'custom') {
    salesRangeKey.value = 'custom'
    return
  }
  salesRangeKey.value = cmd
  if (cmd === 'all') {
    salesFrom.value = ''
    salesTo.value = ''
    customSalesRange.value = null
  } else {
    salesFrom.value = salesRangePresets[cmd].from()
    salesTo.value = salesRangePresets[cmd].to()
    customSalesRange.value = [salesFrom.value, salesTo.value]
  }
  load()
}

function onDateRangeChange(val: [string, string] | null) {
  if (val && val.length === 2) {
    salesFrom.value = val[0]
    salesTo.value = val[1]
    salesRangeKey.value = 'custom'
  } else {
    salesFrom.value = ''
    salesTo.value = ''
    salesRangeKey.value = 'all'
  }
  load()
}

// 商品跟踪明细（在途批次时间线 + 按天销量 + 趋势图表）
const trackVisible = ref(false)
const trackLoading = ref(false)
const trackData = ref<any>(null)
const trackRow = ref<any>(null)
const trackTitle = computed(() => `商品明细：${trackRow.value?.name || ''}`)
const trackShipFilter = ref('全部')
const trackSalesRange = ref('15d')
const trackOpenPanels = ref<string[]>(['shipments', 'sales'])
// 货物状态字典：与发货管理「状态管理」共用 /api/cargo-statuses，动态同步
const trackCargoStatuses = ref<any[]>([])

const trackRangeDays: Record<string, number> = { '7d': 7, '15d': 15, '30d': 30 }
const trackSalesRangeLabel = computed(() => {
  const map: Record<string, string> = { '7d': '近7天', '15d': '近15天', '30d': '近30天' }
  return map[trackSalesRange.value] || '近15天'
})

const trackShipments = computed(() => {
  const list = trackData.value?.shipments || []
  if (trackShipFilter.value === '全部') return list
  return list.filter((s: any) => s.cargo_status === trackShipFilter.value)
})

// 当期周期销量明细（后端已按时间倒序返回）
const trackSales = computed(() => trackData.value?.sales || [])

// 图表数据
const trackChart = reactive({
  dates: [] as string[],
  cur: [] as number[],
  prev: [] as number[],
  curLabel: '',
  prevLabel: '',
  platforms: [] as { name: string; value: number }[],
  total: 0,
})
const hasLineData = computed(() => trackChart.dates.length > 0)

function openTrack(row: any) {
  trackRow.value = row
  trackShipFilter.value = '全部'
  trackSalesRange.value = '15d'
  trackVisible.value = true
  loadTrack(row.id)
}

function onTrackRangeChange() {
  if (trackRow.value?.id) loadTrack(trackRow.value.id)
}

async function loadTrack(id: string) {
  trackLoading.value = true
  try {
    const days = trackRangeDays[trackSalesRange.value] || 15
    const statTo = todayStr()
    const statFrom = daysAgoStr(days - 1)
    const prevTo = daysAgoStr(days)
    const prevFrom = daysAgoStr(days * 2 - 1)
    const curParams: Record<string, any> = { id, sales_from: statFrom, sales_to: statTo }
    const prevParams: Record<string, any> = { id, sales_from: prevFrom, sales_to: prevTo }
    const [tr, cs, prevTr] = await Promise.all([
      api.get('/products/tracking', { params: curParams }),
      api.get('/cargo-statuses').catch(() => null),
      api.get('/products/tracking', { params: prevParams }).catch(() => null),
    ])
    trackData.value = tr.data.data ?? null
    if (cs?.data?.data?.length) trackCargoStatuses.value = cs.data.data
    buildTrackChart(
      tr.data.data?.sales || [],
      prevTr?.data?.data?.sales || [],
      statFrom,
      statTo,
      prevFrom,
      prevTo,
    )
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载明细失败')
    trackData.value = null
  } finally {
    trackLoading.value = false
  }
}

function netQty(r: any) {
  return Number(r.quantity || 0) - Number(r.refund_qty || 0)
}

function fmtLocalDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const cur = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (cur.getTime() <= end.getTime()) {
    out.push(fmtLocalDate(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function buildTrackChart(curRows: any[], prevRows: any[], statFrom: string, statTo: string, prevFrom: string, prevTo: string) {
  const dates = dateRange(statFrom, statTo)
  const cur = new Array(dates.length).fill(0)
  const prev = new Array(dates.length).fill(0)
  const curMap: Record<string, number> = {}
  const prevMap: Record<string, number> = {}
  for (const r of curRows) {
    const k = r.sale_date
    curMap[k] = (curMap[k] || 0) + netQty(r)
  }
  for (const r of prevRows) {
    const k = r.sale_date
    prevMap[k] = (prevMap[k] || 0) + netQty(r)
  }
  dates.forEach((dt, i) => {
    cur[i] = curMap[dt] || 0
    prev[i] = prevMap[dt] || 0
  })
  const pm: Record<string, number> = {}
  let total = 0
  for (const r of curRows) {
    const nm = r.platform || '未知'
    const v = netQty(r)
    pm[nm] = (pm[nm] || 0) + v
    total += v
  }
  let platforms = Object.keys(pm)
    .map((name) => ({ name, value: pm[name] }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value)
  if (platforms.length > 6) {
    const rest = platforms.slice(5).reduce((s, p) => s + p.value, 0)
    platforms = platforms.slice(0, 5)
    if (rest > 0) platforms.push({ name: '其他', value: rest })
  }
  trackChart.dates = dates
  trackChart.cur = cur
  trackChart.prev = prev
  trackChart.curLabel = `${statFrom} ~ ${statTo}`
  trackChart.prevLabel = `${prevFrom} ~ ${prevTo}`
  trackChart.platforms = platforms
  trackChart.total = total
  nextTick(() => {
    renderLineChart()
    renderBarChart()
  })
}

// ---- 图表渲染（原生 SVG，不依赖图表库） ----
const lineSvgEl = ref<SVGSVGElement | null>(null)
const lineTipEl = ref<HTMLDivElement | null>(null)
const barSvgEl = ref<SVGSVGElement | null>(null)
const barTipEl = ref<HTMLDivElement | null>(null)

const CHART_NS = 'http://www.w3.org/2000/svg'
const CHART_COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#9254de', '#36cfc9', '#909399']

function svgEl(svg: SVGElement, tag: string, attrs: Record<string, string | number>) {
  const node = document.createElementNS(CHART_NS, tag)
  Object.keys(attrs).forEach((k) => node.setAttribute(k, String(attrs[k])))
  svg.appendChild(node)
  return node
}

function moveTip(tip: HTMLDivElement, ev: MouseEvent) {
  const wrap = tip.parentElement
  if (!wrap) return
  const r = wrap.getBoundingClientRect()
  let x = ev.clientX - r.left + 14
  let y = ev.clientY - r.top + 12
  const tw = tip.offsetWidth
  const th = tip.offsetHeight
  if (x + tw > r.width - 4) x = ev.clientX - r.left - tw - 12
  if (y + th > r.height - 4) y = ev.clientY - r.top - th - 10
  tip.style.left = `${x}px`
  tip.style.top = `${y}px`
}

function renderLineChart() {
  const svg = lineSvgEl.value
  const tip = lineTipEl.value
  if (!svg || !tip) return
  svg.innerHTML = ''
  tip.style.display = 'none'
  const dates = trackChart.dates
  const cur = trackChart.cur
  const prev = trackChart.prev
  if (!dates.length) return
  const W = 760
  const H = 240
  const ml = 46
  const mr = 18
  const mt = 16
  const mb = 34
  const pw = W - ml - mr
  const ph = H - mt - mb
  const n = dates.length
  let maxV = 0
  cur.concat(prev).forEach((v) => {
    if (v > maxV) maxV = v
  })
  maxV = Math.max(5, Math.ceil((maxV * 1.15) / 5) * 5)
  const X = (i: number) => (n === 1 ? ml + pw / 2 : ml + (i / (n - 1)) * pw)
  const Y = (v: number) => mt + ph - (v / maxV) * ph
  // 渐变
  const defs = svgEl(svg, 'defs', {})
  const gradBlue = svgEl(defs, 'linearGradient', { id: 'lgBlue', x1: '0', y1: '0', x2: '0', y2: '1' })
  svgEl(gradBlue, 'stop', { offset: '0%', 'stop-color': '#409eff', 'stop-opacity': 0.28 })
  svgEl(gradBlue, 'stop', { offset: '100%', 'stop-color': '#409eff', 'stop-opacity': 0.02 })
  const gradOrange = svgEl(defs, 'linearGradient', { id: 'lgOrange', x1: '0', y1: '0', x2: '0', y2: '1' })
  svgEl(gradOrange, 'stop', { offset: '0%', 'stop-color': '#e6a23c', 'stop-opacity': 0.26 })
  svgEl(gradOrange, 'stop', { offset: '100%', 'stop-color': '#e6a23c', 'stop-opacity': 0.02 })
  // 网格与 Y 轴
  for (let t = 0; t <= 4; t++) {
    const gv = (maxV / 4) * t
    const gy = Y(gv)
    svgEl(svg, 'line', { x1: ml, y1: gy, x2: W - mr, y2: gy, stroke: '#ebeef5', 'stroke-width': 1 })
    const tx = svgEl(svg, 'text', { x: ml - 8, y: gy + 4, 'text-anchor': 'end', fill: '#909399', 'font-size': 11 })
    tx.textContent = String(Math.round(gv))
  }
  // X 轴标签
  const step = Math.max(1, Math.ceil(n / 10))
  for (let i = 0; i < n; i++) {
    if (i % step !== 0 && i !== n - 1) continue
    const tx = svgEl(svg, 'text', { x: X(i), y: H - mb + 16, 'text-anchor': 'middle', fill: '#909399', 'font-size': 11 })
    tx.textContent = dates[i].slice(5)
  }
  const linePath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')
  const areaPath = (vals: number[]) =>
    `${linePath(vals)}L${X(vals.length - 1).toFixed(1)},${(mt + ph).toFixed(1)}L${X(0).toFixed(1)},${(mt + ph).toFixed(1)}Z`
  if (prev.some((v) => v > 0)) {
    svgEl(svg, 'path', { d: areaPath(prev), fill: 'url(#lgOrange)' })
    svgEl(svg, 'path', {
      d: linePath(prev),
      fill: 'none',
      stroke: '#e6a23c',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'stroke-dasharray': '5 4',
    })
  }
  if (cur.some((v) => v > 0)) {
    svgEl(svg, 'path', { d: areaPath(cur), fill: 'url(#lgBlue)' })
    svgEl(svg, 'path', {
      d: linePath(cur),
      fill: 'none',
      stroke: '#409eff',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    })
  }
  // 悬浮提示
  const hot = svgEl(svg, 'rect', { x: ml, y: mt, width: pw, height: ph, fill: 'transparent' })
  hot.addEventListener('mousemove', (ev) => {
    const r = (hot as SVGRectElement).getBoundingClientRect()
    const ratio = r.width / pw
    const rel = ev.clientX - r.left
    // 热区 rect 左边缘即曲线绘图区左边缘（viewBox x=ml），rel/ratio 已是从 ml 起的 viewBox 偏移，无需再减 ml
    const idx = Math.min(n - 1, Math.max(0, Math.round((rel / ratio) / (pw / Math.max(1, n - 1)))))
    svg.querySelectorAll('.h-dot').forEach((d) => d.remove())
    svg.querySelectorAll('.h-line').forEach((d) => d.remove())
    if (prev[idx] > 0 || cur[idx] > 0) {
      svgEl(svg, 'line', { class: 'h-line', x1: X(idx), y1: mt, x2: X(idx), y2: mt + ph, stroke: '#c0c4cc', 'stroke-width': 1, 'stroke-dasharray': '3 3' })
    }
    if (prev[idx] > 0) {
      svgEl(svg, 'circle', { class: 'h-dot', cx: X(idx), cy: Y(prev[idx]), r: 3.5, fill: '#e6a23c', stroke: '#fff', 'stroke-width': 1.5 })
    }
    if (cur[idx] > 0) {
      svgEl(svg, 'circle', { class: 'h-dot', cx: X(idx), cy: Y(cur[idx]), r: 3.5, fill: '#409eff', stroke: '#fff', 'stroke-width': 1.5 })
    }
    tip.innerHTML = `<div style="font-weight:600;color:#303133;margin-bottom:3px">${dates[idx]}</div><div style="display:flex;align-items:center;gap:6px;line-height:1.7"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#409eff"></i>统计周期<b style="font-weight:600;color:#303133">${cur[idx]}</b></div><div style="display:flex;align-items:center;gap:6px;line-height:1.7"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#e6a23c"></i>环比周期<b style="font-weight:600;color:#303133">${prev[idx]}</b></div>`
    tip.style.display = 'block'
    moveTip(tip, ev)
  })
  hot.addEventListener('mouseleave', () => {
    svg.querySelectorAll('.h-dot').forEach((d) => d.remove())
    svg.querySelectorAll('.h-line').forEach((d) => d.remove())
    tip.style.display = 'none'
  })
}

function renderBarChart() {
  const svg = barSvgEl.value
  const tip = barTipEl.value
  if (!svg || !tip) return
  svg.innerHTML = ''
  tip.style.display = 'none'
  const platforms = trackChart.platforms
  if (!platforms.length) return
  const W = 760
  const H = 210
  const ml = 46
  const mr = 16
  const mt = 24
  const mb = 44
  const pw = W - ml - mr
  const ph = H - mt - mb
  const n = platforms.length
  const slotW = pw / n
  let maxV = 0
  platforms.forEach((p) => {
    if (p.value > maxV) maxV = p.value
  })
  maxV = Math.max(1, Math.ceil((maxV * 1.15) / 5) * 5)
  const Y = (v: number) => mt + ph - (v / maxV) * ph
  for (let t = 0; t <= 4; t++) {
    const gv = (maxV / 4) * t
    const gy = Y(gv)
    svgEl(svg, 'line', { x1: ml, y1: gy, x2: W - mr, y2: gy, stroke: '#ebeef5', 'stroke-width': 1 })
    const tx = svgEl(svg, 'text', { x: ml - 8, y: gy + 4, 'text-anchor': 'end', fill: '#909399', 'font-size': 11 })
    tx.textContent = String(Math.round(gv))
  }
  const colorFor = (i: number) => CHART_COLORS[i % CHART_COLORS.length]
  platforms.forEach((p, i) => {
    const cx = ml + slotW * i + slotW / 2
    const bw = Math.max(8, Math.min(64, slotW * 0.6))
    const bh = Y(0) - Y(p.value)
    const color = colorFor(i)
    const rect = svgEl(svg, 'rect', { x: cx - bw / 2, y: Y(p.value), width: bw, height: Math.max(bh, p.value > 0 ? 2 : 0), rx: 3, fill: color })
    if (p.value > 0) {
      const tx = svgEl(svg, 'text', { x: cx, y: Y(p.value) - 5, 'text-anchor': 'middle', fill: '#606266', 'font-size': 12, 'font-weight': 600 })
      tx.textContent = String(p.value)
    }
    const firstLine = p.name.length > 10 ? `${p.name.slice(0, 10)}…` : p.name
    const tx = svgEl(svg, 'text', { x: cx, y: H - mb + 16, 'text-anchor': 'middle', fill: '#606266', 'font-size': 11 })
    tx.textContent = firstLine
    if (p.name.length > 10) {
      const tx2 = svgEl(svg, 'text', { x: cx, y: H - mb + 32, 'text-anchor': 'middle', fill: '#909399', 'font-size': 10 })
      tx2.textContent = p.name.slice(10)
    }
    const pctV = trackChart.total > 0 ? ((p.value / trackChart.total) * 100).toFixed(1) : '0.0'
    rect.addEventListener('mouseenter', (ev) => {
      tip.innerHTML = `<div style="font-weight:600;color:#303133;margin-bottom:3px">${p.name}</div><div style="display:flex;align-items:center;gap:6px;line-height:1.7"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color}"></i>销量<b style="font-weight:600;color:#303133">${p.value}</b></div><div>占比 ${pctV}%</div>`
      tip.style.display = 'block'
      moveTip(tip, ev)
    })
    rect.addEventListener('mousemove', (ev) => moveTip(tip, ev))
    rect.addEventListener('mouseleave', () => {
      tip.style.display = 'none'
    })
  })
}

// 支持全局搜索跳转：/products?search=关键词（MainLayout 顶栏搜索 Ctrl/⌘K）
watch(
  () => route.query.search,
  (v) => {
    const kw = typeof v === 'string' ? v : ''
    if (query.search === kw) return
    query.search = kw
    query.page = 1
    load()
  }
)

function formatDate(v: string) {
  return sysFormatDateTime(v)
}

function money(v: number) {
  return Number.isFinite(v) ? v.toFixed(2) : '0.00'
}

function pct(v: unknown) {
  const n = Number(v ?? 0.165)
  return `${(n * 100).toFixed(1)}%`
}

// 平台利润(元) = (售价比索 - 总成本比索) × 汇率
// 总成本比索 = 货值 + 尾程 + 仓储 + 实操 + 佣金 + 广告 + 扣税 + 补偿
function profit(row: Product) {
  const r = rate.value || 0.38
  const sellingPeso = Number((row as any).sale_price ?? row.unit_price ?? 0)
  const purchase = Number(row.purchase_cost ?? 0)
  const freight = Number(row.first_leg_freight ?? 0)
  const lastMile = Number(row.last_mile_delivery_peso ?? 0)
  const ml = Number(row.ml_commission_rate ?? 0.165) || 0.165
  const taxedPeso = (purchase * 1.13) / r
  const freightPeso = freight / r
  const goodsValue = taxedPeso + freightPeso
  const storage = goodsValue * 0.008
  const operation = goodsValue * 0.05
  const commission = sellingPeso * ml
  const ad = sellingPeso * 0.08
  const tax = sellingPeso * 0.09
  const compensation = sellingPeso * 0.07
  const totalCost = goodsValue + lastMile + storage + operation + commission + ad + tax + compensation
  return (sellingPeso - totalCost) * r
}

function isImageUrl(v: unknown): v is string {
  if (typeof v !== 'string' || !v) return false
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:image/')
}

function onImgError(e: Event) {
  const img = e.target as HTMLImageElement
  img.src =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect fill="#F5F7FA" width="40" height="40"/><text x="20" y="24" text-anchor="middle" font-size="12" fill="#C0C4CC">?</text></svg>'
    )
}

function onPreviewImage(url: string) {
  previewUrl.value = url
  previewVisible.value = true
}

async function load() {
  loading.value = true
  try {
    // pageSize 固定传 0：一次拉取全量商品，排序与分页在前端完成（与销售统计模块一致）
    const params: Record<string, any> = { ...query, pageSize: 0 }
    if (query.warehouse_id) params.warehouse_id = query.warehouse_id
    if (salesFrom.value) params.sales_from = salesFrom.value
    if (salesTo.value) params.sales_to = salesTo.value
    const { data } = await api.get('/products', { params })
    rows.value = data.data ?? []
    total.value = data.total ?? 0
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

// 全量排序 -> 前端分页（多列排序：从最低优先级条件开始稳定排序，主排序条件最后应用保证优先）
const pagedRows = computed(() => {
  let list = rows.value
  if (sortStates.value.length) {
    list = [...list]
    for (let i = sortStates.value.length - 1; i >= 0; i--) {
      const { prop, order } = sortStates.value[i]
      const dir = order === 'ascending' ? 1 : -1
      list.sort((a, b) => {
        const va = (a as any)[prop]
        const vb = (b as any)[prop]
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
        return String(va).localeCompare(String(vb)) * dir
      })
    }
  }
  if (query.pageSize <= 0) return list
  const start = (query.page - 1) * query.pageSize
  return list.slice(start, start + query.pageSize)
})

// 点击表头：未排序 -> 升序 -> 降序 -> 取消；点击其他列追加为下一级排序条件（多列同时生效）
function toggleSort(prop: string) {
  const idx = sortStates.value.findIndex((s) => s.prop === prop)
  if (idx < 0) {
    sortStates.value.push({ prop, order: 'ascending' })
  } else if (sortStates.value[idx].order === 'ascending') {
    sortStates.value[idx].order = 'descending'
  } else {
    sortStates.value = sortStates.value.filter((s) => s.prop !== prop)
  }
  query.page = 1
}

// 排序方向：ascending / descending / 空串
function sortDir(prop: string) {
  const s = sortStates.value.find((x) => x.prop === prop)
  return s ? s.order : ''
}

function onPageChange() {}

function onSizeChange() {
  query.page = 1
}

const dialogVisible = ref(false)
const saving = ref(false)
const editing = ref<Product | null>(null)
const imageInput = ref<HTMLInputElement>()

const emptyForm = () => ({
  bindings: [] as { key: string; warehouse_id: string; sale_price: number }[],
  sku: '',
  name: '',
  code: '',
  barcode: '',
  category: '',
  listing_time: '',
  unit: '套',
  remark: '',
  purchase_cost: 0,
  first_leg_freight: 0,
  last_mile_delivery_peso: 0,
  ml_commission_rate: 0.165,
  shipping_mode: '海运',
  link_id: '',
  competitor_id: '',
  currency: 'MXN',
  status: 'active',
  image_text: '',
  safety_stock: 0,
})
const form = reactive(emptyForm())

// ===== 一货多仓绑定编辑器 =====
let bindKeySeq = 0
function makeBinding(warehouseId = '', salePrice = 0) {
  return { key: `b${++bindKeySeq}`, warehouse_id: warehouseId, sale_price: salePrice }
}
// 默认绑定主仓：优先国内仓中名称含「总仓/中心仓/主仓」，否则首个国内仓；无国内仓取首个可见仓
function primaryMainWarehouseId(): string {
  const ws: any[] = warehouses.value
  const domestic = ws.filter((w) => w.wh_type !== 'overseas')
  const named = domestic.find((w) => /总仓|中心仓|主仓/.test(String(w.name || '')))
  return (named || domestic[0] || ws[0])?.id || ''
}
function addBinding() {
  form.bindings.push(makeBinding('', 0))
}
function removeBinding(i: number) {
  form.bindings.splice(i, 1)
}
function loadBindingsFromDetail(row: Product) {
  // 后端 GET /products/:id 回显 bindings（含按仓 sale_price）；列表行无明细时兜底 warehouse_ids
  const r = row as any
  if (Array.isArray(r.bindings) && r.bindings.length) {
    form.bindings = r.bindings.map((b: any) => makeBinding(b.warehouse_id, Number(b.sale_price ?? 0)))
    return
  }
  const ids = Array.isArray(r.warehouse_ids) && r.warehouse_ids.length ? r.warehouse_ids : r.warehouse_id ? [r.warehouse_id] : []
  form.bindings = ids.map((wid: string) => makeBinding(wid, 0))
}

function openCreate() {
  editing.value = null
  Object.assign(form, emptyForm())
  // 创建默认绑定总仓（主仓）；列表若正筛选某仓库则优先绑定该仓，保证创建后立即可见
  const defWh = query.warehouse_id || primaryMainWarehouseId()
  if (defWh) form.bindings = [makeBinding(defWh, 0)]
  dialogVisible.value = true
}

async function openEdit(row: Product) {
  editing.value = row
  Object.assign(form, emptyForm())
  try {
    const { data } = await api.get(`/products/${row.id}`)
    const detail = (data as any)?.data ?? data
    Object.assign(form, {
      sku: detail.sku || '',
      name: detail.name || '',
      code: detail.code || '',
      barcode: detail.barcode || '',
      category: detail.category || '',
      listing_time: detail.listing_time || '',
      unit: detail.unit || '套',
      remark: detail.remark || '',
      purchase_cost: detail.purchase_cost ?? 0,
      first_leg_freight: detail.first_leg_freight ?? 0,
      last_mile_delivery_peso: detail.last_mile_delivery_peso ?? 0,
      ml_commission_rate: detail.ml_commission_rate ?? 0.165,
      shipping_mode: detail.shipping_mode || '海运',
      link_id: detail.link_id || '',
      competitor_id: detail.competitor_id || '',
      currency: detail.currency || 'MXN',
      status: detail.status || 'active',
      image_text: detail.image_text || '',
      safety_stock: detail.safety_stock ?? 0,
    })
    loadBindingsFromDetail(detail)
    dialogVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载商品详情失败')
  }
}

function onImageFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUrl = String(reader.result || '')
    // 本地图片先压缩（最长边800、质量0.7），避免超大 base64 存入表单
    const compressed = await compressImageDataUrl(dataUrl)
    form.image_text = compressed
  }
  reader.readAsDataURL(file)
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写名称')
    return
  }
  const validBinds = form.bindings.filter((b) => b.warehouse_id)
  if (!editing.value && !validBinds.length) {
    ElMessage.warning('请至少绑定一个可售仓库')
    return
  }
  // 编辑场景允许提交空绑定数组：表示解绑当前账号全部可见绑定
  // （后端保留其它不可见绑定；若全部绑定均已移除则由后端兜底提示）
  if (editing.value && !validBinds.length) {
    const ok = await ElMessageBox.confirm('移除全部可见仓库绑定后，该商品将不再出现在当前仓库视角；若商品仍绑定其它仓库则保留。确定继续？', '解绑全部可见仓库', { type: 'warning', confirmButtonText: '确定解绑', cancelButtonText: '取消' }).catch(() => false)
    if (!ok) return
  }
  saving.value = true
  try {
    // 本地图片（data URL）先上传 Storage 换取公开 URL，避免大 base64 存库
    let imageText = form.image_text.trim()
    if (imageText.startsWith('data:image/')) {
      try {
        const up = await api.post('/products/upload-image', { base64: imageText, sku: form.sku || 'img' })
        imageText = up.data?.url || imageText
      } catch {
        // 上传失败则保留原值，由后端 schema 长度校验兜底提示
      }
    }
    const payload: Record<string, unknown> = {
      sku: form.sku || null,
      name: form.name.trim(),
      code: form.code.trim() || null,
      barcode: form.barcode.trim() || null,
      category: form.category.trim() || null,
      listing_time: form.listing_time.trim() || null,
      unit: form.unit || '套',
      remark: form.remark.trim() || null,
      purchase_cost: form.purchase_cost,
      first_leg_freight: form.first_leg_freight,
      last_mile_delivery_peso: form.last_mile_delivery_peso,
      ml_commission_rate: form.ml_commission_rate,
      shipping_mode: form.shipping_mode,
      link_id: form.link_id.trim() || null,
      competitor_id: form.competitor_id.trim() || null,
      currency: form.currency,
      status: form.status,
      image_text: imageText,
      safety_stock: form.safety_stock,
      // 一货多仓：售价按仓存于绑定行；成本字段留在主档
      warehouse_bindings: validBinds.map((b) => ({ warehouse_id: b.warehouse_id, sale_price: b.sale_price ?? 0 })),
    }
    if (editing.value) {
      await api.patch(`/products/${editing.value.id}`, payload)
      addLog('success', '编辑商品', form.name)
      ElMessage.success('修改成功')
    } else {
      await api.post('/products', payload)
      addLog('success', '新增商品', form.name)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: Product) {
  try {
    await ElMessageBox.confirm(`确定删除商品「${row.sku || row.name}」吗？此操作不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/products/${row.id}`)
    addLog('success', '删除商品', row.sku || row.name)
    ElMessage.success('删除成功')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
}

const selected = ref<Product[]>([])
function onSelectionChange(rows: Product[]) {
  selected.value = rows
}

const batchEditVisible = ref(false)
const batchEditing = ref(false)
const batchEdit = reactive({
  priceMode: 'fixed' as 'fixed' | 'percent',
  unitPrice: undefined as number | undefined,
  category: '',
  status: '' as '' | 'active' | 'inactive',
  safetyStock: undefined as number | undefined,
})
function openBatchEdit() {
  if (!selected.value.length) return
  Object.assign(batchEdit, {
    priceMode: 'fixed',
    unitPrice: undefined,
    category: '',
    status: '',
    safetyStock: undefined,
  })
  batchEditVisible.value = true
}
async function submitBatchEdit() {
  const patch: Record<string, unknown> = {}
  if (batchEdit.unitPrice !== undefined && batchEdit.unitPrice !== null) {
    patch.unit_price = batchEdit.unitPrice
  }
  if (batchEdit.category && batchEdit.category.trim()) {
    patch.category = batchEdit.category.trim()
  }
  if (batchEdit.status) patch.status = batchEdit.status
  if (batchEdit.safetyStock !== undefined && batchEdit.safetyStock !== null) {
    patch.safety_stock = batchEdit.safetyStock
  }
  if (!Object.keys(patch).length) {
    ElMessage.warning('请至少填写一项要修改的内容')
    return
  }
  batchEditing.value = true
  try {
    const { data } = await api.post('/products/batch-edit', {
      ids: selected.value.map((r) => r.id),
      patch,
      price_mode: patch.unit_price !== undefined ? batchEdit.priceMode : 'fixed',
      // 列表已筛选仓库时，改价仅作用于该仓库的绑定行售价
      warehouse_id: query.warehouse_id || undefined,
    })
    ElMessage.success(
      `批量编辑完成：成功 ${data.updated} 条${data.missing ? `，未找到 ${data.missing} 条` : ''}`
    )
    addLog('info', '批量编辑商品', `成功 ${data.updated} 条`)
    batchEditVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '批量编辑失败')
  } finally {
    batchEditing.value = false
  }
}

const exporting = ref(false)
function onExportCmd(cmd: string) {
  exportRows(cmd === 'images')
}

async function exportRows(withImages = false) {
  const columns = [
    { key: 'code', label: '产品编号' },
    { key: 'name', label: '名称' },
    { key: 'link_id', label: '链接ID' },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: '条形码' },
    { key: 'unit', label: '单位' },
    { key: 'remark', label: '备注' },
    { key: 'domestic_stock', label: '国内库存' },
    { key: 'overseas_stock', label: '国外库存' },
    { key: 'in_transit_qty', label: '在途数量' },
    { key: 'sales_qty', label: '销量' },
    { key: 'unit_price', label: '售价', value: (r: Product) => formatMoney((r as any).sale_price ?? r.unit_price) },
    { key: 'purchase_cost', label: '不含税采购成本', value: (r: Product) => formatMoneyFrom(r.purchase_cost, r.currency || 'MXN') },
    { key: 'first_leg_freight', label: '头程运费', value: (r: Product) => formatMoneyFrom(r.first_leg_freight, r.currency || 'MXN') },
    { key: 'last_mile_delivery_peso', label: '尾程派送(比索)', value: (r: Product) => formatMoney(r.last_mile_delivery_peso) },
    { key: 'ml_commission_rate', label: 'ML佣金比例', value: (r: Product) => pct(r.ml_commission_rate) },
    {
      key: 'image_text',
      label: '图片',
      value: (r: Product) => (isImageUrl(r.image_text) ? r.image_text : ''),
    },
  ]
  exporting.value = true
  try {
    const payload = buildExportPayload({
      rows: rows.value,
      columns,
      withImages,
      imageKeys: ['image_text'],
    })
    await exportViaServer(`商品列表_${todayStr()}.xlsx`, payload, withImages)
    addLog('info', '导出商品', `共 ${rows.value.length} 条`)
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
      `确定删除选中的 ${selected.value.length} 个商品吗？此操作不可恢复。`,
      '批量删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const ids = selected.value.map((r) => r.id)
  try {
    const { data } = await api.post('/products/batch-delete', { ids })
    ElMessage.success(
      `删除完成：成功 ${data.deleted} 条${data.missing ? `，未找到 ${data.missing} 条` : ''}`
    )
    addLog('info', '批量删除商品', `成功 ${data.deleted} 条${data.missing ? `，未找到 ${data.missing} 条` : ''}`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '删除失败')
  }
  selected.value = []
  load()
}

/* ---------- 下载模板 / 批量导入 ---------- */
const importing = ref(false)
const importFile = ref<HTMLInputElement>()
const importResultVisible = ref(false)
const importResultLines = ref<string[]>([])
// 批量导入目标仓库：仅当前账号可见仓库 >1 时需用户先选，单一仓库自动使用
const importWhVisible = ref(false)
const importTargetWarehouseId = ref('')

function downloadImportResult() {
  const content = '\ufeff' + importResultLines.value.join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `导入结果明细_${todayStr()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadTpl() {
  downloadTemplate(
    [
      { label: 'SKU', sample: 'SKU-NEW-001' },
      { label: '名称', sample: '示例商品' },
      { label: '产品编号', sample: 'LC-2026-001' },
      { label: '条形码', sample: '6901234567890' },
      { label: '分类', sample: '家居' },
      { label: '上新时间', sample: '2026-08' },
      { label: '单位', sample: '套' },
      { label: '备注', sample: '主图白底，包装含说明书' },
      { label: '售价', sample: 329 },
      { label: '采购成本', sample: 120 },
      { label: '头程运费', sample: 15 },
      { label: '尾程派送(比索)', sample: 0 },
      { label: '佣金率', sample: 0.165 },
      { label: '运输方式', sample: '海运' },
      { label: '链接ID', sample: 'M20260815' },
      { label: '竞品ID', sample: '' },
      { label: '币种', sample: 'MXN' },
      { label: '状态', sample: '启用' },
      { label: '图片链接', sample: '' },
    ],
    '商品导入模板',
    '商品批量导入模板.xlsx'
  )
}

function triggerImport() {
  if (!warehouses.value.length) {
    ElMessage.error('当前无可用的仓库，请先到「系统设置-仓库管理」创建仓库后再导入')
    return
  }
  if (warehouses.value.length > 1) {
    importTargetWarehouseId.value = ''
    importWhVisible.value = true
    return
  }
  importTargetWarehouseId.value = warehouses.value[0].id
  importFile.value?.click()
}

function chooseFileForImport() {
  if (!importTargetWarehouseId.value) {
    ElMessage.warning('请先选择目标仓库')
    return
  }
  importWhVisible.value = false
  importFile.value?.click()
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!importTargetWarehouseId.value) {
    ElMessage.error('未选择导入目标仓库，请重新点击「批量导入」')
    return
  }
  importing.value = true
  try {
    const fileAb = await file.arrayBuffer()
    const { headers, rows } = await readExcelFile(file)
    const cellImages = await extractFloatingImages(fileAb)
    const col = buildColMap(headers, {
      sku: ['SKU', 'sku', '编码'],
      name: ['名称', 'name', '商品名称'],
      code: ['产品编号', 'code', 'listing code'],
      barcode: ['条形码', 'barcode', '条码'],
      category: ['分类', 'category'],
      listing_time: ['上新时间', 'listing_time'],
      unit: ['单位', 'unit'],
      remark: ['备注', 'remark'],
      unit_price: ['售价', 'unit_price', '价格'],
      purchase_cost: ['采购成本', 'purchase_cost'],
      first_leg_freight: ['头程运费', 'first_leg_freight'],
      last_mile_delivery_peso: ['尾程派送(比索)', '尾程派送', 'last_mile_delivery_peso'],
      ml_commission_rate: ['佣金率', 'ml_commission_rate'],
      shipping_mode: ['运输方式', 'shipping_mode', '空海运'],
      link_id: ['链接ID', 'link_id'],
      competitor_id: ['竞品ID', 'competitor_id'],
      currency: ['币种', 'currency'],
      status: ['状态', 'status'],
      image_text: ['图片链接', 'image_text', '图片'],
    })
    if (col.code === undefined || col.name === undefined) {
      ElMessage.error('模板表头不识别，请使用下载的模板文件，确保包含"产品编号"和"名称"列')
      return
    }
    // 054 编码全库唯一：拉取当前账号可见商品编码全集（不再按目标仓过滤），避免重复创建；后端冲突仍有兜底
    const whId = importTargetWarehouseId.value
    const exist = new Set<string>()
    let page = 1
    for (;;) {
      const { data } = await api.get('/products', { params: { page, pageSize: 200 } })
      ;(data.data ?? []).forEach((p: any) => {
        if (p.code) exist.add(p.code)
      })
      if (page * 200 >= (data.total ?? 0)) break
      page++
    }
    const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
    const seen = new Set<string>()
    const skipLines: string[] = []
    const items: { payload: Record<string, unknown>; lineNo: number; code: string }[] = []
    rows.forEach((row, idx) => {
      const lineNo = idx + 2
      const code = cut(cellStr(row, col.code), 255)
      const name = cut(cellStr(row, col.name), 200)
      const sku = cut(cellStr(row, col.sku), 200)
      if (!code) {
        skipLines.push(`第${lineNo}行：产品编码为空`)
        return
      }
      if (!name) {
        skipLines.push(`第${lineNo}行：名称为空`)
        return
      }
      if (exist.has(code) || seen.has(code)) {
        skipLines.push(`第${lineNo}行：产品编码「${code}」已存在，跳过`)
        return
      }
      seen.add(code)
      // 佣金率宽容处理：>1 视为百分数（如 16.5 -> 0.165），越界回默认
      let ml = col.ml_commission_rate !== undefined ? cellNum(row, col.ml_commission_rate, 0.165) : 0.165
      if (ml > 1) ml = ml / 100
      if (ml < 0 || ml > 1) ml = 0.165
      const statusRaw = cellStr(row, col.status)
      const urlText = cut(cellStr(row, col.image_text), 255)
      // 浮动图片：Excel 行号（0-based）= idx + 1（表头行=0，首条数据行=1）
      const floatImg = cellImages?.[idx + 1] ? Object.values(cellImages[idx + 1])[0] : ''
      items.push({
        payload: {
          sku: sku || null,
          name,
          code,
          barcode: cut(cellStr(row, col.barcode), 64),
          category: cut(cellStr(row, col.category), 100),
          listing_time: cut(cellStr(row, col.listing_time), 255),
          unit: cut(cellStr(row, col.unit) || '套', 50),
          remark: cut(cellStr(row, col.remark), 1000),
          // 一货多仓：售价按仓存于绑定行，导入商品默认绑定目标仓并按表内售价定价
          warehouse_bindings: [
            { warehouse_id: whId, sale_price: col.unit_price !== undefined ? cellNum(row, col.unit_price) : 0 },
          ],
          purchase_cost: col.purchase_cost !== undefined ? cellNum(row, col.purchase_cost) : 0,
          first_leg_freight: col.first_leg_freight !== undefined ? cellNum(row, col.first_leg_freight) : 0,
          last_mile_delivery_peso:
            col.last_mile_delivery_peso !== undefined ? cellNum(row, col.last_mile_delivery_peso) : 0,
          ml_commission_rate: ml,
          shipping_mode: cut(cellStr(row, col.shipping_mode) || '海运', 20),
          link_id: cut(cellStr(row, col.link_id), 255),
          competitor_id: cut(cellStr(row, col.competitor_id), 255),
          currency: cut(cellStr(row, col.currency) || 'MXN', 8),
          status: statusRaw === '停用' || statusRaw === 'inactive' ? 'inactive' : 'active',
          image_text: urlText || '',
          image_base64: floatImg && !urlText ? floatImg : '',
        },
        lineNo,
        code,
      })
    })
    // 分批并行创建：按批次首元素是否有图动态切批——无图每批 50 条并发，含图每批 20 条（避免大请求体触发 Vercel 限制），失败逐条记录完整原因
    let ok = 0
    const errLines: string[] = []
    for (let i = 0; i < items.length; ) {
      const hasImg = Boolean(items[i].payload.image_base64)
      const BATCH = hasImg ? 20 : 50
      const batch = items.slice(i, i + BATCH)
      await Promise.all(
        batch.map(async (item) => {
          try {
            await api.post('/products', item.payload)
            ok++
          } catch (err: any) {
            errLines.push(
              `第${item.lineNo}行 产品编码 ${item.code}：${err?.response?.data?.error?.message || err?.message || '创建失败'}`
            )
          }
        })
      )
      i += BATCH
    }
    const summary = `导入完成：成功 ${ok} 条${skipLines.length ? `，跳过 ${skipLines.length} 条` : ''}${
      errLines.length ? `，失败 ${errLines.length} 条` : ''
    }`
    ElMessage.success(summary)
    addLog('info', '批量导入商品', summary)
    if (skipLines.length || errLines.length) {
      importResultLines.value = [
        ...skipLines.map((s) => `[跳过] ${s}`),
        ...errLines.map((s) => `[失败] ${s}`),
      ]
      importResultVisible.value = true
    }
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

onMounted(() => {
  // 首次挂载时读取 URL 搜索参数（如顶栏全局搜索跳转带入）
  const kw = typeof route.query.search === 'string' ? route.query.search : ''
  if (kw) query.search = kw
  load()
  loadWarehouses()
})
</script>

<style scoped>
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
/* 固定右列（操作列）不透明背景：滚动时不再透出下层数据（仅数据单元格，表头保持原样） */
.table-wrap :deep(.el-table__body .el-table-fixed-column--right) {
  background: #fff !important;
}
html.dark .table-wrap :deep(.el-table__body .el-table-fixed-column--right) {
  background: #1e2438 !important;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.page-header .profit-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  border-radius: 0;
}
.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
/* 强制日期范围选择器宽度为 200px，避免 Element Plus 默认宽度撑开 */
.filters :deep(.el-date-editor--daterange) {
  width: 200px !important;
  flex-shrink: 0;
}
.filters :deep(.el-date-editor--daterange .el-range-input) {
  min-width: 0;
}
.filters :deep(.el-date-editor--daterange .el-range-separator) {
  padding: 0 2px;
}
.profit-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 8px);
  background: var(--color-card);
}
.profit-label {
  font-size: 13px;
  color: var(--color-muted);
  white-space: nowrap;
}
.profit-tip {
  font-size: 12px;
  color: var(--color-muted);
}
.profit-pos {
  color: #16a34a;
  font-weight: 600;
}
.profit-neg {
  color: #dc2626;
  font-weight: 600;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
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
.product-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  vertical-align: middle;
}
.img-preview {
  max-width: 280px;
  max-height: 280px;
  display: block;
}
.preview-box {
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.preview-img {
  max-width: 100px;
  max-height: 100px;
  object-fit: contain;
  display: block;
}
.img-text-cell {
  font-size: 12px;
  color: var(--color-muted);
  max-width: 80px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.img-fallback {
  width: 56px;
  height: 56px;
  line-height: 56px;
  text-align: center;
  color: var(--color-muted);
  background: var(--color-fill);
  border-radius: 4px;
  font-size: 12px;
}
.sales-range-active {
  color: var(--accent, var(--el-color-primary));
  font-weight: 600;
}
.sortable-header {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}
.sortable-header:hover {
  color: var(--el-color-primary, #409eff);
}
.sort-icon {
  font-size: 14px;
  color: #c0c4cc;
  transition: color 0.2s;
}
.sort-icon.active {
  color: var(--el-color-primary, #409eff);
}
.sortable-header:hover .sort-icon {
  color: var(--el-color-primary, #409eff);
}
.profit-pos {
  color: #67c23a;
  font-weight: 600;
}
.profit-neg {
  color: #f56c6c;
  font-weight: 600;
}
.track-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.track-filter-label {
  font-size: 13px;
  color: #606266;
}
.track-summary {
  margin-bottom: 12px;
}
.track-section-title {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.track-empty {
  padding: 16px 0;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
  border: 1px dashed var(--color-border, #dcdfe6);
  border-radius: 4px;
}

/* ===== 商品跟踪图表（原生 SVG 卡片） ===== */
.track-filter-hint {
  font-size: 12px;
  color: #909399;
  margin-left: 10px;
}
.chart-card {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}
.chart-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.chart-legend {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #606266;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.chart-wrap {
  position: relative;
  width: 100%;
}
.chart-wrap svg {
  display: block;
  width: 100%;
  height: auto;
}
.chart-tip {
  position: absolute;
  display: none;
  pointer-events: none;
  z-index: 30;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.14);
  padding: 7px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #606266;
  white-space: nowrap;
  top: 0;
  left: 0;
}
.chart-empty {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.55);
  z-index: 2;
}
.track-collapse {
  margin-bottom: 6px;
  border-top: none;
}
.track-collapse :deep(.el-collapse-item__header) {
  font-size: 13px;
}
.collapse-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.collapse-body {
  padding: 4px 2px 8px;
}
.track-drawer .el-drawer__body {
  padding-bottom: 18px;
}

</style>