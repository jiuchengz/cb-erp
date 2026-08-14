import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 环境变量')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
})

// Supabase 默认的 localStorage 存储键，格式为 sb-<project-ref>-auth-token
export const supabaseStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
