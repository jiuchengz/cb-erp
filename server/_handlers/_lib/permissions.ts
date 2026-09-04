// ===== 权限码兼容与治理（058 拆分后） =====
// 058 迁移把 system.manage 整组门禁拆分为以下 system.* 子码，并把 permissions 表中原
// 持有旧码的角色回填了新码；但回填可能遗漏或角色从未编辑过（DB 仍只存 system.manage）。
// 因此所有读取/鉴权入口必须对 system.manage 做运行时展开，保证存量角色功能不断链；
// 角色保存时再把 system.manage 展开为子码落库，逐步收敛 DB 中不再新增旧整组码。

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
// - system.manage：整组旧门禁，已由 SYSTEM_MANAGE_EXPAND 展开逻辑替代
// 注意：permissions 表记录刻意保留，避免删除影响历史 role_permissions 关联与读取。
export const LEGACY_DEAD_CODES = ['user.read', 'sales.cancel', 'system.manage'];

// 058 迁移的旧业务读码等价补位（迁移仅执行一次；角色此后经 UI 保存可能覆盖丢失补位码，
// 因此读写两端都做展开：旧码角色仍能命中拆分后的新接口门禁，等价旧版可见范围）。
export const LEGACY_READ_EXPAND: Record<string, string[]> = {
  'products.read': ['products.read', 'product_total.read', 'cost_profit.read'],
  'inventory.read': ['inventory.read', 'stocktake.read'],
};

// 鉴权/读权限用：system.manage -> 展开全部子码；旧业务读码 -> 展开拆分补位码；其余原样保留。
export function expandSystemManage(codes: string[]): string[] {
  const set = new Set<string>();
  for (const code of codes || []) {
    if (code === 'system.manage') {
      for (const c of SYSTEM_MANAGE_EXPAND) set.add(c);
    } else {
      set.add(code);
      const extra = LEGACY_READ_EXPAND[code];
      if (extra) for (const c of extra) set.add(c);
    }
  }
  return Array.from(set);
}

// 保存/展示用：先展开旧 system.manage 与旧业务读码为对应新码，再丢弃死码，得到规范化权限码集合。
export function normalizeRoleCodes(codes: string[]): string[] {
  const dead = new Set(LEGACY_DEAD_CODES);
  return expandSystemManage(codes || []).filter((c) => !dead.has(c));
}
