import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import router from './router'
import './style.css'

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

// 全局错误日志：任何 JS 报错都输出到 console，便于排查刷新后页面异常
window.addEventListener('error', (e) => {
  console.error('[global:error]', e.message, 'at', e.filename + ':' + e.lineno)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[global:unhandledrejection]', e.reason)
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.mount('#app')
