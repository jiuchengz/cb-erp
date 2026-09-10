// ============================================================
// 数据查询助手 - 共享类型定义
// 纯本地规则引擎，不接入任何外部 AI
// ============================================================

/** 上下文中的商品引用（用于"它/这个/该商品"追问） */
export interface ProductRef {
  name: string;
  code?: string | null;
  sku?: string | null;
  id?: string;
  link_id?: string;
}

/** 会话上下文 */
export interface AskCtx {
  product?: ProductRef;
}

/** 指标卡条目 */
export interface StatItem {
  label: string;
  value: string | number;
}

/** 表格列 */
export interface TableCol {
  key: string;
  label: string;
  minWidth?: number;
  /** 第二参数为行索引（从 0 开始），用于排行类列 */
  fmt?: (row: any, index?: number) => string | number;
}

/** 消息中的结果卡片 */
export type MsgCard =
  | { kind: 'stats'; title?: string; items: StatItem[] }
  | { kind: 'table'; title?: string; columns: TableCol[]; rows: any[]; note?: string };

/** 快捷追问 chip */
export interface ChipItem {
  label: string;
  send: string;
}

/** 聊天消息 */
export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  cards?: MsgCard[];
  chips?: ChipItem[];
  pending?: boolean;
}

/** 意图执行结果 */
export interface IntentResult {
  text?: string;
  cards?: MsgCard[];
  chips?: ChipItem[];
  /** 需要写回的会话上下文变更 */
  ctx?: Partial<AskCtx>;
}

/** 解析后的用户输入 */
export interface Parsed {
  intentId: string;
  /** 原始文本 */
  raw: string;
  /** 归一化文本（小写、去空白、去常见标点） */
  text: string;
  /** 提取出的商品/链接关键词（若有） */
  kw?: string;
  /** 相对天数（近 N 天） */
  days?: number;
  /** 开始日期 YYYY-MM-DD */
  from?: string;
  /** 结束日期 YYYY-MM-DD */
  to?: string;
  /** 命中引用代词且上下文有商品时携带 */
  referencedProduct?: ProductRef;
}

/** 执行环境（权限 + 上下文） */
export interface AssistEnv {
  perms: string[];
  ctx: AskCtx;
}

/** 意图定义 */
export interface IntentDef {
  id: string;
  title: string;
  desc: string;
  examples: string[];
  /** 展示/入口所需的权限码（任一命中即可见） */
  perms: string[];
  /** 真正调用后端接口所需的权限码（任一即可），默认与 perms 相同 */
  apiPerms?: string[];
  match: (p: Parsed) => boolean;
  run: (p: Parsed, env: AssistEnv) => Promise<IntentResult>;
}
