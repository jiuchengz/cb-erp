// ============================================================
// 数据查询助手 - 本地意图解析引擎（纯规则，不接 AI）
// 职责：解析用户自然语言 -> 命中意图 + 抽取实体（商品关键词/时间）
// ============================================================
import type { AskCtx, IntentDef, Parsed } from './types';
import { INTENTS } from './intents';
import { hits, norm, hasAny } from './util';

/** 帮助意图 ID */
export const HELP_INTENT = 'help';

export { norm, hits, hasAny };

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 从原始文本抽取时间段：近N天 / 今天 / 具体日期（from 到 to） */
function extractTime(raw: string): { days?: number; from?: string; to?: string } {
  let s = raw;
  let days: number | undefined;
  // 今天
  if (/今天|今日/.test(s)) days = 1;
  // 近N天 / 最近N天 / 过去N天
  let m = s.match(/(?:近|最近|过去|这)?\s*(\d{1,3})\s*(?:天|日)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 366) days = n;
  }
  const dates: string[] = [];
  const dateRe = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/g;
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(s)) !== null) {
    dates.push(
      `${dm[1]}-${String(Number(dm[2])).padStart(2, '0')}-${String(Number(dm[3])).padStart(2, '0')}`,
    );
  }
  let from: string | undefined;
  let to: string | undefined;
  if (dates.length >= 2) {
    const a = dates[0] < dates[1] ? dates[0] : dates[1];
    const b = dates[0] < dates[1] ? dates[1] : dates[0];
    from = a;
    to = b;
  } else if (dates.length === 1) {
    // 单日期：仅统计该日（部分场景由具体意图忽略 to）
    from = dates[0];
    to = dates[0];
  }
  if (days !== undefined) {
    const end = todayStr();
    return { days, from: addDays(end, -(days - 1)), to: end };
  }
  if (from || to) return { from, to };
  return {};
}

/** 抽取疑似 SKU / 编码 / 链接ID 的字母数字串 */
function extractCodeToken(raw: string): string | undefined {
  const re = /\b([A-Za-z][A-Za-z0-9_.-]{1,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const t = m[1];
    const lower = t.toLowerCase();
    if (['sku', 'code', 'link', 'sales', 'stock', 'transfer', 'shipment', 'cost', 'profit', 'summary', 'top'].includes(lower)) continue;
    if (/^[a-z]+$/i.test(t) && t.length <= 8) continue; // 纯英文普通词跳过
    return m[1];
  }
  return undefined;
}

/** 去掉句末商品/查询停用词，返回剩余中文关键词（用作商品名模糊匹配） */
function stripForKw(raw: string, stopWords: string[]): string {
  let s = raw;
  // 先删除时间段
  s = s.replace(/(?:近|最近|过去|这)?\s*\d{1,3}\s*(?:天|日)/g, '');
  s = s.replace(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?/g, '');
  // 删除标点空白
  s = s.replace(/[\s\u3000，。！？、,.!?；;：:"'“”‘’（）()【】\[\]]+/g, '');
  for (const w of stopWords) {
    s = s.split(w).join('');
  }
  s = s.replace(/^(查|看|找|问|搜|请|帮我|一下|下|的|关于|所有|全部|总|最近|近|还有|还有多少|现在)/g, '');
  s = s.replace(/(吗|呢|啊|吧|哦|哟|咯|嘛|了|呢|请|一下|一下)$/g, '');
  return s.trim();
}

/** 意图关键词匹配表（顺序即优先级） */
interface MatchRule {
  intentId: string;
  keywords: string[];
}

const MATCH_RULES: MatchRule[] = [
  { intentId: 'help', keywords: ['帮助', '能做什么', '会什么', '怎么用', '说明', '有哪些功能', '你会什么', '你能查什么', '使用说明', '示例'] },
  { intentId: 'dashboard-overview', keywords: ['总览', '看板', '概况', '概览', '经营', '今天生意', '整体情况', 'dashboard', '首页统计', '全部库存', '在途'] },
  { intentId: 'low-stock', keywords: ['低库存', '库存预警', '预警', '断货', '缺货', '补货预警', '告急', '哪些商品需要补货'] },
  { intentId: 'sales-rank', keywords: ['排行', '热销', 'top', '畅销', '热卖', '最好卖', '卖得最好', '滞销', '榜单', '排名'] },
  { intentId: 'cost-profit', keywords: ['成本', '利润', '毛利', '赚', '亏', '盈利', 'cost', 'profit', '收益', '能赚多少'] },
  { intentId: 'stock-flow', keywords: ['流水', '出入库', '库存变动', '交易记录', '进销存明细', '变动记录'] },
  { intentId: 'sales-summary', keywords: ['销量', '销售额', '销售', '卖了多少', '卖了', '出单', '营业额', 'sales', 'sale', '成交'] },
  { intentId: 'shipment-list', keywords: ['发货', '货件', '物流', '货运', 'shipment', '快递', '货代'] },
  { intentId: 'transfer-list', keywords: ['调拨', 'transfer', '转运'] },
  { intentId: 'purchase-list', keywords: ['采购', '拿货', '进货', 'purchase', '采购单'] },
  { intentId: 'after-sales', keywords: ['售后', '退货', '退款', 'after', '售后单'] },
  { intentId: 'replenishment', keywords: ['补货', 'replenishment', '建议补货', '补货单'] },
  { intentId: 'stock-query', keywords: ['库存', '仓里', '还有货', '有多少货', '存货', 'quantity', '现存量'] },
];

/** 每条意图要从中剥离的停用词（用于取商品名关键词） */
const INTENT_STOP: Record<string, string[]> = {
  'dashboard-overview': ['总览', '看板', '概况', '概览', '经营情况', '经营', '整体情况', '数据'],
  'low-stock': ['低库存', '库存预警', '预警', '断货', '缺货', '告急', '商品', '产品', '提示', '哪些', '需要补货', '补货'],
  'sales-rank': ['销量排行', '销售排行', '排行', '热销', '畅销', '热卖', '最好卖', '卖得最好', '滞销', '榜单', '排名', 'top', '商品', '产品', '链接', '是', '哪些'],
  'cost-profit': ['成本利润', '成本', '利润', '毛利', '盈利', '收益', '能赚多少', '赚', '亏', '多少', '商品', '产品', '是', '的'],
  'stock-flow': ['库存流水', '库存', '流水', '出入库', '变动', '交易记录', '记录', '明细', '商品', '产品', '的', '看看', '查一下'],
  'sales-summary': ['销量', '销售额', '销售', '卖了多少', '卖了', '卖出', '出单', '营业额', 'sales', 'sale', '成交', '多少', '商品', '产品', '是', '的', '汇总', '统计'],
  'shipment-list': ['发货', '发货单', '货件', '物流', '货运', 'shipment', '快递', '货代', '单', '记录', '有', '哪些', '的'],
  'transfer-list': ['调拨', 'transfer', '转运', '单', '记录', '有', '哪些', '的'],
  'purchase-list': ['采购', '拿货', '进货', 'purchase', '单', '记录', '有', '哪些', '的'],
  'after-sales': ['售后', '退货', '退款', 'after', '单', '记录', '有', '哪些', '的'],
  'replenishment': ['补货', 'replenishment', '补货单', '单', '建议', '记录', '有', '哪些', '的'],
  'stock-query': ['库存', '仓里', '还有货', '有多少货', '存货', '现存量', 'quantity', 'stock', '多少', '是', '的', '现在', '海外仓', '海外', '国内仓', '国内', '本地', '仓'],
};

/**
 * 主入口：解析用户输入 -> 匹配意图
 * 兜底策略：文本含疑似商品标识/查询意图时归入 product-search，否则归 help
 */
export async function parseInput(raw: string, ctx: AskCtx): Promise<Parsed> {
  const t = norm(raw);
  const base: Parsed = { intentId: '', raw, text: t };
  if (!t) return { ...base, intentId: 'help' };

  // 时间段抽取
  const time = extractTime(raw);
  if (time.days !== undefined) base.days = time.days;
  if (time.from) base.from = time.from;
  if (time.to) base.to = time.to;

  // 引用代词“它 / 这个 / 该商品”：上下文有商品时附带引用
  let referencedProduct;
  if (/它|这个|该商品|这个商品|上面/.test(raw) && ctx.product) {
    referencedProduct = ctx.product;
    base.referencedProduct = ctx.product;
  }

  for (const rule of MATCH_RULES) {
    if (hits(t, rule.keywords)) {
      base.intentId = rule.intentId;
      const stops = INTENT_STOP[rule.intentId] || [];
      const token = extractCodeToken(raw);
      const badToken =
        !token ||
        /^[a-z]+$/i.test(token) && token.length <= 8 ||
        ['sku', 'code', 'link', 'sales', 'stock', 'transfer', 'shipment', 'cost', 'profit', 'summary', 'top'].includes(token.toLowerCase());
      if (token && !badToken) {
        base.kw = token;
      } else {
        const kw = stripForKw(raw, stops);
        if (kw) base.kw = kw;
      }
      return base;
    }
  }

  // 兜底：疑似商品查询（含英文编码 / 商品名称查询意图）
  const token = extractCodeToken(raw);
  if (token) {
    base.intentId = 'product-search';
    base.kw = token;
    return base;
  }
  const cnRaw = stripForKw(raw, []);
  const cn = cnRaw.replace(/(信息|资料|详情|商品|产品|介绍|档案|是什么|啥|情况)$/, '');
  if (/查|看|找|详情|信息|了解|介绍/.test(t) && cn) {
    base.intentId = 'product-search';
    base.kw = cn;
    return base;
  }
  // 无任何命中且不是空问候 → 帮助
  base.intentId = 'help';
  return base;
}

/** 依据权限过滤意图（任一权限命中即可见），返回排序后的意图 */
export function visibleIntents(perms: string[]): IntentDef[] {
  return INTENTS.filter((it) => hasAny(perms, it.perms));
}

/** 意图是否被账号允许（任一权限命中） */
export function intentAllowed(it: IntentDef, perms: string[]): boolean {
  return hasAny(perms, it.perms || it.apiPerms);
}

/** 按 id 查找意图（找不到返回 undefined） */
export function findIntent(id: string): IntentDef | undefined {
  return INTENTS.find((it) => it.id === id);
}
