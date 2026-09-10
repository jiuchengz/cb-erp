// ============================================================
// 数据查询助手 - 通用工具函数（无环依赖）
// ============================================================

/** 归一化文本：小写、去空白、去全半角常见标点 */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\u3000，。！？、,.!?；;：:·"'"“”‘’（）()【】\[\]\-—]+/g, '');
}

/** 判断某个字符串是否命中关键词列表（归一化后匹配） */
export function hits(text: string, words: string[]): boolean {
  const t = norm(text);
  return words.some((w) => norm(w).length > 0 && t.includes(norm(w)));
}

/** 判断账号是否具备任一权限码 */
export function hasAny(perms: string[], required: string[]): boolean {
  if (!required || required.length === 0) return true;
  return required.some((p) => perms.includes(p));
}
