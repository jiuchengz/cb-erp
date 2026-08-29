import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需自动导入：组件、样式、以及 ElMessage/ElMessageBox 等服务 API
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  server: {
    // 本地预览：/api 代理到线上 Vercel 后端（仅 dev 生效，不影响构建产物）
    proxy: {
      '/api': {
        target: 'https://cb-erp-9x9t.vercel.app',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // element-plus 已按需引入（仅打包实际用到的组件/服务），
          // 仍拆出独立 chunk，避免大量共享组件代码挤入 index 主包。
          if (id.includes('node_modules')) {
            if (id.includes('element-plus') || id.includes('@element-plus')) return 'element-plus'
            // xlsx / jszip 为重库且已改为动态 import，保持独立懒加载 chunk，
            // 不并入 vendor，避免首屏/主包被迫加载。
            if (id.includes('node_modules/xlsx') || id.includes('node_modules/jszip')) return undefined
            if (
              id.includes('node_modules/vue') ||
              id.includes('node_modules/pinia') ||
              id.includes('node_modules/vue-router')
            ) {
              return 'vue-vendor'
            }
            return 'vendor'
          }
        },
      },
    },
  }
})
