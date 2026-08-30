---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 0407e8e3d987d087c85f0d8325c2f820_44d040d7a3cb11f192a2525400287e28
    ReservedCode1: imCjGWS8Zq1lDl25uuMj6dzFM2iMk0XfboWK9YxCI70OPiK9Y7y59txdbVnVVQnMmurFU6cw1to8ghJey7VdhQEXSArmA8uJrGemJaKa2zixO90q4WoIZlH7kI/YD137yTJF/7DQTQhBKwMLMFyRvmNMUq1/ra6ld380RBtxqQfhTyrWINydg30OS3E=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 0407e8e3d987d087c85f0d8325c2f820_44d040d7a3cb11f192a2525400287e28
    ReservedCode2: imCjGWS8Zq1lDl25uuMj6dzFM2iMk0XfboWK9YxCI70OPiK9Y7y59txdbVnVVQnMmurFU6cw1to8ghJey7VdhQEXSArmA8uJrGemJaKa2zixO90q4WoIZlH7kI/YD137yTJF/7DQTQhBKwMLMFyRvmNMUq1/ra6ld380RBtxqQfhTyrWINydg30OS3E=
---

# cb-erp 数据字典（Data Dictionary）

> 版本：v1.0（P2 数据补齐产出）
> 适用数据库：Supabase（PostgreSQL）
> 说明：本文档面向 AI 接入 / 数据开发 / 数据分析，列出核心表的字段、类型、含义、来源、更新频率与常见脏数据。字段未列出的表可按需补充。

## 0. 总览

| 表名 | 模块 | 主键 | 唯一约束 / 索引要点 | 更新频率 |
|---|---|---|---|---|
| products | 商品 | id (uuid) | sku unique；code 唯一索引（020）；category/barcode 索引 | 手工维护，低 |
| daily_sales | 销售统计（导入） | id (uuid) | **唯一 (sale_date, platform, link_id)**（030）；sale_date/link_id 索引（030/038）；date+platform、date+ad_group 索引（048） | 每日导入/增量，高 |
| exchange_rate_history | 汇率历史（**P2 新增**） | id (uuid) | **唯一 (currency, date)**（047）；date/currency 索引 | 同步脚本批量写入，低-中 |
| warehouses | 仓库 | id (uuid) | code unique | 手工维护，低 |
| inventory | 库存 | id (uuid) | 唯一 (product_id, warehouse_id)；product/warehouse 索引 | 单据流转实时更新，高 |
| inventory_transactions | 库存流水 | id (uuid) | product/warehouse/created_at 索引 | 单据流转实时追加，高 |
| sales_orders / sales_order_items | 销售订单 | id (uuid) | order_no unique；created_at/status 索引 | 手工/导入，中 |
| shipments / shipment_items | 发货单（含调拨发货） | id (uuid) | tracking_no unique；status/forwarder/source 索引 | 手工维护，中 |
| after_sales / after_sale_items | 售后单 | id (uuid) | order_no unique；status 索引 | 手工维护，中 |
| purchase_orders / purchase_order_items | 采购单 | id (uuid) | order_no unique；status 索引 | 手工维护，中 |
| replenishment_orders / replenishment_order_items | 补货单 | id (uuid) | order_no unique；status 索引 | 手工维护，中 |
| stocktakes / stocktake_items | 库存盘点 | id (uuid) | stocktake_no unique；status/warehouse 索引 | 盘点批次写入，低 |
| forwarders | 货代 | id (uuid) | name unique；is_active 索引 | 手工维护，低 |
| cargo_statuses | 货物状态 | id (uuid) | — | 手工维护，低 |
| after_sale_types | 售后类型 | id (uuid) | — | 手工维护，低 |
| profiles | 用户档案 | id (uuid, 关联 auth.users) | — | 注册/编辑，低 |
| roles / permissions / role_permissions / user_roles | RBAC | id / 复合主键 | name/code unique | 种子+维护，低 |
| audit_logs | 审计日志 | id (uuid) | user/created_at/resource 索引 | 写操作实时追加，高 |
| system_settings | 系统设置 | key (text) | key primary key | 手工配置，低 |

---

## 1. products（商品）

| 字段 | 类型 | 含义 | 来源 | 常见脏数据 |
|---|---|---|---|---|
| id | uuid PK | 商品 ID | 系统生成 | — |
| sku | text NOT NULL UNIQUE | SKU 编码 | 录入/导入 | 首尾空格、大小写混用造成"看似重复"；空值（020 唯一约束会拦截真重复） |
| name | text NOT NULL | 商品名称 | 录入/导入 | 空字符串 |
| barcode | text | 条码 | 录入 | 空 |
| code | text | 老系统商品编码 | 015 迁移 | 空串、前后空格 |
| category | text | 分类 | 录入 | 空/分类不统一 |
| unit_price | numeric(18,2) | 单价 | 录入 | 为 0（新品未定价） |
| currency | text | 币种，默认 MXN（015 起） | 录入 | 未设置时默认 MXN |
| status | text | active/inactive | 录入 | — |
| listing_time | text | 上架时间（文本） | 015 迁移 | 空 |
| image_text | text | 图片/文案备注 | 015 迁移 | 空 |
| link_id | text | 平台商品链接 ID | 015 迁移 | **空值、首尾空格、大小写混用**（P2 关注） |
| unit | text | 单位，默认 '套' | 015 迁移 | 空 |
| competitor_id | text | 竞品 ID | 015 迁移 | 空 |
| shipping_mode | text | 运输方式，默认 '海运' | 015 迁移 | 空 |
| purchase_cost | numeric(18,2) | 采购成本 | 录入/导入 | **NULL/0/负数**（成本利润失真，P2 重点） |
| first_leg_freight | numeric(18,2) | 头程运费 | 录入 | 0 |
| last_mile_delivery_peso | numeric(18,2) | 尾程派送费（比索） | 录入 | 0 |
| ml_commission_rate | numeric(5,4) | 平台佣金率，默认 0.165 | 录入 | 0（未配置） |
| length_cm / width_cm / height_cm | numeric | 长宽高（cm） | 039 录入 | 0（未填） |
| weight_kg | numeric | 实重（KG） | 039 录入 | 0（未填） |
| air_freight / sea_freight | numeric | 空运/海运运费（独立列，不参与总成本） | 039 录入 | 0 |
| add_fee | numeric | 附加费（比索，参与总成本） | 039 录入 | 0 |
| platform_profit | numeric | 平台利润（元，成本利润表写回） | 039 计算写回 | 0/未计算 |
| overseas_stock | numeric(18,2) | 海外库存（平台快照） | 029 批量导入写回 | 0（平台未同步） |
| safety_stock | numeric | 安全库存阈值 | 044 录入 | 0（未设置） |
| remark | text | 备注 | 041 | — |
| deleted_at | timestamptz | 软删除标记（回收站） | 036 | NULL=正常 |
| created_at / updated_at | timestamptz | 创建/更新时间 | 系统 | — |

---

## 2. daily_sales（每日销售统计，导入表）

> 核心：**不建销售单**，每日导入的历史平台分析数据写此表；唯一约束 `(sale_date, platform, link_id)`，同键重复导入按"增量累加/覆盖"处理（P0 已实现幂等，见 §7 注意事项）。

| 字段 | 类型 | 含义 | 来源 | 常见脏数据 |
|---|---|---|---|---|
| id | uuid PK | 行 ID | 系统 | — |
| sale_date | date NOT NULL | 销售日期 | 导入 | 日期格式不统一（导入时已校验） |
| platform | text NOT NULL DEFAULT '' | 平台/站点 | 导入 | **空串、首尾空格**（P2 治理） |
| link_id | text NOT NULL | 商品链接 ID | 导入 | **空串、首尾空格**（P2 治理） |
| product_id | uuid | 关联商品（可空） | 匹配/导入 | 空（未匹配商品） |
| product_name | text | 商品名称快照 | 导入 | 空 |
| quantity | numeric(18,2) | 销量 | 导入/增量累加 | 0、重复导入累加（P0 幂等已防） |
| unit_price | numeric(18,2) | 单价 | 导入 | 0 |
| overseas_stock | numeric(18,2) | 海外库存快照 | 导入 | 0 |
| refund_qty | numeric(18,2) | 退款数量（031） | 导入 | 0 |
| refund_amount | numeric(18,2) | 退款金额（031） | 导入 | 0 |
| ad_group | text | 广告组（**048 P2 新增**） | 导入 | 空 |
| created_at / updated_at | timestamptz | 创建/更新时间 | 系统 | — |

---

## 3. exchange_rate_history（汇率历史，P2 新增）

> 设计：汇率查询"**有表数据优先用表，缺失再实时拉取并回填**"（已接入 `server/_handlers/exchange-rates.ts`）。

| 字段 | 类型 | 含义 | 来源 | 常见脏数据 |
|---|---|---|---|---|
| id | uuid PK | 行 ID | 系统 | — |
| currency | text NOT NULL | 币种代码（大写，如 USD/CNY/MXN） | 同步脚本（frankfurter.app） | 大小写混用 |
| rate | numeric(18,6) | 汇率（相对 USD 基准：1 USD = rate 本币） | 同步脚本 | 0/负值（脚本已过滤） |
| date | date NOT NULL | 汇率日期 | 同步脚本 | 周末/节假日无 ECB 数据（跳过） |
| source | text NOT NULL DEFAULT 'frankfurter.app' | 数据来源 | 同步脚本 | — |
| created_at / updated_at | timestamptz | 创建/更新时间 | 系统 | — |

初始化/同步命令：

```bash
node scripts/sync-exchange-rates.mjs --from 2025-01-01 --to 2025-12-31
node scripts/sync-exchange-rates.mjs --days 90
```

---

## 4. warehouses / inventory / inventory_transactions

### warehouses
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 仓库 ID |
| code | text NOT NULL UNIQUE | 仓库编码 |
| name | text NOT NULL | 仓库名称 |
| address | text | 地址 |
| created_at / updated_at | timestamptz | 时间戳 |

### inventory
| 字段 | 类型 | 含义 | 常见脏数据 |
|---|---|---|---|
| id | uuid PK | 库存行 ID | — |
| product_id | uuid NOT NULL FK | 商品 | — |
| warehouse_id | uuid NOT NULL FK | 仓库 | — |
| quantity | numeric | 当前库存（>=0） | 负数（历史遗留，046 后已拦截） |
| reserved_quantity | numeric | 预留库存（>=0） | — |
| created_at / updated_at | timestamptz | 时间戳 | — |

### inventory_transactions（库存流水，只追加）
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 流水 ID |
| product_id / warehouse_id | uuid FK | 商品/仓库 |
| type | text | purchase_in / sales_out / transfer_out / transfer_in / adjustment / after_sales_in / loss / other / stocktake_in / stocktake_out |
| quantity | numeric | 变动数量（正负号表示入/出） |
| before_quantity / after_quantity | numeric | 变动前后库存 |
| reference_type / reference_id | text/uuid | 关联单据类型与 ID |
| created_by | uuid FK | 操作人 |
| note | text | 备注 |
| created_at | timestamptz | 时间 |

---

## 5. sales_orders / sales_order_items（销售订单）

### sales_orders
| 字段 | 类型 | 含义 | 常见脏数据 |
|---|---|---|---|
| id | uuid PK | 订单 ID | — |
| order_no | text NOT NULL UNIQUE | 订单号 | — |
| customer_id | uuid | 客户 ID（当前未建客户表，可空） | 空 |
| status | text | DRAFT/CONFIRMED/PAID/PROCESSING/SHIPPED/DELIVERED/CANCELLED | 大小写混用 |
| currency | text | 币种，默认 CNY | — |
| total_amount | numeric(18,2) | 总额（>=0） | 0（草稿未结算） |
| sale_date | date | 销售日期（029） | 空（历史单） |
| platform | text | 平台（029） | 空 |
| created_by / created_at / updated_at | uuid/timestamptz | 操作人/时间 | — |
| deleted_at | timestamptz | 软删除 | NULL=正常 |

### sales_order_items
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 明细 ID |
| order_id | uuid NOT NULL FK | 所属订单（级联删除） |
| product_id | uuid FK（029 起可空） | 商品（可空=未匹配） |
| sku | text NOT NULL | SKU 快照 |
| product_name | text | 商品名称快照（029） |
| quantity | numeric | 数量（>0） |
| unit_price / discount / subtotal | numeric(18,2) | 单价/折扣/小计（>=0） |
| created_at / updated_at | timestamptz | 时间戳 |

---

## 6. shipments / shipment_items（发货单，含调拨发货）

### shipments
| 字段 | 类型 | 含义 | 常见脏数据 |
|---|---|---|---|
| id | uuid PK | 发货单 ID | — |
| tracking_no | text NOT NULL UNIQUE | 物流单号 | — |
| status | text | PENDING/SHIPPED/IN_TRANSIT/DELIVERED/CANCELLED | 大小写混用 |
| carrier | text | 承运商 | 空 |
| forwarder_id | uuid FK | 货代（017） | 空（未关联） |
| cargo_status | text | in_warehouse/transporting/arrived_port/cleared（017） | 默认 in_warehouse |
| warehouse_status | text | 入仓状态（017） | 空 |
| actual_warehouse_qty | numeric | 实际入仓数量（017） | 0 |
| abnormal_penalty | text | 异常扣款说明（017） | 空 |
| bill_check_status | text | pending/confirmed/difference_confirmed/difference_pending（017） | 默认 pending |
| bill_check_time | timestamptz | 账单核对时间（017） | 空 |
| appointment_time | timestamptz | 预约时间（017） | 空 |
| cargo_code | text | 货代号（032） | 空 |
| source | text | manual/transfer（032） | 默认 manual |
| created_by / created_at / updated_at | uuid/timestamptz | 操作人/时间 | — |
| deleted_at | timestamptz | 软删除 | NULL=正常 |

### shipment_items
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 明细 ID |
| shipment_id | uuid NOT NULL FK | 所属发货单 |
| sales_order_id | uuid FK | 关联销售订单（可空） |
| product_id | uuid NOT NULL FK | 商品 |
| quantity | numeric | 数量（>0） |
| remark | text | 备注（042） |
| created_at / updated_at | timestamptz | 时间戳 |

---

## 7. after_sales / after_sale_items（售后单）

### after_sales
| 字段 | 类型 | 含义 | 常见脏数据 |
|---|---|---|---|
| id | uuid PK | 售后单 ID | — |
| order_no | text NOT NULL UNIQUE | 售后单号 | — |
| sales_order_id | uuid FK | 关联销售订单 | 空 |
| warehouse_id | uuid FK | 仓库 | 空 |
| type | text | return/exchange/refund | — |
| status | text | PENDING/APPROVED/PROCESSING/COMPLETED/REJECTED/PLATFORM_INTERVENED（027） | 大小写混用 |
| reason | text | 原因 | 空 |
| result | text | 处理结果（018） | 空 |
| created_by / created_at / updated_at | uuid/timestamptz | 操作人/时间 | — |
| deleted_at | timestamptz | 软删除 | NULL=正常 |

### after_sale_items
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 明细 ID |
| after_sale_id | uuid NOT NULL FK | 所属售后单 |
| product_id | uuid NOT NULL FK | 商品 |
| quantity | numeric | 数量（>0） |
| created_at | timestamptz | 时间 |

---

## 8. purchase_orders / purchase_order_items（采购单）

### purchase_orders
| 字段 | 类型 | 含义 | 常见脏数据 |
|---|---|---|---|
| id | uuid PK | 采购单 ID | — |
| order_no | text NOT NULL UNIQUE | 采购单号 | — |
| supplier | text | 供应商 | 空 |
| warehouse_id | uuid FK | 目标仓库 | 空 |
| status | text | DRAFT/SUBMITTED/APPROVED/PURCHASING/PARTIAL/RECEIVED/CANCELLED/ARRIVED（021） | 大小写混用 |
| total_amount | numeric(18,2) | 总额（>=0） | 0 |
| receive_date | date | 拿货日期（018） | 空 |
| remark | text | 备注（023） | 空 |
| created_by / created_at / updated_at | uuid/timestamptz | 操作人/时间 | — |
| deleted_at | timestamptz | 软删除 | NULL=正常 |

### purchase_order_items
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 明细 ID |
| order_id | uuid NOT NULL FK | 所属采购单 |
| product_id | uuid NOT NULL FK | 商品 |
| quantity | numeric | 数量（>0） |
| received_quantity | numeric | 已入库数量（>=0） |
| unit_price / subtotal | numeric(18,2) | 单价/小计（>=0） |
| created_at / updated_at | timestamptz | 时间戳 |

---

## 9. replenishment_orders / replenishment_order_items（补货单）

### replenishment_orders
| 字段 | 类型 | 含义 | 常见脏数据 |
|---|---|---|---|
| id | uuid PK | 补货单 ID | — |
| order_no | text NOT NULL UNIQUE | 补货单号 | — |
| warehouse_id | uuid FK | 仓库 | 空 |
| status | text | DRAFT/SUBMITTED/APPROVED/PROCESSING/COMPLETED/CANCELLED | 大小写混用 |
| replenish_qty | numeric(18,2) | 补货数量（018） | 0 |
| replenishment_time | date | 补货时间（018） | 空 |
| created_by / created_at / updated_at | uuid/timestamptz | 操作人/时间 | — |
| deleted_at | timestamptz | 软删除 | NULL=正常 |

### replenishment_order_items
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 明细 ID |
| replenishment_id | uuid NOT NULL FK | 所属补货单 |
| product_id | uuid NOT NULL FK | 商品 |
| quantity | numeric | 数量（>0） |
| created_at / updated_at | timestamptz | 时间戳 |

---

## 10. stocktakes / stocktake_items（库存盘点，043）

### stocktakes
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 盘点单 ID |
| stocktake_no | text NOT NULL UNIQUE | 盘点单号 |
| warehouse_id | uuid NOT NULL FK | 仓库 |
| stocktake_date | date | 盘点日期 |
| status | text | DRAFT/IN_PROGRESS/COMPLETED |
| remark | text | 备注 |
| created_by / created_at / updated_at | uuid/timestamptz | 操作人/时间 |
| deleted_at | timestamptz | 软删除 |

### stocktake_items
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 明细 ID |
| stocktake_id | uuid NOT NULL FK | 所属盘点单 |
| product_id | uuid NOT NULL FK | 商品 |
| book_quantity | numeric | 账面数量 |
| actual_quantity | numeric | 实盘数量 |
| difference | numeric | 差异（= 实盘 - 账面） |
| remark | text | 备注 |
| created_at | timestamptz | 时间 |

---

## 11. 基础 / 支撑表

### profiles（用户档案，001）
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK FK(auth.users) | 用户 ID（注册自动创建） |
| email | text NOT NULL | 邮箱 |
| display_name | text | 显示名 |
| warehouse_id | uuid | 关联仓库（016） |
| created_at / updated_at | timestamptz | 时间戳 |

### RBAC（002）：roles / permissions / role_permissions / user_roles
| 表 | 关键字段 | 含义 |
|---|---|---|
| roles | id, name unique, description | 角色（super_admin/admin/manager/operator 种子） |
| permissions | id, code unique, description | 权限点（products.read 等 21 个种子） |
| role_permissions | role_id, permission_id（复合 PK） | 角色-权限映射 |
| user_roles | user_id, role_id（复合 PK） | 用户-角色映射 |

### audit_logs（审计日志，011）
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 日志 ID |
| user_id | uuid FK | 操作人 |
| action | text | 动作 |
| resource_type / resource_id | text/uuid | 资源类型与 ID |
| before_data / after_data | jsonb | 变更前后快照 |
| ip / user_agent | text | 来源信息 |
| created_at | timestamptz | 时间 |

### system_settings（系统设置，034/035）
| 字段 | 类型 | 含义 |
|---|---|---|
| key | text PK | 配置键（default_timezone / default_currency 等） |
| value | jsonb | 配置值 |
| updated_at / updated_by | timestamptz/uuid | 更新时间/操作人 |

### forwarders（货代，017）
| 字段 | 类型 | 含义 |
|---|---|---|
| id | uuid PK | 货代 ID |
| name | text NOT NULL UNIQUE | 名称 |
| contact / phone / remark | text | 联系方式/备注 |
| is_active | boolean | 是否启用 |
| created_at / updated_at | timestamptz | 时间戳 |

### cargo_statuses（货物状态，025） / after_sale_types（售后类型，026）
按业务字典表设计：id、名称/编码、排序、是否启用、时间戳等（具体列以 025/026 迁移为准）。

---

## 12. 脏数据治理说明（P2 执行现状）

1. **成本字段**：`products.purchase_cost` 存在 NULL/0/负数历史数据，成本利润模块会失真。已提供 `scripts/scan-data-quality.mjs` 扫描并产出问题清单（含明细行），修复策略：批量回填真实采购成本或按供应商价目表覆盖；不允许负值（DB CHECK 已限制 >=0）。
2. **SKU/link_id 规范**：
   - 写入路径规范化已落地：`products.ts`、`products/[id].ts`（PATCH/POST）对 sku/link_id/code 等字符串字段做 trim + 空串归 NULL；
   - `daily-sales.ts` POST 导入路径已对 platform/link_id/product_name/ad_group 等做 trim（normText）；
   - 扫描脚本会列出**首尾空格**、**大小写混用疑似重复**（归一化后同 key 多行）清单，供人工核对后统一修正。
3. **daily_sales 幂等**：唯一约束 `(sale_date, platform, link_id)` 自 030 起建立；P0 已实现"先查后累加"（quantity/refund_qty/refund_amount 增量累加，unit_price/overseas_stock 取最新非 0 值）；回收站恢复走 `adjust_inventory` 分支并整体失败回滚，不涉及 daily_sales 重复写入，**与幂等逻辑无冲突**（048 已附核查 SQL）。
4. **索引补充（048）**：`idx_daily_sales_date_platform`（date+platform）、`idx_daily_sales_date_ad_group`（date+ad_group），支撑按时间+店铺+广告组筛选统计。
5. **统计/导出参数化（P2）**：
   - `GET /api/analysis`：支持 `days` / `from` / `to` / `platform` / `ad_group`
   - `GET /api/daily-sales`：支持 `from` / `to` / `platform` / `ad_group` / `link_id`
   - `GET /api/daily-sales/summary`：支持 `sale_from` / `sale_to` / `keyword` / `platform` / `ad_group`
   - `GET /api/dashboard/stats`：支持 `days` / `from` / `to`
   - `GET /api/exchange-rates`：支持 `from` / `to` / `date` / `base` / `currencies`
   - 导出（/api/export/xlsx）：由前端传参筛选后导出（通用 aoa 导出，见 export-xlsx.ts）

## 13. 备注

- 所有表默认启用 RLS；业务读写走 service_role（仅服务端），见 `server/_handlers/_lib/db.ts`。
- 软删除：036 起 products/sales_orders/purchase_orders/shipments/after_sales/replenishment_orders 均有 `deleted_at`，列表查询需过滤 `deleted_at is null`。
- 日期字段一律 `timestamptz`；`daily_sales.sale_date` 为纯 `date`（业务日期，按墨西哥城时区 UTC-6 语义导入，034 default_timezone）。
*（内容由AI生成，仅供参考）*
