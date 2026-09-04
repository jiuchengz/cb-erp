// ===== 权限码治理（058 拆分后 · 严格独立授权模式） =====
// 058 迁移把 system.manage 整组门禁拆分为 system.* 子码，并把旧业务读码拆为
// product_total.read / cost_profit.read / stocktake.read 等独立读码。
//
// 重要：本文件不再做任何"旧码等价展开 / 自动补位"。
// 角色拥有什么码就显示什么菜单、通过什么接口门禁；system.manage 等旧整组码一律按死码清洗，
// 避免"勾一个旧码 = 整组功能全开"导致运营等低权限角色出现整组菜单全可见的越权扩散。
//
// 角色重配入口：系统设置 → 角色管理，逐码勾选后保存；保存时旧死码（含 system.manage）会被
// 从角色上剥离并落库清理，角色权限集合逐步收敛为严格的显式授权。

export const SYSTEM_MANAGE_EXPAND = [
  'system.users',
  'system.roles',
  'system.permissions',
  'system.settings',
  'system.appearance',
  'system.logo',
  'system.backup',
  'system.usage',
  'system.audit',
  'system.logs',
  'system.recycle',
];

// 已无业务消费的失效码：不参与授权 UI 展示，保存角色时统一清洗丢弃。
// - user.read：058 拆分后无任何消费方（读取类入口均已改为模块读码）
// - sales.cancel：后端预留但前端无任何入口
// - system.manage：整组旧门禁，已由 system.* 子码替代，严禁再按整组展开授权
// 注意：permissions 表记录刻意保留，避免删除影响历史 role_permissions 关联与读取；
//      角色保存（PATCH/POST）会删除旧关联并仅落库清洗后的显式码。
export const LEGACY_DEAD_CODES = ['user.read', 'sales.cancel', 'system.manage'];

// 保持函数签名兼容（auth.ts 曾调用做运行时展开）。现在不展开、不补位，
// 仅做死码清洗，保证返回的权限集合 = 角色在 permissions 表实际显式授权的码。
export function expandSystemManage(codes: string[]): string[] {
  const dead = new Set(LEGACY_DEAD_CODES);
  return Array.from(new Set((codes || []).filter((c) => !dead.has(c))));
}

// 保存/展示用：剔除死码（不再做旧码等价展开），得到规范化权限码集合。
export function normalizeRoleCodes(codes: string[]): string[] {
  return expandSystemManage(codes || []);
}
