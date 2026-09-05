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

// 主题桥接：系统亮/暗模式切换时，通过 postMessage 同步给内嵌工具（工具页自身按 cb_dark_mode 与消息双通道切换）
function syncTheme() {
  const dark = document.documentElement.classList.contains('dark')
  const msg = { type: 'cb-theme', dark }
  const target = window.location.origin
  excelFrame.value?.contentWindow?.postMessage(msg, target)
  airseaFrame.value?.contentWindow?.postMessage(msg, target)
}

let themeObserver: MutationObserver | undefined
onMounted(() => {
  syncTheme()
  themeObserver = new MutationObserver(() => syncTheme())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
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
  background: linear-gradient(135deg, #7dd3fc, #c4b5fd 33%, #f9a8d4 66%, #fde68a);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 12px 40px rgba(40, 60, 120, 0.14);
}
html.dark .tools-frame {
  background: linear-gradient(135deg, #1e293b, #312e50 33%, #3b2f4e 66%, #1f2a44);
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
