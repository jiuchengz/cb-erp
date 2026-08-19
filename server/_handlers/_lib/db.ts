import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let clientUrl = '';
let clientKey = '';

// service_role 客户端：仅存在于服务端，绕过 RLS，用于业务逻辑读写。
// 前端永远拿不到 service_role key。
// 每次调用读取最新 env；env 变化时自动重建 client，
// 避免 Vercel 实例保活导致模块级旧 env/旧 client 残留（曾导致线上用旧 URL 查询空数据）。
export function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!client || clientUrl !== url || clientKey !== serviceKey) {
    client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientUrl = url;
    clientKey = serviceKey;
  }
  return client;
}
