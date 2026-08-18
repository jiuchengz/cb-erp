<template>
  <div class="login">
    <form class="card" @submit.prevent="onSubmit">
      <h1>跨境电商管理系统</h1>
      <input v-model="email" type="email" placeholder="邮箱" required autocomplete="username" />
      <input v-model="password" type="password" placeholder="密码" required autocomplete="current-password" />

      <!-- 服务端算术验证码 -->
      <div class="captcha-row">
        <span class="captcha-expr" title="点击换一题" @click="generateCaptcha">
          {{ captchaA }} {{ op === '+' ? '+' : op === '-' ? '−' : '×' }} {{ captchaB }} = ?
        </span>
        <input v-model="captchaInput" type="text" placeholder="验证码结果" class="captcha-input" />
      </div>

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
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/services/api'
import { addLog } from '@/utils/log'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const rememberMe = ref(false)

const REMEMBER_KEY = 'cb_remembered_email'

// ---- 服务端算术验证码（答案只在服务端，一次性） ----
const captchaId = ref('')
const captchaA = ref(0)
const captchaB = ref(0)
const op = ref<'+' | '-' | '*'>('+')
const captchaInput = ref('')

async function generateCaptcha() {
  captchaInput.value = ''
  try {
    const { data } = await api.get('/auth/captcha')
    captchaId.value = data.captchaId
    captchaA.value = data.a
    captchaB.value = data.b
    op.value = data.op
  } catch {
    error.value = '验证码加载失败，请检查网络'
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
  generateCaptcha()
  const saved = loadRememberedEmail()
  if (saved) {
    email.value = saved
    rememberMe.value = true
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
  if (!captchaInput.value) {
    error.value = '请输入验证码结果'
    return
  }

  loading.value = true
  try {
    await auth.signIn(email.value.trim(), password.value, captchaId.value, parseInt(captchaInput.value, 10) || 0)
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
    } else if (code === 'CAPTCHA_INVALID') {
      error.value = '验证码错误或已过期，请重试'
    } else if (code === 'RATE_LIMITED') {
      error.value = '请求过于频繁，请稍后再试'
    } else {
      error.value = msg
    }
    generateCaptcha()
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
.captcha-row { display: flex; gap: 10px; align-items: center; }
.captcha-expr { flex-shrink: 0; background: rgba(255,255,255,.55); padding: 9px 14px; border-radius: var(--radius-sm); font-size: 16px; font-weight: 700; white-space: nowrap; cursor: pointer; user-select: none; color: var(--ink); }
.captcha-input { flex: 1; min-width: 0; }
.remember { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-3); cursor: pointer; }
.remember input { width: 14px; height: 14px; }
</style>
