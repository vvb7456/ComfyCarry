<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from './MsIcon.vue'
import Spinner from './Spinner.vue'
import StatusDot from './StatusDot.vue'
import type { LogLine, LogStatus } from '@/composables/useLogStream'

defineOptions({ name: 'LogPanel' })

const props = withDefaults(defineProps<{
  lines: Array<string | LogLine>
  status?: LogStatus
  height?: string
  /** 是否还有更早历史可加载 (有则滚顶时触发, 由 useLogStream 提供) */
  hasMore?: boolean
  /** 正在加载更早历史 (滚顶时显示顶部指示) */
  loadingMore?: boolean
  /** prepend 历史行中 (跳过 scrollToBottom, 避免用户上滚时被拉回底部) */
  prepending?: boolean
  /** 滚动事件回调 (传入滚动元素, 由 useLogStream.onScroll 处理懒加载) */
  onScroll?: (el: HTMLElement) => void
}>(), {
  hasMore: false,
  loadingMore: false,
  prepending: false,
})

const { t } = useI18n({ useScope: 'global' })
const el = ref<HTMLElement | null>(null)
const followTail = ref(true)

const normalizedLines = computed<LogLine[]>(() => props.lines.map((line) => {
  if (typeof line === 'string') {
    return { text: line }
  }
  return line
}))

/** 无日志时面板收成一行 -- 不再留一个 500px 的空黑盒占满首屏 */
const isEmpty = computed(() => normalizedLines.value.length === 0 && props.status !== 'loading')

const statusDot = computed(() => {
  switch (props.status) {
    case 'error': return 'error'
    case 'loading': return 'loading'
    default: return 'running' // standby = tail -f 连上了
  }
})

const statusLabel = computed(() => {
  switch (props.status) {
    case 'error': return t('common.log.error')
    case 'loading': return t('common.log.loading')
    default: return t('common.log.standby')
  }
})

const followTailTitle = computed(() => (
  followTail.value ? t('common.log.follow_off') : t('common.log.follow_on')
))

const followTailIcon = computed(() => (
  followTail.value ? 'gps_fixed' : 'gps_not_fixed'
))

async function scrollToBottom() {
  if (!el.value) return
  await nextTick()
  el.value.scrollTop = el.value.scrollHeight
}

watch(() => props.lines.length, async () => {
  // prepend 历史行时跳过滚底 (用户在上方阅读, 不应被拉回底部)
  if (followTail.value && !props.prepending) {
    await scrollToBottom()
  }
})

function toggleFollowTail() {
  followTail.value = !followTail.value
  if (followTail.value) {
    void scrollToBottom()
  }
}

function handleScroll() {
  if (props.onScroll && el.value) {
    props.onScroll(el.value)
  }
}
</script>

<template>
  <div
    class="log-panel"
    :class="{ 'log-panel--empty': isEmpty }"
    :style="{ height: isEmpty ? 'auto' : (height ?? '320px') }"
  >
    <div class="log-panel__toolbar">
      <span class="log-panel__status">
        <Spinner v-if="status === 'loading'" size="sm" class="log-panel__spinner" />
        <StatusDot v-else :status="statusDot" size="sm" />
        <span class="log-panel__label">{{ statusLabel }}</span>
      </span>
      <button
        type="button"
        class="log-panel__tail-btn"
        :class="{ 'log-panel__tail-btn--active': followTail }"
        :title="followTailTitle"
        :aria-label="followTailTitle"
        @click="toggleFollowTail"
      >
        <MsIcon :name="followTailIcon" size="sm" />
      </button>
      <slot name="toolbar" />
    </div>
    <!-- 顶部加载指示: 往上滚懒加载时显示 -->
    <div v-if="loadingMore" class="log-panel__load-more">
      <Spinner size="sm" /> <span>{{ t('common.log.loading_more') }}</span>
    </div>
    <pre ref="el" class="log-panel__body" @scroll="handleScroll"><span
        v-for="(line, i) in normalizedLines"
        :key="i"
        class="log-line"
        :class="line.className"
      >{{ line.text }}</span></pre>
    <div v-if="!normalizedLines.length && status !== 'loading'" class="log-panel__empty">
      <slot name="empty">{{ t('common.log.empty') }}</slot>
    </div>
  </div>
</template>

<style scoped>
.log-panel {
  background: var(--bg-in, var(--bg2));
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.log-panel__toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 28px;
  padding: 2px 8px;
  border-bottom: 1px solid var(--bd);
  background: var(--bg2);
}

.log-panel__status {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
}

.log-panel__spinner {
  width: 10px !important;
  height: 10px !important;
  border-width: 1.5px !important;
}

.log-panel__label {
  font-size: var(--text-xs);
  color: var(--t3);
}

.log-panel__tail-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
  opacity: .75;
  transition: color .15s ease, opacity .15s ease, transform .15s ease;
}

.log-panel__tail-btn:hover {
  color: var(--t1);
  opacity: 1;
}

.log-panel__tail-btn--active {
  opacity: 1;
  color: var(--ac);
  transform: scale(1.08);
}

.log-panel__load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px;
  font-size: var(--text-xs);
  color: var(--t3);
  border-bottom: 1px solid var(--bd);
}

.log-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-3);
  font-family: var(--mono, 'IBM Plex Mono', monospace);
  font-size: .78rem;
  line-height: 1.55;
  color: var(--t2);
  white-space: pre-wrap;
  /* 只在单个超长 token (URL/路径) 撑破容器时才断它, 正常词不被拆。 */
  overflow-wrap: anywhere;
  word-break: normal;
  margin: 0;
}

.log-line {
  display: block;
}

.log-line.log-error {
  color: var(--red);
}

.log-line.log-warn {
  color: var(--amber);
}

.log-line.log-info {
  color: var(--ac);
}

.log-panel__empty {
  padding: var(--sp-3) var(--sp-4);
  color: var(--t3);
  font-size: var(--text-sm);
}

/* 空态: 只保留工具条 + 一行说明, 不撑出空盒子 */
.log-panel--empty .log-panel__body {
  display: none;
}
</style>
