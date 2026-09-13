// 审计日志字段中文化：系统设置（Settings.vue - 审计日志页签）与操作日志（Logs.vue - 服务端审计日志）
// 共用同一份映射，避免两处各写一份导致「只改了一处、另一处仍显示英文」。
// 未登记的动作 / 对象一律回退展示原文，不丢信息。

// 动作英文 -> 中文
export const ACTION_LABELS: Record<string, string> = {
  create: '新增',
  update: '更新',
  delete: '删除',
  login: '登录',
  logout: '登出',
  import: '导入',
  export: '导出',
  received: '收货',
  update_profile: '更新资料',
  adjust_inventory: '库存调整',
  batch_delete: '批量删除',
  batch_edit: '批量编辑',
  batch_stock: '批量改库存',
  restore: '恢复',
  purge: '彻底删除',
  audit: '审核',
  snapshot: '生成快照',
  export_backup: '导出备份',
  update_site_logo: '更新站点标识',
}

// 对象英文 -> 中文
export const RESOURCE_LABELS: Record<string, string> = {
  auth: '登录',
  product: '商品',
  products: '商品',
  shipment: '发货单',
  purchase_order: '采购单',
  sales_order: '销售单',
  inventory: '库存',
  stocktake: '盘点单',
  transfer: '调拨单',
  after_sale: '售后单',
  after_sale_type: '售后类型',
  replenishment_order: '补货单',
  replenishment_unarrived_snapshots: '补货未到快照',
  daily_sales: '日销',
  cargo_status: '货运状态',
  warehouse: '仓库',
  user: '用户',
  role: '角色',
  forwarder: '货代',
  system: '系统',
  system_setting: '系统设置',
  system_settings: '系统设置',
}

export function actionLabel(action: string | null | undefined): string {
  const key = String(action || '').trim()
  if (!key) return '-'
  return ACTION_LABELS[key] || ACTION_LABELS[key.toLowerCase()] || key
}

export function resourceLabel(type: string | null | undefined): string {
  const key = String(type || '').trim()
  if (!key) return '-'
  return RESOURCE_LABELS[key] || RESOURCE_LABELS[key.toLowerCase()] || key
}

export function resourceText(row: any): string {
  const label = resourceLabel(row?.resource_type)
  const id = row?.resource_id ? String(row.resource_id) : ''
  return id ? `${label} #${id}` : label
}

// 操作人：优先账号邮箱；历史记录缺邮箱时回退账号 ID 短值；两者都没有显示 "-"
export function actorText(row: any): string {
  const email = String(row?.user_email || '').trim()
  if (email) return email
  const uid = String(row?.user_id || '').trim()
  return uid ? uid.slice(0, 8) : '-'
}
