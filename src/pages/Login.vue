<template>
  <div class="login">
    <form class="card" @submit.prevent="onSubmit">
      <h1>跨境电商管理系统</h1>
      <input v-model="email" type="email" placeholder="邮箱" required autocomplete="username" />
      <input v-model="password" type="password" placeholder="密码" required autocomplete="current-password" />

      <!-- Cloudflare Turnstile 人机验证 -->
      <div ref="turnstileEl" class="turnstile-wrap"></div>

      <label class="remember">
        <input v-model="rememberMe" type="checkbox" />
        <span>记住邮箱</span>
      </label>

      <button type="submit" :disabled="loading">{{ loading ? '登录中...' : '登录' }}</button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { addLog } from '@/utils/log'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const rememberMe = ref(false)

const REMEMBER_KEY = 'cb_remembered_email'

// ---- Cloudflare Turnstile 人机验证 ----
const TURNSTILE_SITE_KEY = '0x4AAAAAAET5sL5IBFTnS8m-'
const turnstileEl = ref<HTMLElement | null>(null)
const turnstileToken = ref('')
let turnstileWidgetId: string | null = null

declare global {
  interface Window {
    turnstile?: any
  }
}

function loadTurnstileScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('验证码组件加载失败，请刷新重试'))
    document.head.appendChild(s)
  })
}

function renderTurnstile() {
  if (!window.turnstile || !turnstileEl.value) return
  turnstileWidgetId = window.turnstile.render(turnstileEl.value, {
    sitekey: TURNSTILE_SITE_KEY,
    callback: (token: string) => {
      turnstileToken.value = token
    },
    'expired-callback': () => {
      turnstileToken.value = ''
    },
    'error-callback': () => {
      turnstileToken.value = ''
    },
  })
}

function resetTurnstile() {
  turnstileToken.value = ''
  if (window.turnstile && turnstileWidgetId) {
    window.turnstile.reset(turnstileWidgetId)
  } else if (window.turnstile && turnstileEl.value) {
    renderTurnstile()
  }
}

// ---- 记住邮箱（仅记住邮箱，不存密码） ----
function loadRememberedEmail() {
  try {
    return localStorage.getItem(REMEMBER_KEY) || ''
  } catch {
    return ''
  }
}

function saveRememberedEmail(emailVal: string) {
  try {
    localStorage.setItem(REMEMBER_KEY, emailVal.trim())
  } catch {
    /* ignore */
  }
}

onMounted(() => {
  loadTurnstileScript()
    .then(() => renderTurnstile())
    .catch((e) => {
      error.value = e?.message || '验证码组件加载失败'
    })
  const saved = loadRememberedEmail()
  if (saved) {
    email.value = saved
    rememberMe.value = true
  }
})

onUnmounted(() => {
  if (window.turnstile && turnstileWidgetId) {
    window.turnstile.remove(turnstileWidgetId)
  }
})

async function onSubmit() {
  error.value = ''
  if (!email.value.trim()) {
    error.value = '请输入邮箱'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    return
  }
  if (!turnstileToken.value) {
    error.value = '请完成人机验证'
    return
  }

  loading.value = true
  try {
    await auth.signIn(email.value.trim(), password.value, turnstileToken.value)
    if (rememberMe.value) {
      saveRememberedEmail(email.value)
    } else {
      try {
        localStorage.removeItem(REMEMBER_KEY)
      } catch {
        /* ignore */
      }
    }
    addLog('success', '登录系统', email.value.trim())
    ElMessage.success('欢迎回来，登录成功！')
    router.push('/dashboard')
  } catch (e: any) {
    const err = e?.response?.data?.error
    const code = err?.code || ''
    const msg = err?.message || e?.message || '登录失败'
    if (code === 'ACCOUNT_LOCKED') {
      error.value = msg
      ElMessage.error(msg)
    } else if (code === 'INVALID_CREDENTIALS') {
      error.value = msg
      ElMessage.error('用户名或密码错误')
    } else if (code === 'CAPTCHA_INVALID' || /captcha/i.test(msg)) {
      error.value = '人机验证失败，请重试'
    } else if (code === 'RATE_LIMITED') {
      error.value = '请求过于频繁，请稍后再试'
    } else {
      error.value = msg
    }
    resetTurnstile()
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login { height: 100%; display: flex; align-items: center; justify-content: center; position: relative; z-index: 1; }
.card {
  width: 380px; padding: 36px;
  background: var(--glass-bg-strong);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  border: none;
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight);
  border-radius: var(--radius-lg);
  display: flex; flex-direction: column; gap: 16px;
}
h1 { font-size: 20px; text-align: center; color: var(--ink); }
input { padding: 11px 14px; border: 1px solid rgba(255,255,255,0.45); border-radius: var(--radius-sm); font-size: 14px; background: rgba(255,255,255,.55); color: var(--ink); outline: none; transition: box-shadow .2s ease; }
input:focus { box-shadow: 0 0 0 2px var(--accent); }
button { padding: 11px; background: linear-gradient(135deg, #38bdf8, #6366f1); color: #fff; border: none; border-radius: 999px; cursor: pointer; font-weight: 600; box-shadow: 0 10px 26px rgba(99,102,241,.35); transition: opacity .2s ease; }
button:hover { opacity: .95; }
button:disabled { opacity: .6; cursor: not-allowed; }
.error { color: #e5484d; font-size: 13px; margin: 0; }
.turnstile-wrap { min-height: 65px; display: flex; justify-content: center; }
.remember { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-3); cursor: pointer; }
.remember input { width: 14px; height: 14px; }
</style>
