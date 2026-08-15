<template>
  <div class="login">
    <form class="card" @submit.prevent="onSubmit">
      <h1>跨境电商管理系统</h1>
      <input v-model="email" type="email" placeholder="邮箱" required autocomplete="username" />
      <input v-model="password" type="password" placeholder="密码" required autocomplete="current-password" />

      <!-- 算术验证码 -->
      <div class="captcha-row">
        <span class="captcha-expr" title="点击换一题" @click="generateCaptcha">
          {{ captchaA }} {{ op === '+' ? '+' : op === '-' ? '−' : '×' }} {{ captchaB }} = ?
        </span>
        <input v-model="captchaInput" type="text" placeholder="验证码结果" class="captcha-input" />
      </div>

      <label class="remember">
        <input v-model="rememberMe" type="checkbox" />
        <span>记住密码</span>
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
import { addLog } from '@/utils/log'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const rememberMe = ref(false)

const REMEMBER_KEY = 'cb_remembered_email'
const ATTEMPTS_KEY = 'cb_login_attempts'

// ---- 算术验证码（前端生成，点击换题） ----
const captchaA = ref(0)
const captchaB = ref(0)
const op = ref<'+' | '-' | '*'>('+')
const captchaInput = ref('')

function generateCaptcha() {
  const ops: Array<'+' | '-' | '*'> = ['+', '-', '*']
  const o = ops[Math.floor(Math.random() * ops.length)]
  let a = 0
  let b = 0
  if (o === '+') {
    a = Math.floor(Math.random() * 20) + 1
    b = Math.floor(Math.random() * 20) + 1
  } else if (o === '-') {
    a = Math.floor(Math.random() * 20) + 10
    b = Math.floor(Math.random() * a)
  } else {
    a = Math.floor(Math.random() * 9) + 1
    b = Math.floor(Math.random() * 9) + 1
  }
  op.value = o
  captchaA.value = a
  captchaB.value = b
  captchaInput.value = ''
}

// ---- 失败锁定（按 账号+日期 维度，连续 5 次锁 15 分钟） ----
const LOCK_MS = 15 * 60 * 1000
const MAX_FAILS = 5

function dateStr(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function loadAttempts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveAttempts(m: Record<string, number>) {
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(m))
}

function todayKey(emailVal: string): string {
  return emailVal.trim().toLowerCase() + '_' + dateStr(new Date())
}

function getLockRemain(emailVal: string): number {
  const m = loadAttempts()
  const lockKey = todayKey(emailVal) + '_lock'
  const until = m[lockKey]
  if (!until) return 0
  const remain = until - Date.now()
  return remain > 0 ? remain : 0
}

function recordFail(emailVal: string): { locked: boolean; fails: number } {
  const m = loadAttempts()
  const dayKey = todayKey(emailVal)
  const failKey = dayKey + '_fail'
  const lockKey = dayKey + '_lock'
  const now = Date.now()
  // 若今日已锁定且未过期，直接返回锁定
  if (m[lockKey] && now < m[lockKey]) return { locked: true, fails: m[failKey] || 0 }
  m[failKey] = (m[failKey] || 0) + 1
  if (m[failKey] >= MAX_FAILS) {
    m[lockKey] = now + LOCK_MS
  }
  saveAttempts(m)
  return { locked: (m[failKey] ?? 0) >= MAX_FAILS, fails: m[failKey] || 0 }
}

function clearAttempts(emailVal: string) {
  const m = loadAttempts()
  const dayKey = todayKey(emailVal)
  delete m[dayKey + '_fail']
  delete m[dayKey + '_lock']
  saveAttempts(m)
}

// ---- 记住密码（仅记住邮箱，不存密码） ----
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
  if (parseInt(captchaInput.value, 10) !== (op.value === '+' ? captchaA.value + captchaB.value : op.value === '-' ? captchaA.value - captchaB.value : captchaA.value * captchaB.value)) {
    error.value = '验证码错误，请重试'
    generateCaptcha()
    return
  }

  // 锁定检查
  const remain = getLockRemain(email.value)
  if (remain > 0) {
    error.value = '账户已锁定，请 ' + Math.ceil(remain / 60000) + ' 分钟后再试'
    generateCaptcha()
    return
  }

  loading.value = true
  try {
    await auth.signIn(email.value.trim(), password.value)
    clearAttempts(email.value)
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
    // 成功提示：自动消失，立即跳转 dashboard，无阻塞
    ElMessage.success('欢迎回来，登录成功！')
    router.push('/dashboard')
  } catch (e: any) {
    const msg = e?.message || '登录失败'
    // Supabase 凭据错误统一提示为 用户名或密码错误
    const isCred = /invalid login credentials|invalid email|password/i.test(msg)
    if (isCred) {
      const r = recordFail(email.value)
      if (r.locked) {
        error.value = '密码错误 ' + MAX_FAILS + ' 次，账户已锁定 15 分钟'
        ElMessage.error('密码错误 5 次，账户已锁定 15 分钟')
      } else {
        error.value = '用户名或密码错误（' + r.fails + '/' + MAX_FAILS + '）'
        ElMessage.error('密码错误或用户名错误')
      }
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
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight);
  border-radius: var(--radius-lg);
  display: flex; flex-direction: column; gap: 16px;
}
h1 { font-size: 20px; text-align: center; color: var(--ink); }
input { padding: 11px 14px; border: 1px solid var(--glass-border); border-radius: var(--radius-sm); font-size: 14px; background: rgba(255,255,255,.55); color: var(--ink); outline: none; transition: box-shadow .2s ease; }
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
