import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/services/api'

// 应用 favicon 到浏览器标签页
export function applyFavicon(href: string) {
  if (typeof document === 'undefined') return
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = href
}

export const useSiteStore = defineStore('site', () => {
  const logo = ref<string | null>(null)
  const loaded = ref(false)

  // 拉取站点设置并应用 favicon；失败静默（保留默认）
  async function init() {
    if (loaded.value) return
    loaded.value = true
    try {
      const { data } = await api.get('/system/logo')
      const v: string | null = data?.data?.logo || null
      logo.value = v
      if (v) applyFavicon(v)
    } catch (e) {
      console.warn('[site:init] 加载网站图标失败', e)
    }
  }

  async function saveLogo(value: string | null) {
    const { data } = await api.post('/system/logo', { logo: value || '' })
    logo.value = data?.data?.logo || null
    if (logo.value) applyFavicon(logo.value)
    return data
  }

  return { logo, loaded, init, saveLogo }
})
