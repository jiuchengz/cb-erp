<template>
  <div class="login">
    <form class="card" @submit.prevent="onSubmit">
      <h1>跨境电商管理系统</h1>
      <input v-model="email" type="email" placeholder="邮箱" required />
      <input v-model="password" type="password" placeholder="密码" required />
      <button type="submit" :disabled="loading">{{ loading ? '登录中...' : '登录' }}</button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  loading.value = true
  error.value = ''
  try {
    await auth.signIn(email.value, password.value)
    const redirect = typeof router.currentRoute.value.query.redirect === 'string'
      ? router.currentRoute.value.query.redirect
      : '/dashboard'
    router.push(redirect)
  } catch (e: any) {
    error.value = e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login { height: 100%; display: flex; align-items: center; justify-content: center; }
.card { width: 360px; padding: 32px; background: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.08); display: flex; flex-direction: column; gap: 16px; }
h1 { font-size: 20px; text-align: center; }
input { padding: 10px 12px; border: 1px solid #dcdfe6; border-radius: 4px; font-size: 14px; }
button { padding: 10px; background: var(--color-primary); color: #fff; border: none; border-radius: 4px; cursor: pointer; }
button:disabled { opacity: .6; cursor: not-allowed; }
.error { color: #e5484d; font-size: 13px; }
</style>
