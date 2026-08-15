// 全局类型定义

export type UUID = string

export interface BaseEntity {
  id: UUID
  created_at: string
  updated_at: string
}

export interface Profile extends BaseEntity {
  email: string
  display_name: string | null
  warehouse_id: UUID | null
}

export interface Role extends BaseEntity {
  name: string
  description: string | null
}

export interface Permission extends BaseEntity {
  name: string
  description: string | null
}

export interface Product extends BaseEntity {
  sku: string
  name: string
  barcode: string | null
  category: string | null
  unit_price: number
  currency: string
  status: string
  // 老系统 listings 业务字段
  code: string | null
  listing_time: string | null
  image_text: string | null
  link_id: string | null
  unit: string | null
  competitor_id: string | null
  shipping_mode: string | null
  purchase_cost: number | null
  first_leg_freight: number | null
  last_mile_delivery_peso: number | null
  ml_commission_rate: number | null
}

export interface Warehouse extends BaseEntity {
  code: string
  name: string
  address: string | null
}

export interface InventoryTransaction {
  id: UUID
  product_id: UUID
  warehouse_id: UUID
  type: string
  quantity: number
  before_quantity: number
  after_quantity: number
  reference_type: string | null
  reference_id: UUID | null
  created_by: UUID
  created_at: string
}

export type ApiError = {
  code: string
  message: string
}
