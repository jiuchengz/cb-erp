// ============================================================
// 数据查询助手 - 只读接口访问封装
// 复用 src/services/api.ts 的 axios 实例：
//  - baseURL '/api'
//  - 请求拦截器自动注入 Authorization: Bearer <access_token>
// 仅做 GET 只读调用，不改后端、不引入新依赖
// ============================================================
import { api } from '../services/api';

export type FetchResult =
  | { ok: true; body: any }
  | { ok: false; message: string };

/**
 * 只读 GET 请求，自动处理错误结构 { error: { code, message } }
 */
export async function fetchJson(
  url: string,
  params: Record<string, unknown> = {},
): Promise<FetchResult> {
  try {
    const { data } = await api.get(url, { params });
    return { ok: true, body: data };
  } catch (e: any) {
    const msg =
      e?.response?.data?.error?.message ||
      e?.response?.data?.error?.code ||
      e?.message ||
      '请求失败，请稍后重试';
    return { ok: false, message: String(msg) };
  }
}

/**
 * 统一取接口返回的实体：
 * 绝大多数接口为 { data: ... }，/daily-sales/summary 顶层平铺。
 */
export function unwrap(body: any): any {
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return body;
}

/** 数字保留两位（用于金额等） */
export function num2(v: any): number | string {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return Math.round(n * 100) / 100;
}
