import type { VercelRequest } from '@vercel/node';
import { Errors } from './error';

export function requestMetadata(req: VercelRequest) {
  const forwarded = req.headers['x-forwarded-for'];
  const userAgent = req.headers['user-agent'];
  return {
    p_ip: Array.isArray(forwarded) ? forwarded[0] ?? null : forwarded ?? null,
    p_user_agent: Array.isArray(userAgent) ? userAgent[0] ?? null : userAgent ?? null,
  };
}

export function throwTransactionError(error: { message?: string }, resourceName: string): never {
  const message = error.message || '';
  if (message.includes('ORDER_NOT_FOUND')) throw Errors.notFound(`${resourceName}不存在`);
  if (message.includes('INVALID_TRANSITION')) throw Errors.conflict('单据状态已变化或不允许执行该状态转换');
  if (message.includes('INSUFFICIENT_INVENTORY')) throw Errors.conflict('库存不足');
  if (message.includes('MISSING_WAREHOUSE')) throw Errors.badRequest(`${resourceName}缺少仓库信息`);
  if (message.includes('ZERO_INVENTORY_QUANTITY')) throw Errors.badRequest('库存变更数量不能为 0');
  throw error;
}
