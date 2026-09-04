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
      <iframe v-show="active === 'excel'" src="/tools/excel-compressor.html" class="tool-iframe" title="Excel 图片压缩工具" />
      <iframe v-show="active === 'airsea'" src="/tools/airsea-packing.html" class="tool-iframe" title="空海运 & 装箱单计算工具" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const active = ref<'excel' | 'airsea'>('excel')
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
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  border: 1px solid rgba(40, 60, 120, 0.08);
  box-shadow: 0 8px 30px rgba(40, 60, 120, 0.10);
}
html.dark .tools-frame {
  background: #0f172a;
  border-color: rgba(255, 255, 255, 0.10);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}
.tool-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
</style>
