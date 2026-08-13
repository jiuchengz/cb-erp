import { z } from 'zod';
import { ApiError } from './error';

// 服务端 Schema Validation：不信任前端传入的任何数据。
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues
      .map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`)
      .join('; ');
    throw new ApiError(400, 'VALIDATION_ERROR', msg);
  }
  return r.data as z.infer<S>;
}

// 通用分页参数 schema
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// UUID 校验
export const uuidSchema = z.string().uuid();
