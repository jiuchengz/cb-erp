<template>
  <div class="page tools-page">
    <div class="page-header">
      <h2>工具</h2>
      <div class="page-desc">常用办公工具已内嵌系统，登录后可直接使用；文件均在本地浏览器处理，不会上传服务器。</div>
    </div>

    <el-tabs v-model="active" type="card" class="tools-tabs">
      <el-tab-pane label="Excel 图片压缩" name="excel" />
      <el-tab-pane label="空海运 & 装箱单计算" name="airsea" />
    </el-tabs>

    <div class="tools-frame">
      <iframe v-show="active === 'excel'" ref="excelFrame" src="/tools/excel-compressor.html" class="tool-iframe" title="Excel 图片压缩工具" @load="syncTheme" />
      <iframe v-show="active === 'airsea'" ref="airseaFrame" src="/tools/airsea-packing.html" class="tool-iframe" title="空海运 & 装箱单计算工具" @load="syncTheme" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const active = ref<'excel' | 'airsea'>('excel')
const excelFrame = ref<HTMLIFrameElement>()
const airseaFrame = ref<HTMLIFrameElement>()

// 外观桥接：把 ERP「界面外观」实时快照（背景配色/渐变方向/光斑/明暗/强调色）同步给内嵌工具，
// 使两个工具页与宿主页面使用完全一致的 CSS 变量值
function syncTheme() {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => (cs.getPropertyValue(n) || '').trim()
  const msg = {
    type: 'cb-appearance',
    dark: document.documentElement.classList.contains('dark'),
    noGlow: document.documentElement.classList.contains('no-glow'),
    bg: [v('--bg-c1'), v('--bg-c2'), v('--bg-c3'), v('--bg-c4')],
    glow: [v('--glow-c1'), v('--glow-c2')],
    angle: v('--bg-angle') || '135deg',
    glowOpacity: v('--glow-opacity') || '0.55',
    accent: v('--accent') || '',
  }
  const target = window.location.origin
  excelFrame.value?.contentWindow?.postMessage(msg, target)
  airseaFrame.value?.contentWindow?.postMessage(msg, target)
}

let themeObserver: MutationObserver | undefined
onMounted(() => {
  syncTheme()
  themeObserver = new MutationObserver(() => syncTheme())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
})
onUnmounted(() => {
  themeObserver?.disconnect()
})
</script>

<style scoped>
.tools-page {
  display: flex;
  flex-direction: column;
}
.tools-tabs {
  flex: none;
}
.tools-frame {
  flex: 1 1 auto;
  height: calc(100vh - 245px);
  min-height: 480px;
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(var(--bg-angle, 135deg), var(--bg-c1) 0%, var(--bg-c2) 38%, var(--bg-c3) 70%, var(--bg-c4) 100%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 12px 40px rgba(40, 60, 120, 0.14);
}
html.dark .tools-frame {
  border-color: rgba(255, 255, 255, 0.10);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.tool-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
</style>
