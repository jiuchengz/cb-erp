import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  timeout: 15000
})

api.interceptors.request.use((config) => {
  // 由 Supabase session 自动携带；业务 API 从 Authorization 头取 JWT
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status
    if (status === 401) {
      // 会话失效，跳登录
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)
