<script setup lang="ts">
/**
 * ActionBar — Progress status + Run/Stop split button
 *
 * Run mode stored in generate store (persisted).
 * 'normal' / 'live' / 'background' 三态; onChange 已作为 dead code 移除。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import type { ExecState } from '@/composables/useExecTracker'
import SplitButton, { type SplitButtonOption } from '@/components/ui/SplitButton.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'

defineOptions({ name: 'ActionBar' })

const props = defineProps<{
  execState: ExecState | null
  elapsed: number
  submitting?: boolean
  /** 非空 = 主按钮"软禁用": 视觉置灰但仍可点击, 点击时抛 blocked 由父组件 toast 说明原因 */
  blockedReason?: string
  /** 后台运行中: 整条 ActionBar 已被父级 inert 冻结, 主按钮改为不可操作的状态提示 */
  frozen?: boolean
}>()

const emit = defineEmits<{
  run: [mode: string]
  stop: []
  blocked: [reason: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)

/* ── Run mode ── */
interface RunModeConfig {
  key: string
  icon: string
  label: string
  disabled?: boolean
}

const isRunning = computed(() => props.execState != null)

const runModes = computed<RunModeConfig[]>(() => [
  { key: 'normal', icon: 'play_arrow', label: t('generate.action.run') },
  { key: 'live', icon: 'loop', label: t('generate.action.run_live') },
  // 后台模式: ComfyUI 忙时 disabled (props.execState != null)
  { key: 'background', icon: 'schedule', label: t('generate.action.run_background'), disabled: isRunning.value },
])

const currentRunMode = computed(() =>
  runModes.value.find(m => m.key === state.value.runMode) ?? runModes.value[0]
)

/* ── SplitButton props ──
   后台冻结态优先于执行态: 整条 ActionBar 在 inert 子树里点不动, 若仍显示红色
   「停止」会误导用户去点一个不响应的按钮。改为标准样式 + 状态文案,
   真正的停止入口是页面底部的全局浮动条。 */
const splitLabel = computed(() => {
  if (props.frozen) return t('generate.background.btn_running')
  return isRunning.value ? t('generate.action.stop') : currentRunMode.value.label
})

const splitIcon = computed(() => {
  if (props.frozen) return 'schedule'
  return isRunning.value ? 'stop_circle' : currentRunMode.value.icon
})

const splitVariant = computed<'primary' | 'danger'>(() => {
  if (props.frozen) return 'primary'
  return isRunning.value ? 'danger' : 'primary'
})

const splitOptions = computed<SplitButtonOption[]>(() =>
  runModes.value.map(m => ({
    key: m.key,
    icon: m.icon,
    label: m.label,
    active: m.key === state.value.runMode,
    disabled: m.disabled,
  }))
)

/** 软禁用仅作用于"运行"态; 执行中的"停止"永远可点 */
const isBlocked = computed(() => !isRunning.value && !!props.blockedReason)

/** 后台模式轮次上限控件可见性 */
const showIterations = computed(() => state.value.runMode === 'background')

/* ── 轮次上限: 单一胶囊控件 ──
   0 = 无限, 直接渲染成 ∞ (不再并排显示 0 和 ∞ —— 同一个值说两遍)。
   始终是一个 input, 靠聚焦态切换显示, 不做「点击才变输入框」的模式切换。 */
const iterDisplay = ref('')
let iterFocused = false

function syncIterDisplay() {
  if (iterFocused) return
  iterDisplay.value = state.value.maxIterations === 0
    ? t('generate.background.iterations_unlimited')
    : String(state.value.maxIterations)
}
watch(() => state.value.maxIterations, syncIterDisplay, { immediate: true })
watch(showIterations, (v) => { if (v) syncIterDisplay() })

function onIterFocus(e: FocusEvent) {
  iterFocused = true
  // 聚焦时 ∞ 清空成空串, 直接敲数字即可; 非 0 值则全选便于覆写
  iterDisplay.value = state.value.maxIterations === 0 ? '' : String(state.value.maxIterations)
  nextTick(() => (e.target as HTMLInputElement | null)?.select())
}

function onIterBlur() {
  iterFocused = false
  const n = parseInt(iterDisplay.value.replace(/\D/g, ''), 10)
  state.value.maxIterations = Number.isFinite(n) && n > 0 ? n : 0
  syncIterDisplay()
}

function onSplitClick() {
  if (isRunning.value) { emit('stop'); return }
  if (isBlocked.value) { emit('blocked', props.blockedReason!); return }
  emit('run', state.value.runMode)
}

function onSplitSelect(key: string) {
  if (key === 'normal' || key === 'live' || key === 'background') {
    state.value.runMode = key
  }
}
</script>

<template>
  <div class="action-bar">
    <div class="action-bar__status">
      <ComfyProgressBar :state="execState" :elapsed="elapsed" />
    </div>
    <!-- 后台模式轮次上限 (插在进度条右侧、SplitButton 左侧; 进度条 flex:1 自动让出宽度)。
         单一胶囊: 静音前缀 + 数值, 与 SplitButton 等高同圆角。0 渲染为 ∞。 -->
    <label
      v-if="showIterations"
      class="action-bar__iter"
      :title="t('generate.background.iterations_help')"
    >
      <span class="action-bar__iter-lbl">{{ t('generate.background.iterations') }}</span>
      <input
        v-model="iterDisplay"
        class="action-bar__iter-val"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        @focus="onIterFocus"
        @blur="onIterBlur"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        @keydown.esc.prevent="($event.target as HTMLInputElement).blur()"
      >
    </label>
    <div class="action-bar__actions">
      <SplitButton
        :label="splitLabel"
        :icon="splitIcon"
        :variant="splitVariant"
        :options="splitOptions"
        :soft-disabled="isBlocked"
        :loading="submitting"
        @click="onSplitClick"
        @select="onSplitSelect"
      />
    </div>
  </div>
</template>

<style scoped>
.action-bar {
  display: flex;
  align-items: stretch;
  gap: var(--sp-2);
}
.action-bar__status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
/* 单一胶囊: 沿用架构选择器/队列按钮那套 pill 规格 (--bg3 底 + 1px --bd + --rs),
   align-items:stretch 让它与 SplitButton 自动等高, 不写死 height。 */
.action-bar__iter {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
  padding: 0 10px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  cursor: text;
  transition: border-color .15s;
}
.action-bar__iter:hover { border-color: var(--bd-f); }
.action-bar__iter:focus-within { border-color: var(--ac); }

.action-bar__iter-lbl {
  font-size: var(--text-xs);
  color: var(--t3);
  user-select: none;
  white-space: nowrap;
}

.action-bar__iter-val {
  width: 4ch;
  border: none;
  background: none;
  padding: 0;
  color: var(--t1);
  font-family: inherit;
  font-size: var(--text-base);
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: none;
}
.action-bar__actions {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
}
.action-bar__actions :deep(.split-button__main) {
  min-width: 180px;
}
@media (max-width: 768px) {
  .action-bar { flex-direction: column; }
  .action-bar__iter { align-self: flex-start; }
}
</style>
