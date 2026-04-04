<script setup lang="ts">
/**
 * ActionBar — Progress status + Run/Stop split button
 *
 * Run mode stored in generate store (persisted).
 * Only 'normal' and 'live' modes supported (onChange removed as dead code).
 */
import { computed } from 'vue'
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
}>()

const emit = defineEmits<{
  run: [mode: string]
  stop: []
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
])

const currentRunMode = computed(() =>
  runModes.value.find(m => m.key === state.value.runMode) ?? runModes.value[0]
)

/* ── SplitButton props ── */
const splitLabel = computed(() =>
  isRunning.value ? t('generate.action.stop') : currentRunMode.value.label
)

const splitIcon = computed(() =>
  isRunning.value ? 'stop_circle' : currentRunMode.value.icon
)

const splitVariant = computed<'primary' | 'danger'>(() =>
  isRunning.value ? 'danger' : 'primary'
)

const splitOptions = computed<SplitButtonOption[]>(() =>
  runModes.value.map(m => ({
    key: m.key,
    icon: m.icon,
    label: m.label,
    active: m.key === state.value.runMode,
    disabled: m.disabled,
  }))
)

function onSplitClick() {
  if (isRunning.value) emit('stop')
  else emit('run', state.value.runMode)
}

function onSplitSelect(key: string) {
  if (key === 'normal' || key === 'live') {
    state.value.runMode = key
  }
}
</script>

<template>
  <div class="action-bar">
    <div class="action-bar__status">
      <ComfyProgressBar :state="execState" :elapsed="elapsed" />
    </div>
    <div class="action-bar__actions">
      <SplitButton
        :label="splitLabel"
        :icon="splitIcon"
        :variant="splitVariant"
        :options="splitOptions"
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
}
</style>
