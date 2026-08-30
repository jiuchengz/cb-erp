import { createApp } from 'vue'
import { createPinia } from 'pinia'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
// Element Plus 组件样式由 unplugin-vue-components 按需注入；
// 这里保留 base.css（CSS 变量基础）与暗色模式 css-vars。
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
// 按需引入模式下，函数式调用的 ElMessage / ElMessageBox 样式不会随模板组件自动注入，
// 需显式引入，否则弹窗/消息提示无样式、表现为全屏或异常排版。
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import App from './App.vue'
import router from './router'
import { useSiteStore } from './stores/site'
import './style.css'

// 计算颜色相对亮度（0~1），用于判断背景是否偏暗
function colorLuminance(hex: string): number {
  try {
    let h = hex.trim().replace(/^#/, '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    if (h.length !== 6) return 0.5
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  } catch {
    return 0.5
  }
}

function colorsAreDark(colors: string[]): boolean {
  const valid = colors.filter(Boolean)
  if (!valid.length) return false
  const avg = valid.reduce((sum, c) => sum + colorLuminance(c), 0) / valid.length
  return avg < 0.34
}

// 启动时恢复暗色模式偏好（localStorage cb_dark_mode）
function applySavedDarkMode() {
  try {
    if (localStorage.getItem('cb_dark_mode') === '1') {
      document.documentElement.classList.add('dark')
    }
  } catch {
    /* ignore */
  }
}
applySavedDarkMode()

// 启动时恢复界面外观（玻璃透明度 / 背景配色 / 强调色 / 圆角 / 光斑，由「设置 → 界面外观」写入 cb_appearance）
function applySavedAppearance() {
  try {
    const raw = localStorage.getItem('cb_appearance')
    if (!raw) return
    const saved = JSON.parse(raw)
    const root = document.documentElement.style
    if (typeof saved.opacity === 'number') {
      root.setProperty('--glass-alpha', String(saved.opacity / 100))
    }
    if (Array.isArray(saved.colors) && saved.colors.length >= 4) {
      root.setProperty('--bg-c1', saved.colors[0])
      root.setProperty('--bg-c2', saved.colors[1])
      root.setProperty('--bg-c3', saved.colors[2])
      root.setProperty('--bg-c4', saved.colors[3])
    }
    if (Array.isArray(saved.glow) && saved.glow.length >= 2) {
      root.setProperty('--glow-c1', saved.glow[0])
      root.setProperty('--glow-c2', saved.glow[1])
    }
    if (typeof saved.accent === 'string' && saved.accent) {
      root.setProperty('--accent', saved.accent)
      root.setProperty('--color-primary', saved.accent)
    }
    if (typeof saved.radius === 'number') {
      root.setProperty('--radius-lg', saved.radius + 'px')
    }
    if (typeof saved.glowOpacity === 'number') {
      root.setProperty('--glow-opacity', String(saved.glowOpacity / 100))
    }
    if (saved.glowEnabled === false) {
      document.documentElement.classList.add('no-glow')
    }
    // 深色背景配色启动即联动暗色模式（文字/面板/控件随背景变浅）
    if (colorsAreDark(saved.colors ?? [])) {
      document.documentElement.classList.add('dark')
      try {
        localStorage.setItem('cb_dark_mode', '1')
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
applySavedAppearance()

// 全局错误日志：任何 JS 报错都输出到 console，便于排查刷新后页面异常
window.addEventListener('error', (e) => {
  console.error('[global:error]', e.message, 'at', e.filename + ':' + e.lineno)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[global:unhandledrejection]', e.reason)
})

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
// Element Plus 已改为按需引入（vite.config.ts 自动导入），不再 app.use(ElementPlus)；
// 中文 locale 通过 App.vue 的 el-config-provider 注入。
app.mount('#app')

// 加载网站自定义图标（浏览器标签页 favicon / 登录页 / 侧边栏 logo）
useSiteStore(pinia).init()
