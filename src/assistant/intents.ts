// ============================================================
// 数据查询助手 - 意图注册表与执行器
// 所有 API 均为只读 GET；权限码与接口路径已按 server/_handlers 源码核对。
// 禁止修改 server/，禁止臆造接口字段。
// ============================================================
import type {
  AskCtx,
  ChipItem,
  IntentDef,
  IntentResult,
  MsgCard,
  Parsed,
  ProductRef,
  TableCol,
} from './types';
import { fetchJson, unwrap, num2 } from './api';
import { hasAny } from './util';

const ANY_ANALYSIS_PERMS = [
  'products.read',
  'inventory.read',
  'sales.read',
  'shipment.read',
  'procurement.read',
  'transfer.read',
  'after_sales.read',
];

const ANY_OVERVIEW_PERMS = [
  'products.read',
  'inventory.read',
  'sales.read',
];

function n(v: any): number {
  const x = Number(v);
  return isFinite(x) ? x : 0;
}

function fmtDate(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  return s.length > 10 ? s.slice(0, 10) : s;
}

function fmtInt(v: any): number | string {
  const x = Number(v);
  if (!isFinite(x)) return '—';
  return Math.round(x);
}

/** 统计区间渲染：兼容接口返回的 { start, end } 对象或字符串 */
function fmtPeriod(v: any): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return fmtDate(v) === '—' ? '' : v;
  if (typeof v === 'object') {
    const s = v.start ?? v.from ?? '';
    const e = v.end ?? v.to ?? '';
    if (s && e) return `${fmtDate(s)} 至 ${fmtDate(e)}`;
    if (s) return fmtDate(s);
    if (e) return fmtDate(e);
  }
  return '';
}

/** 从行对象安全取值（嵌套 a.b 也支持） */
function pick(row: any, path: string): any {
  if (!row) return undefined;
  return path.split('.').reduce((acc: any, k: string) => (acc == null ? undefined : acc[k]), row);
}

/** 商品候选 chip 点击文本 */
function productPickSend(row: any, suffix = ''): string {
  const key = row.code || row.sku || row.name || '';
  return `查一下 ${key}${suffix}`;
}

/** 商品查询后的详情卡（产品行字段存在性兜底） */
function productDetailCards(row: any): MsgCard[] {
  const cards: MsgCard[] = [];
  const base: { label: string; value: string | number }[] = [];
  const put = (label: string, v: any, fn?: (x: any) => string | number) => {
    if (v === undefined || v === null || v === '') return;
    base.push({ label, value: fn ? fn(v) : v });
  };
  put('商品编码', row.code);
  put('名称', row.name);
  put('SKU', row.sku);
  put('链接ID', row.link_id);
  put('条码', row.barcode);
  put('分类', row.category);
  put('单位', row.unit);
  put('状态', row.status === 'active' ? '在售' : (row.status ?? undefined));
  put('售价', row.sale_price != null ? num2(row.sale_price) : undefined);
  put('采购成本', row.purchase_cost != null ? num2(row.purchase_cost) : undefined);
  put('头程运费', row.first_leg_freight != null ? num2(row.first_leg_freight) : undefined);
  put('安全库存', row.safety_stock != null ? fmtInt(row.safety_stock) : undefined);
  if (base.length) cards.push({ kind: 'stats', title: '商品档案', items: base });

  const inv: { label: string; value: string | number }[] = [];
  if (row.domestic_stock != null) inv.push({ label: '国内库存', value: fmtInt(row.domestic_stock) });
  if (row.overseas_stock != null) inv.push({ label: '海外库存(快照)', value: fmtInt(row.overseas_stock) });
  if (row.sellable_stock != null) inv.push({ label: '可售库存', value: fmtInt(row.sellable_stock) });
  if (row.in_transit_qty != null) inv.push({ label: '在途数量', value: fmtInt(row.in_transit_qty) });
  if (row.sales_qty != null) inv.push({ label: '累计销量', value: fmtInt(row.sales_qty) });
  if (row.low_stock === true || row.low_stock === 'true' || row.out_of_stock === true || row.out_of_stock === 'true') {
    inv.push({ label: '预警', value: row.out_of_stock === true || row.out_of_stock === 'true' ? '断货' : '低库存' });
  }
  if (inv.length) cards.push({ kind: 'stats', title: '库存与销量', items: inv });
  return cards;
}

function detailChips(perms: string[], withCtx = true): ChipItem[] {
  const chips: ChipItem[] = [];
  if (hasAny(perms, ['inventory.read'])) chips.push({ label: '它的库存', send: '它现在有多少库存' });
  if (hasAny(perms, ['sales.read'])) chips.push({ label: '近30天销量', send: '它近30天的销量' });
  if (hasAny(perms, ['cost_profit.read'])) chips.push({ label: '成本利润', send: '它的成本利润' });
  void withCtx;
  return chips;
}

/** 由关键词定位商品：返回 { rows }（0 空 /1 唯一 /N 候选） */
async function searchProducts(kw: string) {
  const res = await fetchJson('/products', { search: kw, page: 1, pageSize: 6 });
  if (!res.ok) throw new Error(res.message);
  const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
  return rows;
}

function toRef(row: any): ProductRef {
  return {
    name: row.name || '',
    code: row.code ?? null,
    sku: row.sku ?? null,
    id: row.id,
    link_id: row.link_id ?? null,
  };
}

/** 处理“关键词定位商品”的统一逻辑（库存/流水/销量等追问复用） */
async function resolveProductByKw(
  kw: string,
  env: AssistEnvLike,
): Promise<{ kind: 'miss' | 'many'; result: IntentResult; rows?: any[] } | { kind: 'single'; result: IntentResult; rows: any[] }> {
  const rows = await searchProducts(kw);
  if (!rows.length) {
    return { kind: 'miss', result: { text: `未找到与「${kw}」匹配的商品。可输入商品编码/SKU/链接ID/名称重试，或让我列出商品列表。` } };
  }
  if (rows.length > 1) {
    const chips: ChipItem[] = rows.map((r) => ({
      label: `${r.name || r.code || r.sku}${r.code ? `（${r.code}）` : ''}`,
      send: productPickSend(r),
    }));
    return {
      kind: 'many',
      result: { text: `找到 ${rows.length} 个匹配商品，请选择想进一步查看的商品：`, chips },
      rows,
    };
  }
  return { kind: 'single', result: { text: '' }, rows };
}

interface AssistEnvLike {
  perms: string[];
  ctx: AskCtx;
}

/** 取该消息用于商品追问的引用商品（代词引用优先） */
function effectiveRef(p: Parsed, env: AssistEnvLike): ProductRef | undefined {
  if (p.referencedProduct) return p.referencedProduct;
  return env.ctx.product;
}

/** ============ 意图定义 ============ */

export const INTENTS: IntentDef[] = [
  // ------------------------------------------------------------
  // 1. 经营总览
  // ------------------------------------------------------------
  {
    id: 'dashboard-overview',
    title: '经营总览',
    desc: '查看商品/库存/在途/销售等核心指标汇总（默认近30天）',
    examples: ['经营总览', '看下整体情况'],
    perms: ANY_OVERVIEW_PERMS,
    match: (p) => p.intentId === 'dashboard-overview',
    async run(p, env) {
      if (!hasAny(env.perms, ANY_OVERVIEW_PERMS)) {
        return { text: '当前账号无查看经营总览的权限（products/inventory/sales 等 read 权限至少一项）。' };
      }
      const params: Record<string, unknown> = { days: p.days ?? 30 };
      if (p.from) params.from = p.from;
      if (p.to) params.to = p.to;
      const res = await fetchJson('/dashboard/stats', params);
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const d = res.body?.data ?? res.body;
      const items: { label: string; value: string | number }[] = [];
      if (d.products_count != null) items.push({ label: '商品总数', value: fmtInt(d.products_count) });
      if (d.domestic_stock != null) items.push({ label: '国内库存', value: fmtInt(d.domestic_stock) });
      if (d.overseas_stock != null) items.push({ label: '海外库存', value: fmtInt(d.overseas_stock) });
      if (d.in_transit_stock != null) items.push({ label: '在途库存', value: fmtInt(d.in_transit_stock) });
      if (d.shipments_count != null) items.push({ label: '发货单数', value: fmtInt(d.shipments_count) });
      if (d.sales_count != null) items.push({ label: '销售单数', value: fmtInt(d.sales_count) });
      if (d.after_sales_count != null) items.push({ label: '售后单数', value: fmtInt(d.after_sales_count) });
      const cards: MsgCard[] = [];
      if (items.length) cards.push({ kind: 'stats', title: '核心指标', items });
      const recent = Array.isArray(d.recent_shipments) ? d.recent_shipments : [];
      if (recent.length) {
        const columns: TableCol[] = [
          { key: 'tracking_no', label: '货件号' },
          { key: 'forwarders.name', label: '货代', fmt: (r) => r?.forwarders?.name ?? '—' },
          { key: 'shipping_mode', label: '运输方式' },
          { key: 'warehouse_no', label: '仓库号' },
          { key: 'shipping_qty', label: '数量', fmt: (r) => fmtInt(r.shipping_qty) },
          { key: 'cargo_status', label: '货物状态' },
          { key: 'ship_date', label: '发货日期', fmt: (r) => fmtDate(r.ship_date) },
        ];
        cards.push({ kind: 'table', title: '近期发货', columns, rows: recent });
      }
      const periodText = fmtPeriod(d.period);
      const period = periodText ? `（统计区间：${periodText}）` : '';
      return { text: `这是经营总览${period}`, cards };
    },
  },

  // ------------------------------------------------------------
  // 2. 商品详情 / 商品列表
  // ------------------------------------------------------------
  {
    id: 'product-search',
    title: '查商品',
    desc: '按商品编码 / SKU / 链接ID / 名称查询商品档案与库存',
    examples: ['查一下 A商品编码', '商品列表', '蓝牙耳机 的信息'],
    perms: ['products.read'],
    match: (p) => p.intentId === 'product-search',
    async run(p, env) {
      if (!hasAny(env.perms, ['products.read'])) {
        return { text: '当前账号没有查询商品的权限（products.read）。' };
      }
      const ref = effectiveRef(p, env);
      const kw = (ref && (ref.code || ref.sku || ref.link_id)) || p.kw || '';
      if (!kw) {
        // 无关键词：返回商品列表前若干条
        const res = await fetchJson('/products', { page: 1, pageSize: 8 });
        if (!res.ok) return { text: `查询失败：${res.message}` };
        const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
        const total = res.body?.total ?? rows.length;
        if (!rows.length) return { text: '没有查询到商品数据。' };
        const columns: TableCol[] = [
          { key: 'code', label: '编码' },
          { key: 'name', label: '名称' },
          { key: 'sku', label: 'SKU' },
          { key: 'category', label: '分类' },
          { key: 'status', label: '状态', fmt: (r) => (r.status === 'active' ? '在售' : r.status ?? '—') },
        ];
        return {
          text: `共 ${total} 个商品，展示前 ${rows.length} 条（可输入编码/SKU/名称精确查询）：`,
          cards: [{ kind: 'table', title: '商品列表', columns, rows }],
          chips: rows.slice(0, 6).map((r) => ({
            label: `${r.name || r.code}${r.code ? `（${r.code}）` : ''}`,
            send: productPickSend(r),
          })),
        };
      }
      const rows = await searchProducts(kw);
      if (!rows.length) return { text: `未找到与「${kw}」匹配的商品。` };
      if (rows.length > 1) {
        return {
          text: `找到 ${rows.length} 个匹配商品，请选择：`,
          chips: rows.map((r) => ({
            label: `${r.name || r.code}${r.code ? `（${r.code}）` : ''}${r.sku ? ` SKU:${r.sku}` : ''}`,
            send: productPickSend(r),
          })),
        };
      }
      const row = rows[0];
      const chips: ChipItem[] = [];
      if (hasAny(env.perms, ['inventory.read'])) chips.push({ label: '它的库存', send: '它现在有多少库存' });
      if (hasAny(env.perms, ['sales.read'])) chips.push({ label: '近30天销量', send: '它近30天的销量' });
      if (hasAny(env.perms, ['cost_profit.read'])) chips.push({ label: '成本利润', send: '它的成本利润' });
      const cards = productDetailCards(row);
      return {
        text: `为你找到商品「${row.name || row.code || row.sku}」`,
        cards,
        chips,
        ctx: { product: toRef(row) },
      };
    },
  },

  // ------------------------------------------------------------
  // 3. 低库存预警
  // ------------------------------------------------------------
  {
    id: 'low-stock',
    title: '低库存预警',
    desc: '断货 / 低于安全库存的商品列表',
    examples: ['低库存预警', '哪些商品缺货'],
    perms: ['inventory.read'],
    match: (p) => p.intentId === 'low-stock',
    async run(p, env) {
      if (!hasAny(env.perms, ['inventory.read'])) {
        return { text: '当前账号没有查询库存预警的权限（inventory.read）。' };
      }
      const res = await fetchJson('/inventory/alerts');
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const body = unwrap(res.body);
      const items: any[] = Array.isArray(body?.items) ? body.items : [];
      const summary = body?.summary || {};
      if (!items.length) return { text: '当前没有断货或低于安全库存的商品，库存状况良好。' };
      const statItems: { label: string; value: string | number }[] = [];
      if (summary.total != null) statItems.push({ label: '商品总数', value: fmtInt(summary.total) });
      if (summary.out_of_stock != null) statItems.push({ label: '断货', value: fmtInt(summary.out_of_stock) });
      if (summary.low_stock != null) statItems.push({ label: '低库存', value: fmtInt(summary.low_stock) });
      const columns: TableCol[] = [
        { key: 'sku', label: 'SKU' },
        { key: 'code', label: '编码' },
        { key: 'name', label: '商品名称' },
        { key: 'alert_type', label: '预警', fmt: (r) => (r.alert_type === 'out_of_stock' ? '断货' : '低库存') },
        { key: 'sellable_stock', label: '可售库存', fmt: (r) => fmtInt(r.sellable_stock) },
        { key: 'safety_stock', label: '安全库存', fmt: (r) => fmtInt(r.safety_stock) },
        { key: 'domestic_stock', label: '国内库存', fmt: (r) => fmtInt(r.domestic_stock) },
        { key: 'overseas_stock', label: '海外快照', fmt: (r) => fmtInt(r.overseas_stock) },
        { key: 'in_transit_qty', label: '在途', fmt: (r) => fmtInt(r.in_transit_qty) },
      ];
      const cards: MsgCard[] = [];
      if (statItems.length) cards.push({ kind: 'stats', title: '预警汇总', items: statItems });
      cards.push({ kind: 'table', title: `预警列表（${items.length} 条）`, columns, rows: items.slice(0, 30) });
      const chips: ChipItem[] = items.slice(0, 5).map((r) => ({
        label: `看 ${r.name || r.code || r.sku}`,
        send: productPickSend(r),
      }));
      return { text: '这是当前库存预警情况，点击行或下方商品可查看档案：', cards, chips, ctx: { product: toRef(items[0]) } };
    },
  },

  // ------------------------------------------------------------
  // 4. 库存查询
  // ------------------------------------------------------------
  {
    id: 'stock-query',
    title: '查库存',
    desc: '按商品 / 仓库类型查询当前库存',
    examples: ['现在库存', 'SKU123 有多少库存', '海外库存', '蓝牙耳机还有货吗'],
    perms: ['inventory.read'],
    match: (p) => p.intentId === 'stock-query',
    async run(p, env) {
      if (!hasAny(env.perms, ['inventory.read'])) {
        return { text: '当前账号没有查询库存的权限（inventory.read）。' };
      }
      // 先处理“海外/国内/总仓”这类仓库范围
      const t = p.text;
      let whType: string | undefined;
      if (/海外|国外|跨境仓|海外仓|fba/.test(t)) whType = 'overseas';
      else if (/国内|本地仓|国内仓/.test(t)) whType = 'domestic';

      const ref = effectiveRef(p, env);
      const kw = (ref && (ref.code || ref.sku || ref.link_id)) || p.kw || '';
      let productRow: any | undefined;

      if (kw) {
        const matched = await resolveProductByKw(kw, env);
        if (matched.kind === 'miss') return matched.result;
        if (matched.kind === 'many') return matched.result;
        productRow = matched.rows![0];
      }

      const params: Record<string, unknown> = { page: 1, pageSize: 8 };
      if (whType) params.wh_type = whType;
      if (productRow) {
        if (productRow.sku) params.sku = productRow.sku;
        else {
          // 无 SKU：直接用商品主档字段回显库存
          const cards = productDetailCards(productRow);
          return { text: `商品「${productRow.name || productRow.code}」未设置 SKU，无法拉取分仓库存明细，以下是其档案信息：`, cards, ctx: { product: toRef(productRow) } };
        }
      }
      const res = await fetchJson('/inventory', params);
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
      const total = res.body?.total ?? rows.length;
      if (!rows.length) {
        if (productRow) return { text: `「${productRow.name || productRow.code}」目前没有可查询的库存记录。` };
        return { text: '当前没有库存记录。' };
      }
      const columns: TableCol[] = [
        { key: 'products.sku', label: 'SKU', fmt: (r) => r?.products?.sku ?? '—' },
        { key: 'products.name', label: '商品名称', fmt: (r) => r?.products?.name ?? '—' },
        { key: 'warehouses.name', label: '仓库', fmt: (r) => r?.warehouses?.name ?? '—' },
        { key: 'quantity', label: '库存数量', fmt: (r) => fmtInt(r.quantity) },
        { key: 'reserved_quantity', label: '锁定数量', fmt: (r) => fmtInt(r.reserved_quantity) },
        { key: 'updated_at', label: '更新时间', fmt: (r) => fmtDate(r.updated_at) },
      ];
      const scopeTxt = whType === 'overseas' ? '海外仓' : whType === 'domestic' ? '国内仓' : '';
      const head = productRow ? `「${productRow.name || productRow.code}」${scopeTxt}库存明细` : `${scopeTxt}库存（最近 ${rows.length} 条，共 ${total} 条）`;
      return {
        text: head,
        cards: [{ kind: 'table', title: '库存', columns, rows }],
        chips: productRow ? detailChips(env.perms) : [],
        ctx: { product: productRow ? toRef(productRow) : env.ctx.product },
      };
    },
  },

  // ------------------------------------------------------------
  // 5. 库存流水
  // ------------------------------------------------------------
  {
    id: 'stock-flow',
    title: '库存流水',
    desc: '商品的出入库 / 变动记录（最新在前）',
    examples: ['库存流水', 'SKU123 的库存流水'],
    perms: ['inventory.read'],
    match: (p) => p.intentId === 'stock-flow',
    async run(p, env) {
      if (!hasAny(env.perms, ['inventory.read'])) {
        return { text: '当前账号没有查询库存流水的权限（inventory.read）。' };
      }
      const ref = effectiveRef(p, env);
      const kw = (ref && (ref.code || ref.sku || ref.link_id)) || p.kw || '';
      let sku: string | undefined;
      let productRow: any | undefined;
      if (kw) {
        const matched = await resolveProductByKw(kw, env);
        if (matched.kind === 'miss') return matched.result;
        if (matched.kind === 'many') return matched.result;
        productRow = matched.rows![0];
        sku = productRow.sku || undefined;
        if (!sku) return { text: `商品「${productRow.name || productRow.code}」未设置 SKU，无法查询流水。` };
      }
      const params: Record<string, unknown> = { page: 1, pageSize: 20 };
      if (sku) params.sku = sku;
      const res = await fetchJson('/inventory/transactions', params);
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
      if (!rows.length) return { text: sku ? `「${productRow!.name || productRow!.code}」暂无库存流水。` : '暂无库存流水记录。' };
      const columns: TableCol[] = [
        { key: 'products.sku', label: 'SKU', fmt: (r) => r?.products?.sku ?? '—' },
        { key: 'products.name', label: '商品', fmt: (r) => r?.products?.name ?? '—' },
        { key: 'warehouses.name', label: '仓库', fmt: (r) => r?.warehouses?.name ?? '—' },
        { key: 'type', label: '类型' },
        { key: 'quantity', label: '变动数量', fmt: (r) => fmtInt(r.quantity) },
        { key: 'before_quantity', label: '变动前', fmt: (r) => fmtInt(r.before_quantity) },
        { key: 'after_quantity', label: '变动后', fmt: (r) => fmtInt(r.after_quantity) },
        { key: 'note', label: '备注' },
        { key: 'created_at', label: '时间', fmt: (r) => fmtDate(r.created_at) },
      ];
      return {
        text: sku ? `「${productRow!.name || productRow!.code}」的库存流水（最新 ${rows.length} 条）：` : `库存流水（最新 ${rows.length} 条）：`,
        cards: [{ kind: 'table', title: '流水记录', columns, rows }],
        chips: productRow ? detailChips(env.perms) : [],
        ctx: { product: productRow ? toRef(productRow) : env.ctx.product },
      };
    },
  },

  // ------------------------------------------------------------
  // 6. 销售汇总
  // ------------------------------------------------------------
  {
    id: 'sales-summary',
    title: '销售汇总',
    desc: '按链接统计销量/退款/净额（默认近30天，可按商品/链接筛选）',
    examples: ['近30天销量汇总', 'SKU123 的销量', '看下整体销量'],
    perms: ['sales.read'],
    match: (p) => p.intentId === 'sales-summary',
    async run(p, env) {
      if (!hasAny(env.perms, ['sales.read'])) {
        return { text: '当前账号没有查询销售的权限（sales.read）。' };
      }
      const ref = effectiveRef(p, env);
      const kw = (ref && (ref.code || ref.sku || ref.link_id || ref.name)) || p.kw || '';
      const params: Record<string, unknown> = {};
      if (p.from) params.sale_from = p.from;
      if (p.to) params.sale_to = p.to;
      else if (p.days !== undefined) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - (p.days - 1));
        const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        params.sale_from = f(start);
        params.sale_to = f(end);
      }
      let body = null as any;
      if (kw) {
        const r = await fetchJson('/daily-sales/summary', { ...params, keyword: kw });
        if (!r.ok) return { text: `查询失败：${r.message}` };
        body = r.body;
        const rows = Array.isArray(body?.aggRows) ? body.aggRows : [];
        // 关键词没直接命中时，回退：先定位商品再按链接查
        if (!rows.length && !p.referencedProduct) {
          const matched = await resolveProductByKw(kw, env);
          if (matched.kind === 'single') {
            const link = matched.rows![0].link_id;
            if (link) {
              const r2 = await fetchJson('/daily-sales/summary', { ...params, keyword: link });
              if (r2.ok) body = r2.body;
            }
          }
        }
      } else {
        const r = await fetchJson('/daily-sales/summary', params);
        if (!r.ok) return { text: `查询失败：${r.message}` };
        body = r.body;
      }
      const aggRows: any[] = Array.isArray(body?.aggRows) ? body.aggRows : [];
      const totals = body?.totals || {};
      if (!aggRows.length) {
        const q = kw ? `「${kw}」` : '该时间段';
        return { text: `${q}没有销量数据。可尝试调整时间范围或商品关键词。` };
      }
      const statItems: { label: string; value: string | number }[] = [];
      if (totals.sellQty != null) statItems.push({ label: '总销量', value: fmtInt(totals.sellQty) });
      if (totals.refundQty != null) statItems.push({ label: '退款数', value: fmtInt(totals.refundQty) });
      if (totals.netQty != null) statItems.push({ label: '净销量', value: fmtInt(totals.netQty) });
      if (totals.netAmount != null) statItems.push({ label: '净销售额', value: num2(totals.netAmount) });
      if (totals.days != null) statItems.push({ label: '出单天数', value: fmtInt(totals.days) });
      const columns: TableCol[] = [
        { key: 'link_id', label: '链接ID' },
        { key: 'product_name', label: '商品名称' },
        { key: 'platform', label: '平台' },
        { key: 'quantity', label: '销量', fmt: (r) => fmtInt(r.quantity) },
        { key: 'refund_qty', label: '退款数', fmt: (r) => fmtInt(r.refund_qty) },
        { key: 'netQty', label: '净销量', fmt: (r) => fmtInt(r.netQty) },
        { key: 'netAmount', label: '净额', fmt: (r) => num2(r.netAmount) },
        { key: 'avg_price', label: '均价', fmt: (r) => num2(r.avg_price) },
        { key: 'overseas_stock', label: '可用库存', fmt: (r) => fmtInt(r.overseas_stock) },
        { key: 'days', label: '出单天数', fmt: (r) => fmtInt(r.days) },
      ];
      const cards: MsgCard[] = [];
      if (statItems.length) cards.push({ kind: 'stats', title: '合计', items: statItems });
      cards.push({ kind: 'table', title: `销量明细（${aggRows.length} 条链接）`, columns, rows: aggRows.slice(0, 30) });
      const period = p.days ? `近${p.days}天` : p.from && p.to ? `${p.from} 至 ${p.to}` : '默认区间';
      return { text: `「${kw || '全部链接'}」${period}销售汇总如下：`, cards };
    },
  },

  // ------------------------------------------------------------
  // 7. 销售排行（经营分析热销 TOP）
  // ------------------------------------------------------------
  {
    id: 'sales-rank',
    title: '热销排行',
    desc: '近30天销量 TOP 链接排行（经营分析）',
    examples: ['热销排行', '卖得最好的前几名', '销量排行'],
    perms: ANY_ANALYSIS_PERMS,
    match: (p) => p.intentId === 'sales-rank',
    async run(p, env) {
      if (!hasAny(env.perms, ANY_ANALYSIS_PERMS)) {
        return { text: '当前账号无查看经营分析的权限（需 products/inventory/sales 等 read 权限之一）。' };
      }
      const params: Record<string, unknown> = { days: p.days ?? 30 };
      if (p.from) params.from = p.from;
      if (p.to) params.to = p.to;
      const res = await fetchJson('/analysis', params);
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const d = unwrap(res.body);
      const hot: any[] = Array.isArray(d?.hot_top) ? d.hot_top : [];
      if (!hot.length) return { text: '该时间段暂无热销排行数据。' };
      const columns: TableCol[] = [
        { key: 'rank', label: '排名', fmt: (_r, i?: number) => fmtInt((i ?? 0) + 1) },
        { key: 'name', label: '商品 / 链接' },
        { key: 'link_id', label: '链接ID' },
        { key: 'qty', label: '净销量', fmt: (r) => fmtInt(r.qty) },
        { key: 'image', label: '图', fmt: (r) => (r.image ? '有图' : '—') },
      ];
      const chips: ChipItem[] = hot.slice(0, 5).map((r) => ({
        label: `看 ${r.name}`,
        send: `查一下 ${r.link_id || r.name} 的销量`,
      }));
      return {
        text: `近${p.days ?? 30}天热销 TOP ${hot.length}：`,
        cards: [{ kind: 'table', title: '热销排行', columns, rows: hot }],
        chips,
      };
    },
  },

  // ------------------------------------------------------------
  // 8. 成本利润
  // ------------------------------------------------------------
  {
    id: 'cost-profit',
    title: '成本利润',
    desc: '按商品查看成本 / 售价 / 利润估算（成本利润表）',
    examples: ['成本利润表', 'SKU123 的成本利润', '看下毛利'],
    perms: ['cost_profit.read'],
    match: (p) => p.intentId === 'cost-profit',
    async run(p, env) {
      if (!hasAny(env.perms, ['cost_profit.read'])) {
        return { text: '当前账号没有查询成本利润的权限（cost_profit.read）。' };
      }
      const ref = effectiveRef(p, env);
      const kw = (ref && (ref.code || ref.sku || ref.name)) || p.kw || '';
      const params: Record<string, unknown> = { page: 1, pageSize: 20 };
      if (kw) params.search = kw;
      const res = await fetchJson('/cost-profit', params);
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const body = res.body;
      const rows: any[] = Array.isArray(body?.data) ? body.data : [];
      const count = body?.count ?? rows.length;
      if (!rows.length) return { text: kw ? `未找到「${kw}」的成本利润记录。` : '暂无成本利润数据。' };
      const columns: TableCol[] = [
        { key: 'code', label: '编码' },
        { key: 'name', label: '名称' },
        { key: 'sku', label: 'SKU' },
        { key: 'link_id', label: '链接ID' },
        { key: 'unit_price', label: '售价(原币)', fmt: (r) => num2(r.unit_price) },
        { key: 'sale_price_cny', label: '售价(CNY)', fmt: (r) => num2(r.sale_price_cny) },
        { key: 'purchase_cost', label: '采购成本', fmt: (r) => num2(r.purchase_cost) },
        { key: 'first_leg_freight', label: '头程运费', fmt: (r) => num2(r.first_leg_freight) },
        { key: 'gross_profit_cny', label: '毛利(CNY)', fmt: (r) => num2(r.gross_profit_cny) },
        { key: 'profit_cny', label: '平台利润(CNY)', fmt: (r) => num2(r.profit_cny) },
      ];
      const cards: MsgCard[] = [
        { kind: 'table', title: `成本利润（${count} 条${kw ? `，关键词「${kw}」` : ''}）`, columns, rows: rows.slice(0, 20) },
      ];
      const first = rows[0];
      const chips: ChipItem[] = first
        ? [
            { label: '看商品档案', send: productPickSend(first) },
            ...detailChips(env.perms),
          ]
        : [];
      return { text: '数据来自成本利润模块（币种/汇率取系统设置）：', cards, chips, ctx: { product: toRef(first) } };
    },
  },

  // ------------------------------------------------------------
  // 9. 发货单
  // ------------------------------------------------------------
  {
    id: 'shipment-list',
    title: '发货单',
    desc: '查询发货 / 物流单（可按货件号）',
    examples: ['发货单列表', '查一下货件号 SHP123', '最近的发货'],
    perms: ['shipment.read'],
    match: (p) => p.intentId === 'shipment-list',
    async run(p, env) {
      if (!hasAny(env.perms, ['shipment.read'])) {
        return { text: '当前账号没有查询发货单的权限（shipment.read）。' };
      }
      const token = p.kw && /ship|shp|s\d/i.test(p.kw) ? p.kw : undefined;
      const params: Record<string, unknown> = { source: 'manual', page: 1, pageSize: 10 };
      if (token) params.tracking_no = token;
      const res = await fetchJson('/shipments', params);
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
      const total = res.body?.total ?? rows.length;
      if (!rows.length) return { text: token ? `未找到货件号「${token}」的发货单。` : '暂无发货单。' };
      const columns: TableCol[] = [
        { key: 'tracking_no', label: '货件号' },
        { key: 'forwarders.name', label: '货代', fmt: (r) => r?.forwarders?.name ?? '—' },
        { key: 'shipping_mode', label: '运输方式' },
        { key: 'warehouse_no', label: '仓库号' },
        { key: 'store', label: '店铺' },
        { key: 'shipping_qty', label: '总数量', fmt: (r) => fmtInt(r.shipping_qty) },
        { key: 'shipping_cartons', label: '箱数', fmt: (r) => fmtInt(r.shipping_cartons) },
        { key: 'cargo_status', label: '货物状态' },
        { key: 'status', label: '状态' },
        { key: 'ship_date', label: '发货日期', fmt: (r) => fmtDate(r.ship_date) },
      ];
      return {
        text: token ? `货件号「${token}」的发货单：` : `发货单列表（最近 ${rows.length} 条，共 ${total} 条）：`,
        cards: [{ kind: 'table', title: '发货单', columns, rows }],
      };
    },
  },

  // ------------------------------------------------------------
  // 10. 调拨单（后端走 /shipments?source=transfer，需 shipment.read 实际调用）
  // ------------------------------------------------------------
  {
    id: 'transfer-list',
    title: '调拨单',
    desc: '查询调拨 / 转运单据',
    examples: ['调拨单列表', '最近的调拨'],
    perms: ['transfer.read', 'shipment.read'],
    apiPerms: ['shipment.read'],
    match: (p) => p.intentId === 'transfer-list',
    async run(p, env) {
      if (!hasAny(env.perms, ['shipment.read'])) {
        return { text: '查询调拨单需要发货单读取权限（shipment.read），当前账号不足。' };
      }
      const params: Record<string, unknown> = { source: 'transfer', page: 1, pageSize: 10 };
      const res = await fetchJson('/shipments', params);
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
      const total = res.body?.total ?? rows.length;
      if (!rows.length) return { text: '暂无调拨单。' };
      const columns: TableCol[] = [
        { key: 'tracking_no', label: '货件号' },
        { key: 'cargo_code', label: '货代号' },
        { key: 'store', label: '店铺' },
        { key: 'shipping_mode', label: '空海运' },
        { key: 'shipping_qty', label: '总数量', fmt: (r) => fmtInt(r.shipping_qty) },
        { key: 'shipping_cartons', label: '箱数', fmt: (r) => fmtInt(r.shipping_cartons) },
        { key: 'cargo_status', label: '货物状态' },
        { key: 'status', label: '状态' },
        { key: 'ship_date', label: '发货日期', fmt: (r) => fmtDate(r.ship_date) },
      ];
      return {
        text: `调拨单列表（最近 ${rows.length} 条，共 ${total} 条）：`,
        cards: [{ kind: 'table', title: '调拨单', columns, rows }],
      };
    },
  },

  // ------------------------------------------------------------
  // 11. 采购 / 拿货单
  // ------------------------------------------------------------
  {
    id: 'purchase-list',
    title: '采购 / 拿货',
    desc: '查询采购 / 拿货记录',
    examples: ['采购单列表', '最近的拿货'],
    perms: ['procurement.read'],
    match: (p) => p.intentId === 'purchase-list',
    async run(p, env) {
      if (!hasAny(env.perms, ['procurement.read'])) {
        return { text: '当前账号没有查询采购单的权限（procurement.read）。' };
      }
      const res = await fetchJson('/purchase-orders', { page: 1, pageSize: 10 });
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
      const total = res.body?.total ?? rows.length;
      if (!rows.length) return { text: '暂无采购 / 拿货记录。' };
      const columns: TableCol[] = [
        { key: 'order_no', label: '单号' },
        { key: 'product', label: '商品', fmt: (r) => {
            const items = Array.isArray(r.purchase_order_items) ? r.purchase_order_items : [];
            const c = items[0]?.products?.code ?? items[0]?.products?.name ?? r.product_code ?? '';
            const names = items.map((it: any) => it.products?.name).filter(Boolean);
            return names.length > 1 ? `${c}（等${items.length}项）` : c || '—';
          } },
        { key: 'quantity', label: '数量', fmt: (r) => {
            const items = Array.isArray(r.purchase_order_items) ? r.purchase_order_items : [];
            const totalQty = items.length ? items.reduce((s: number, it: any) => s + n(it.quantity), 0) : r.quantity;
            return fmtInt(totalQty);
          } },
        { key: 'receive_date', label: '拿货日期', fmt: (r) => fmtDate(r.receive_date) },
        { key: 'status', label: '状态' },
        { key: 'remark', label: '备注' },
        { key: 'created_at', label: '创建时间', fmt: (r) => fmtDate(r.created_at) },
      ];
      return {
        text: `采购 / 拿货记录（最近 ${rows.length} 条，共 ${total} 条）：`,
        cards: [{ kind: 'table', title: '采购拿货', columns, rows }],
      };
    },
  },

  // ------------------------------------------------------------
  // 12. 售后单
  // ------------------------------------------------------------
  {
    id: 'after-sales',
    title: '售后单',
    desc: '查询退货 / 售后记录',
    examples: ['售后单列表', '最近的售后'],
    perms: ['after_sales.read'],
    match: (p) => p.intentId === 'after-sales',
    async run(p, env) {
      if (!hasAny(env.perms, ['after_sales.read'])) {
        return { text: '当前账号没有查询售后单的权限（after_sales.read）。' };
      }
      const res = await fetchJson('/after-sales', { page: 1, pageSize: 10 });
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
      const total = res.body?.total ?? rows.length;
      if (!rows.length) return { text: '暂无售后单。' };
      const columns: TableCol[] = [
        { key: 'order_no', label: '售后单号' },
        { key: 'type', label: '类型' },
        { key: 'item_summary', label: '商品明细', fmt: (r) => {
            const items = Array.isArray(r.after_sale_items) ? r.after_sale_items : [];
            const parts = items.slice(0, 3).map((it: any) => `${it.products?.name || it.product_id || ''}×${n(it.quantity)}`);
            const more = items.length > 3 ? ` 等${items.length}项` : '';
            return parts.join('、') + more || '—';
          } },
        { key: 'reason', label: '原因' },
        { key: 'result', label: '处理结果' },
        { key: 'status', label: '状态' },
        { key: 'created_at', label: '创建时间', fmt: (r) => fmtDate(r.created_at) },
      ];
      return {
        text: `售后单（最近 ${rows.length} 条，共 ${total} 条）：`,
        cards: [{ kind: 'table', title: '售后单', columns, rows }],
      };
    },
  },

  // ------------------------------------------------------------
  // 13. 补货单
  // ------------------------------------------------------------
  {
    id: 'replenishment',
    title: '补货单',
    desc: '查询补货计划与到货状态',
    examples: ['补货单列表', '查看补货'],
    perms: ['replenishment.read'],
    match: (p) => p.intentId === 'replenishment',
    async run(p, env) {
      if (!hasAny(env.perms, ['replenishment.read'])) {
        return { text: '当前账号没有查询补货单的权限（replenishment.read）。' };
      }
      const res = await fetchJson('/replenishment', { page: 1, pageSize: 10 });
      if (!res.ok) return { text: `查询失败：${res.message}` };
      const rows: any[] = Array.isArray(unwrap(res.body)) ? unwrap(res.body) : [];
      const total = res.body?.total ?? rows.length;
      if (!rows.length) return { text: '暂无补货单。' };
      const columns: TableCol[] = [
        { key: 'order_no', label: '单号' },
        { key: 'replenishment_time', label: '补货时间', fmt: (r) => fmtDate(r.replenishment_time) },
        { key: 'replenish_qty', label: '补货数量', fmt: (r) => fmtInt(r.replenish_qty) },
        { key: 'item_summary', label: '商品明细', fmt: (r) => {
            const items = Array.isArray(r.replenishment_order_items) ? r.replenishment_order_items : [];
            const parts = items.slice(0, 3).map((it: any) => `${it.products?.name || it.products?.sku || ''}×${n(it.quantity)}`);
            const more = items.length > 3 ? ` 等${items.length}项` : '';
            return parts.join('、') + more || '—';
          } },
        { key: 'status', label: '状态' },
        { key: 'arrival_date', label: '到货日期', fmt: (r) => fmtDate(r.arrival_date) },
        { key: 'created_at', label: '创建时间', fmt: (r) => fmtDate(r.created_at) },
      ];
      return {
        text: `补货单（最近 ${rows.length} 条，共 ${total} 条）：`,
        cards: [{ kind: 'table', title: '补货单', columns, rows }],
      };
    },
  },

  // ------------------------------------------------------------
  // 14. 帮助
  // ------------------------------------------------------------
  {
    id: 'help',
    title: '帮助',
    desc: '看看我可以帮你查什么',
    examples: ['帮助', '你能查什么'],
    perms: [],
    match: (p) => p.intentId === 'help',
    async run(_p, env) {
      const list = INTENTS.filter(
        (it) => it.id !== 'help' && (it.perms.length === 0 || hasAny(env.perms, it.perms)),
      );
      const chips: ChipItem[] = list.map((it) => ({
        label: it.title,
        send: it.examples[0] || it.title,
      }));
      return {
        text: `我是本地数据查询助手（不联网、不走外部 AI）。可根据权限查询：${list.map((i) => i.title).join('、')}。试试下面任意一个，或直接输入问题（如「查一下 xxx 的库存」「近30天销量」）：`,
        chips,
      };
    },
  },
];

/** 按 id 找意图 */
export function findIntent(id: string): IntentDef | undefined {
  return INTENTS.find((it) => it.id === id);
}

/** 隐藏内部辅助符号，避免未使用告警（保留给组件层使用） */
export const _assistHelpers = { n, fmtInt, fmtDate, pick, unwrap, num2 };
