<template>
  <teleport to="body">
    <!-- 悬浮入口按钮 -->
    <button
      v-if="!panelOpen"
      class="ca-fab"
      title="数据查询助手"
      aria-label="打开数据查询助手"
      @click="openPanel"
    >
      <el-icon :size="20"><chat-dot-round /></el-icon>
    </button>

    <!-- 弹窗面板 -->
    <transition name="ca-pop">
      <div v-if="panelOpen" class="ca-panel">
        <!-- 头部 -->
        <div class="ca-header">
          <div class="ca-title">
            <span class="ca-logo"><el-icon :size="15"><chat-dot-round /></el-icon></span>
            <div class="ca-title-txt">
              <div class="ca-name">数据查询助手</div>
              <div class="ca-sub">本地规则 · 只读查询 · 权限随账号</div>
            </div>
          </div>
          <div class="ca-actions">
            <button class="ca-icon-btn" title="清空对话" @click="clearChat"><el-icon><delete /></el-icon></button>
            <button class="ca-icon-btn" title="关闭" @click="panelOpen = false"><el-icon><close /></el-icon></button>
          </div>
        </div>

        <!-- 消息区 -->
        <div ref="listRef" class="ca-list">
          <div
            v-for="m in messages"
            :key="m.id"
            class="ca-msg-row"
            :class="m.role"
          >
            <div v-if="m.role === 'assistant'" class="ca-avatar ca-avatar-ai">助</div>
            <div class="ca-bubble-wrap">
              <div class="ca-bubble" :class="{ 'ca-bubble-error': m.error }">
                <div class="ca-bubble-text">{{ m.text }}</div>
              </div>

              <!-- 结果卡片 -->
              <template v-if="m.cards && m.cards.length">
                <div v-for="(card, ci) in m.cards" :key="ci" class="ca-card">
                  <div v-if="card.kind === 'stats'" class="ca-card-stats">
                    <div v-if="card.title" class="ca-card-title">{{ card.title }}</div>
                    <div class="ca-stats-grid">
                      <div v-for="(it, ii) in card.items" :key="ii" class="ca-stat">
                        <div class="ca-stat-label">{{ it.label }}</div>
                        <div class="ca-stat-value">{{ it.value }}</div>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="card.kind === 'table'" class="ca-card-table">
                    <div v-if="card.title" class="ca-card-title">{{ card.title }}</div>
                    <el-table :data="card.rows" size="small" border class="ca-table">
                      <el-table-column
                        v-for="(col, ci2) in card.columns"
                        :key="ci2"
                        :label="col.label"
                        :min-width="col.minWidth || 110"
                        :show-overflow-tooltip="true"
                      >
                        <template #default="{ row, $index }">
                          {{ cellText(col, row, $index) }}
                        </template>
                      </el-table-column>
                    </el-table>
                    <div v-if="card.note" class="ca-card-note">{{ card.note }}</div>
                  </div>
                </div>
              </template>

              <!-- 快捷点选 -->
              <div v-if="m.chips && m.chips.length" class="ca-chips">
                <button
                  v-for="(c, ci) in m.chips"
                  :key="ci"
                  class="ca-chip"
                  :disabled="busy"
                  @click="send(c.send)"
                >
                  {{ c.label }}
                </button>
              </div>
              <div v-if="m.time" class="ca-time">{{ m.time }}</div>
            </div>
            <div v-if="m.role === 'user'" class="ca-avatar ca-avatar-user">{{ userInitial }}</div>
          </div>

          <!-- 输入思考中 -->
          <div v-if="busy" class="ca-msg-row assistant">
            <div class="ca-avatar ca-avatar-ai">助</div>
            <div class="ca-bubble ca-typing"><i></i><i></i><i></i></div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="ca-input-area">
          <textarea
            v-model="draft"
            class="ca-input"
            rows="2"
            placeholder="试试：经营总览 / 查一下某个商品 / 低库存预警 / 近30天销量……"
            :disabled="busy"
            @keydown.enter.exact.prevent="send()"
            @keydown.enter.shift="onShiftEnter"
          ></textarea>
          <div class="ca-input-foot">
            <span class="ca-hint">Enter 发送 · Shift+Enter 换行</span>
            <button class="ca-send" :disabled="busy || !draft.trim()" @click="send()">
              <el-icon :size="16"><promotion /></el-icon>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ChatDotRound, Close, Delete, Promotion } from '@element-plus/icons-vue';
import type { AskCtx, ChipItem, MsgCard, TableCol } from '@/assistant/types';
import { parseInput, visibleIntents, findIntent } from '@/assistant/engine';
import { INTENTS } from '@/assistant/intents';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

/* ---------- 状态 ---------- */
const panelOpen = ref(false);
const busy = ref(false);
const draft = ref('');
const listRef = ref<HTMLDivElement | null>(null);

interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  cards?: MsgCard[];
  chips?: ChipItem[];
  time?: string;
  error?: boolean;
}

let seq = 0;
function nextId(): number {
  seq += 1;
  return seq;
}
function nowHm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const messages = ref<ChatMsg[]>([]);
/** 对话上下文（用于“它 / 这个”代词引用上一条商品结果） */
const chatCtx = ref<AskCtx>({});

const userInitial = computed(() => {
  const name = auth.user?.user_metadata?.name || auth.user?.email || '?';
  return (String(name) || '?').trim().charAt(0).toUpperCase();
});

/* ---------- 卡片取值 ---------- */
function cellText(col: TableCol, row: any, index: number): string | number {
  if (col.fmt) return col.fmt(row, index);
  const raw = col.key
    .split('.')
    .reduce((acc: any, k: string) => (acc == null ? undefined : acc[k]), row);
  if (raw === undefined || raw === null || raw === '') return '—';
  return raw;
}

/* ---------- 消息与对话流程 ---------- */
function pushMsg(m: Omit<ChatMsg, 'id'>): number {
  const id = nextId();
  messages.value.push({ id, ...m });
  return id;
}

/** 欢迎语：按权限展示可用意图快捷入口 */
function welcomeChips(): ChipItem[] {
  return visibleIntents(auth.permissions || [])
    .filter((it) => it.id !== 'help')
    .slice(0, 10)
    .map((it) => ({ label: it.title, send: it.examples[0] || it.title }));
}

function initChat() {
  messages.value = [];
  chatCtx.value = {};
  pushMsg({
    role: 'assistant',
    text: '你好，我是 cb-erp 数据查询助手（纯本地规则引擎，不接外部 AI）。以下查询均按当前账号权限实时返回，你可以点选或直接输入：',
    chips: welcomeChips(),
    time: nowHm(),
  });
}

function clearChat() {
  initChat();
  draft.value = '';
}

function openPanel() {
  if (!messages.value.length) initChat();
  panelOpen.value = true;
}

async function send(raw?: string) {
  const text = (raw ?? draft.value).trim();
  if (!text || busy.value) return;
  draft.value = '';
  pushMsg({ role: 'user', text, time: nowHm() });
  busy.value = true;
  try {
    const ctxSnapshot = { ...chatCtx.value };
    const parsed = await parseInput(text, ctxSnapshot);
    const intent = findIntent(parsed.intentId) || findIntent('help');
    const env = { perms: auth.permissions || [], ctx: ctxSnapshot };
    if (!intent) throw new Error('无法解析请求，请换一种说法');
    const result = await intent.run(parsed, env);
    pushMsg({
      role: 'assistant',
      text: result.text || '已为你查询。',
      cards: result.cards,
      chips: result.chips,
      time: nowHm(),
    });
    // 更新上下文：run 返回新商品引用时覆盖，否则保留原引用（支持连续追问）
    if (result.ctx?.product) {
      chatCtx.value = { product: result.ctx.product };
    } else if (parsed.intentId === 'help') {
      // 帮助页不改变上下文
    }
  } catch (e: any) {
    pushMsg({
      role: 'assistant',
      text: `查询出错了：${e?.message || e || '未知错误'}。请稍后重试或换个问法。`,
      error: true,
      time: nowHm(),
    });
  } finally {
    busy.value = false;
  }
}

function onShiftEnter(e: Event) {
  e.preventDefault();
  const ta = e.target as HTMLTextAreaElement;
  const start = ta.selectionStart ?? draft.value.length;
  const end = ta.selectionEnd ?? draft.value.length;
  draft.value = draft.value.slice(0, start) + '\n' + draft.value.slice(end);
  nextTick(() => {
    ta.selectionStart = ta.selectionEnd = start + 1;
  });
}

/* ---------- 自动滚动 ---------- */
watch(
  [() => messages.value.length, busy],
  async () => {
    await nextTick();
    const el = listRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
  { flush: 'post' },
);

onMounted(() => {
  // 确保权限已就绪后再生成欢迎语
  initChat();
});

// 辅助引用，保证类型声明在构建中完整参与（visibleIntents / INTENTS 已在欢迎语逻辑中使用）
void INTENTS;
</script>

<style scoped>
/* ===== 悬浮按钮 ===== */
.ca-fab {
  position: fixed;
  right: 26px;
  bottom: 26px;
  z-index: 9990;
  width: 54px;
  height: 54px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 14px 30px -8px rgba(99, 102, 241, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transition: transform 0.22s ease, box-shadow 0.22s ease;
}
.ca-fab:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 18px 36px -8px rgba(99, 102, 241, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

/* ===== 面板 ===== */
.ca-panel {
  position: fixed;
  right: 26px;
  bottom: 26px;
  z-index: 9991;
  width: min(420px, calc(100vw - 20px));
  height: min(76vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--glass-bg, rgba(255, 255, 255, 0.82));
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  box-shadow: var(--shadow, 0 20px 50px rgba(30, 40, 80, 0.28)), inset 0 1px 0 var(--glass-highlight, rgba(255, 255, 255, 0.6));
  border-radius: var(--radius-lg, 20px);
  border: 1px solid rgba(255, 255, 255, 0.45);
}
html.dark .ca-panel {
  background: var(--glass-bg, rgba(22, 26, 36, 0.88));
  border-color: rgba(255, 255, 255, 0.1);
}

/* ===== 头部 ===== */
.ca-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  flex-shrink: 0;
}
html.dark .ca-header { border-bottom-color: rgba(255, 255, 255, 0.1); }
.ca-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ca-logo {
  width: 30px; height: 30px; flex-shrink: 0;
  border-radius: 10px;
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.35);
}
.ca-title-txt { line-height: 1.2; }
.ca-name { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }
.ca-sub { font-size: 11px; color: var(--ink-3, #64748b); margin-top: 2px; }
.ca-actions { display: flex; gap: 4px; flex-shrink: 0; }
.ca-icon-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 8px;
  background: transparent; color: var(--ink-3, #64748b);
  cursor: pointer; font-size: 14px; transition: background 0.18s ease;
}
.ca-icon-btn:hover { background: rgba(15, 23, 42, 0.06); color: var(--ink, #0f172a); }
html.dark .ca-icon-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }

/* ===== 消息区 ===== */
.ca-list {
  flex: 1;
  overflow-y: auto;
  padding: 14px 14px 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-behavior: smooth;
}
.ca-msg-row { display: flex; gap: 8px; align-items: flex-start; }
.ca-msg-row.user { flex-direction: row-reverse; }
.ca-avatar {
  width: 28px; height: 28px; flex-shrink: 0;
  border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
}
.ca-avatar-ai {
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  color: #fff;
}
.ca-avatar-user {
  background: rgba(15, 23, 42, 0.12);
  color: var(--ink-2, #334155);
}
html.dark .ca-avatar-user { background: rgba(255, 255, 255, 0.14); color: #e2e8f0; }
.ca-bubble-wrap { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
.ca-msg-row.user .ca-bubble-wrap { align-items: flex-end; }
.ca-bubble {
  max-width: 100%;
  padding: 9px 12px;
  border-radius: 14px 14px 14px 4px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink, #0f172a);
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 14px -8px rgba(15, 23, 42, 0.18);
  white-space: pre-wrap;
  word-break: break-word;
}
html.dark .ca-bubble {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #e2e8f0;
}
.ca-msg-row.user .ca-bubble {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.16), rgba(129, 140, 248, 0.16));
  border-color: rgba(99, 102, 241, 0.25);
  border-radius: 14px 14px 4px 14px;
}
.ca-bubble-error { border-color: rgba(229, 72, 77, 0.45) !important; color: #b91c1c !important; }
html.dark .ca-bubble-error { color: #fca5a5 !important; }

/* 输入中动画 */
.ca-typing { display: inline-flex; gap: 4px; align-items: center; padding: 12px 14px; }
.ca-typing i {
  width: 6px; height: 6px; border-radius: 50%;
  background: #94a3b8;
  animation: ca-blink 1.2s infinite ease-in-out;
}
.ca-typing i:nth-child(2) { animation-delay: 0.18s; }
.ca-typing i:nth-child(3) { animation-delay: 0.36s; }
@keyframes ca-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
.ca-time { font-size: 10px; color: var(--ink-3, #94a3b8); padding: 0 2px; }
.ca-msg-row.user .ca-time { text-align: right; }

/* ===== 结果卡片 ===== */
.ca-card {
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  padding: 10px 12px;
  overflow: hidden;
}
html.dark .ca-card { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); }
.ca-card-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-2, #334155);
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px dashed rgba(15, 23, 42, 0.1);
}
html.dark .ca-card-title { color: #cbd5e1; border-bottom-color: rgba(255, 255, 255, 0.12); }
.ca-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
}
.ca-stat-label { font-size: 11px; color: var(--ink-3, #64748b); }
.ca-stat-value { font-size: 16px; font-weight: 800; color: var(--ink, #0f172a); font-variant-numeric: tabular-nums; margin-top: 1px; }
html.dark .ca-stat-value { color: #f1f5f9; }

.ca-card-table { width: 100%; }
.ca-table {
  --el-table-border-color: rgba(15, 23, 42, 0.08);
  --el-table-header-bg-color: rgba(148, 163, 184, 0.12);
  --el-table-row-hover-bg-color: rgba(129, 140, 248, 0.08);
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  border-radius: 8px;
  font-size: 12px;
}
.ca-table :deep(th.el-table__cell) { font-weight: 700; color: var(--ink-2, #334155); padding: 5px 6px; }
.ca-table :deep(td.el-table__cell) { padding: 5px 6px; color: var(--ink, #0f172a); }
html.dark .ca-table :deep(th.el-table__cell) { color: #cbd5e1; }
html.dark .ca-table :deep(td.el-table__cell) { color: #e2e8f0; }
html.dark .ca-table { --el-table-border-color: rgba(255, 255, 255, 0.1); }
.ca-card-note { font-size: 11px; color: var(--ink-3, #64748b); margin-top: 6px; }

/* ===== 快捷 chips ===== */
.ca-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ca-chip {
  max-width: 100%;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--ink-2, #334155);
  background: rgba(129, 140, 248, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.22);
  cursor: pointer;
  transition: all 0.16s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ca-chip:hover:not(:disabled) { background: rgba(129, 140, 248, 0.22); color: var(--ink, #0f172a); }
.ca-chip:disabled { opacity: 0.5; cursor: not-allowed; }
html.dark .ca-chip { color: #cbd5e1; }

/* ===== 输入区 ===== */
.ca-input-area {
  flex-shrink: 0;
  padding: 10px 14px 14px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}
html.dark .ca-input-area { border-top-color: rgba(255, 255, 255, 0.1); }
.ca-input {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  min-height: 46px;
  max-height: 120px;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--ink, #0f172a);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.12);
  outline: none;
  transition: border 0.2s ease, box-shadow 0.2s ease;
}
.ca-input:focus { border-color: rgba(99, 102, 241, 0.6); box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.15); }
html.dark .ca-input { background: rgba(255, 255, 255, 0.07); color: #e2e8f0; border-color: rgba(255, 255, 255, 0.16); }
.ca-input::placeholder { color: var(--ink-3, #94a3b8); }
.ca-input-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}
.ca-hint { font-size: 11px; color: var(--ink-3, #94a3b8); }
.ca-send {
  width: 34px; height: 34px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 6px 14px -4px rgba(99, 102, 241, 0.5);
  transition: transform 0.16s ease, opacity 0.16s ease;
}
.ca-send:hover:not(:disabled) { transform: translateY(-1px); }
.ca-send:disabled { opacity: 0.45; cursor: not-allowed; }

/* ===== 弹窗动画 ===== */
.ca-pop-enter-active, .ca-pop-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.ca-pop-enter-from, .ca-pop-leave-to { opacity: 0; transform: translateY(12px) scale(0.98); }
</style>
