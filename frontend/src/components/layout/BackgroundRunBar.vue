<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import { useToast } from '@/composables/useToast'
import { useBackgroundRunStore } from '@/stores/backgroundRun'
import { apiErrorText } from '@/utils/apiError'

defineOptions({ name: 'BackgroundRunBar' })

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const store = useBackgroundRunStore()

/** 手动停止: 后端不写 stop_reason, 浮动条直接消失, 由这里给一个轻提示 */
async function onStop() {
  await store.stop()
  toast(t('generate.background.toast_stopped'), 'info')
}

const barRef = ref<HTMLElement | null>(null)
const elapsedMin = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null
let ro: ResizeObserver | null = null

const visible = computed(
  () => !(store.state === 'idle' && !store.stopReason),
)

// 正常结束: stopReason.code === 'max_reached'
const isFinished = computed(
  () => store.stopReason?.code === 'max_reached',
)

// 停止: idle 且有 stopReason 且不是 max_reached
const isStopped = computed(
  () => store.state === 'idle' && !!store.stopReason && !isFinished.value,
)

const isRunning = computed(() => store.state === 'running')

const variant = computed<'running' | 'stopped' | 'finished'>(() => {
  if (isRunning.value) return 'running'
  if (isFinished.value) return 'finished'
  return 'stopped'
})

function computeElapsed() {
  if (!store.startedAt) {
    elapsedMin.value = 0
    return
  }
  elapsedMin.value = Math.max(0, Math.floor((Date.now() / 1000 - store.startedAt) / 60))
}

const elapsedLabel = computed(() => {
  const m = elapsedMin.value
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return t('generate.background.bar_elapsed_hm', { h, m: rem })
  }
  return t('generate.background.bar_elapsed_m', { m })
})

const runningLabel = computed(() => {
  if (store.maxIterations === 0) {
    return t('generate.background.bar_running', { n: store.iteration })
  }
  return t('generate.background.bar_running_max', { n: store.iteration, max: store.maxIterations })
})

const reasonLabel = computed(() => {
  const code = store.stopReason?.code
  if (!code) return ''
  return t(`generate.background.reason.${code}`)
})

/** error_key 优先 (我们自己判定的错误), 否则显示上游原文 */
const detailLabel = computed(() =>
  apiErrorText(store.stopReason, store.stopReason?.detail || ''))

const subLabel = computed(() => {
  if (!reasonLabel.value) return ''
  return detailLabel.value
    ? t('generate.background.reason_detail', { reason: reasonLabel.value, detail: detailLabel.value })
    : reasonLabel.value
})

/* Toast 避让量 = 浮动条自身高度 + 一段间距。
   之所以把间距一起算进变量而不是留在 ToastContainer 里加, 是因为浮动条不可见时
   变量整个被移除, 若在 calc 里硬加间距, 没有浮动条的页面 toast 也会被顶高。 */
const BAR_TOAST_GAP = 12

function setBarLiftVar() {
  const el = barRef.value
  if (el && visible.value) {
    document.documentElement.style.setProperty(
      '--bg-run-bar-lift', `${el.offsetHeight + BAR_TOAST_GAP}px`,
    )
  } else {
    document.documentElement.style.removeProperty('--bg-run-bar-lift')
  }
}

function clearBarLiftVar() {
  document.documentElement.style.removeProperty('--bg-run-bar-lift')
}

function startTick() {
  if (tickTimer) return
  computeElapsed()
  tickTimer = setInterval(computeElapsed, 1000)
}

function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
}

function attachObserver() {
  if (ro || typeof ResizeObserver === 'undefined') return
  const el = barRef.value
  if (!el) return
  ro = new ResizeObserver(() => setBarLiftVar())
  ro.observe(el)
}

function detachObserver() {
  if (ro) { ro.disconnect(); ro = null }
}

watch(visible, (v) => {
  if (v) {
    nextTick(() => { setBarLiftVar(); attachObserver() })
  } else {
    detachObserver()
    stopTick()
    clearBarLiftVar()
  }
}, { immediate: true })

watch(isRunning, (r) => {
  if (r && visible.value) startTick()
  else stopTick()
})

onUnmounted(() => {
  stopTick()
  detachObserver()
  clearBarLiftVar()
})
</script>

<template>
  <div v-if="visible" ref="barRef" class="bg-run-bar" :class="`bg-run-bar--${variant}`">
    <div class="bg-run-bar__body">
      <template v-if="isRunning">
        <MsIcon name="progress_activity" size="sm" color="none" class="bg-run-bar__spin" />
        <span class="bg-run-bar__title">{{ runningLabel }}</span>
        <span class="bg-run-bar__sub">{{ elapsedLabel }}</span>
        <button class="bg-run-bar__btn bg-run-bar__btn--stop" @click="onStop">
          {{ t('generate.background.btn_stop') }}
        </button>
      </template>
      <template v-else-if="isFinished">
        <MsIcon name="check_circle" size="sm" color="none" />
        <span class="bg-run-bar__title">
          {{ t('generate.background.bar_finished', { n: store.iteration }) }}
        </span>
        <span class="bg-run-bar__sub">{{ subLabel }}</span>
        <button class="bg-run-bar__btn bg-run-bar__btn--dismiss" @click="store.dismiss()">
          {{ t('generate.background.btn_dismiss') }}
        </button>
      </template>
      <template v-else>
        <MsIcon name="warning" size="sm" color="none" />
        <span class="bg-run-bar__title">
          {{ t('generate.background.bar_stopped', { n: store.iteration }) }}
        </span>
        <span class="bg-run-bar__sub">{{ subLabel }}</span>
        <button class="bg-run-bar__btn bg-run-bar__btn--dismiss" @click="store.dismiss()">
          {{ t('generate.background.btn_dismiss') }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.bg-run-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 900;
  max-width: calc(100vw - 32px);
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  box-shadow: var(--sh);
  padding: 8px 14px;
  font-size: var(--text-sm);
  color: var(--t1);
}

.bg-run-bar--running { border-color: var(--ac); }
.bg-run-bar--stopped { border-color: var(--red); }
.bg-run-bar--finished { border-color: var(--green); }

.bg-run-bar__body {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
  justify-content: center;
}

.bg-run-bar__title {
  font-weight: 600;
  white-space: nowrap;
}

.bg-run-bar__sub {
  color: var(--t2);
  font-size: var(--text-xs);
  white-space: nowrap;
  min-width: 0;
}

.bg-run-bar__btn {
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  font-size: var(--text-sm);
  padding: 4px 14px;
  border-radius: var(--rs);
  transition: background .15s;
  white-space: nowrap;
  margin-left: var(--sp-1);
}

.bg-run-bar__btn--stop {
  background: var(--red);
  color: #fff;
}
.bg-run-bar__btn--stop:hover {
  background: color-mix(in srgb, var(--red) 85%, #000);
}

.bg-run-bar__btn--dismiss {
  background: var(--bg4);
  color: var(--t1);
  border: 1px solid var(--bd);
}
.bg-run-bar__btn--dismiss:hover {
  background: var(--bd);
}

/* reset .ms vertical-align for flex layout */
.bg-run-bar__body .ms {
  vertical-align: 0;
  flex-shrink: 0;
}

.bg-run-bar__spin {
  animation: bg-run-spin 1s linear infinite;
}

@keyframes bg-run-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .bg-run-bar__spin { animation: none; }
}

@media (max-width: 520px) {
  .bg-run-bar {
    left: 8px;
    right: 8px;
    transform: none;
    max-width: none;
  }
  .bg-run-bar__body {
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }
  .bg-run-bar__btn {
    margin-left: 0;
    width: 100%;
  }
}
</style>
