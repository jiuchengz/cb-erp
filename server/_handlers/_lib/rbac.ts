import { AuthContext } from './auth';
import { Errors } from './error';

// Backend RBAC：真正的权限校验，前端菜单控制只是 UI 层，不可作为安全机制。
// super_admin 拥有全部权限。
export function requirePermission(ctx: AuthContext, permission: string) {
  if (ctx.roles.includes('super_admin')) return;
  if (!ctx.permissions.includes(permission)) {
    throw Errors.forbidden(`无权限：${permission}`);
  }
}

// 多权限（满足其一即可）
export function requireAnyPermission(ctx: AuthContext, permissions: string[]) {
  if (ctx.roles.includes('super_admin')) return;
  if (!permissions.some((p) => ctx.permissions.includes(p))) {
    throw Errors.forbidden(
      `无权限：${permissions.join(' 或 ')}（当前角色:${ctx.roles.join(',') || '空'}，权限:${ctx.permissions.join(',') || '空'}）`
    );
  }
}
