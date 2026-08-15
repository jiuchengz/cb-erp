import type { VercelResponse } from '@vercel/node';

// 统一错误响应格式：{ error: { code, message } }
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function sendError(res: VercelResponse, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

export function handleError(res: VercelResponse, e: unknown) {
  if (e instanceof ApiError) {
    return res.status(e.status).json({ error: { code: e.code, message: e.message } });
  }
  console.error('[api] unhandled error:', e);
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误', detail } });
}

// 常用错误快捷方式
export const Errors = {
  unauthorized: (msg = '未登录或登录已失效') => new ApiError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = '无权限执行此操作') => new ApiError(403, 'FORBIDDEN', msg),
  badRequest: (msg = '请求参数错误') => new ApiError(400, 'BAD_REQUEST', msg),
  notFound: (msg = '资源不存在') => new ApiError(404, 'NOT_FOUND', msg),
  conflict: (msg = '数据冲突') => new ApiError(409, 'CONFLICT', msg),
  rateLimited: (msg = '请求过于频繁，请稍后再试') => new ApiError(429, 'RATE_LIMITED', msg),
};
