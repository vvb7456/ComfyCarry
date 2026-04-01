<script setup lang="ts">
/**
 * ComfyProgressBar — ComfyUI execution progress bar.
 *
 * Two modes:
 *   1. Active (state provided):
 *      [ ●  ⚡ 正在生成   3/12 KSampler   15/20 (75%)   0:24 ]
 *   2. Idle (state is null):
 *      [ ⏳ 空闲 ]   — placeholder that reserves layout height
 *
 * Props accept ExecState + elapsed directly from useExecTracker().
 * When state is null, renders idle placeholder to prevent layout shifts.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ExecState } from '@/composables/useExecTracker'
import MsIcon from './MsIcon.vue'

const props = defineProps<{
  state: ExecState | null
  elapsed: number          // milliseconds from useExecTracker
  compact?: boolean        // compact mode for Dashboard activity feed
}>()

const { t } = useI18n({ useScope: 'global' })

const isActive = computed(() => props.state != null)

// ── Progress Calculation (matches legacy formula exactly) ────────────────

const completedCount = computed(() => props.state ? props.state.executedNodes.size + props.state.cachedNodes.size : 0)
const totalNodes = computed(() => props.state?.totalNodes || 0)

const hasSteps = computed(() => props.state?.progress != null && props.state.progress.percent != null)
const stepPct = computed(() => hasSteps.value ? props.state!.progress!.percent : 0)

const fillPct = computed(() => {
  if (!props.state) return 0
  const total = totalNodes.value
  const completed = completedCount.value
  if (total > 0) {
    const baseProgress = Math.max(0, completed - 1) / total
    const currentFraction = hasSteps.value ? (stepPct.value / 100) / total : 0
    return Math.min(100, Math.round((baseProgress + currentFraction) * 100))
  }
  if (hasSteps.value) return stepPct.value
  return 0
})

// ── Display Text ─────────────────────────────────────────────────────────

const nodeName = computed(() => {
  if (!props.state) return ''
  const cn = props.state.currentNode
  if (!cn) return ''
  return props.state.nodeNames?.[cn] || cn
})

const nodeText = computed(() => {
  if (!nodeName.value) return ''
  const total = totalNodes.value || '?'
  return `${completedCount.value}/${total} ${nodeName.value}`
})

const stepText = computed(() => {
  if (!hasSteps.value) return ''
  const p = props.state!.progress!
  const detail = p.value != null ? `${p.value}/${p.max}` : ''
  return `${detail} (${stepPct.value}%)`
})

const timeText = computed(() => {
  const secs = Math.round(props.elapsed / 1000)
  if (secs < 60) return `0:${String(secs).padStart(2, '0')}`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`
  const h = Math.floor(m / 60)
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})
</script>

<template>
  <!-- Active: executing -->
  <div v-if="isActive" class="comfy-progress-bar active" :class="{ 'comfy-progress-bar--compact': compact }">
    <div class="comfy-progress-bar-fill" :style="{ width: fillPct + '%' }" />
    <span class="comfy-progress-pulse" />
    <span class="comfy-progress-label"><MsIcon name="bolt" size="xs" /> {{ t('comfyui.status.generating') }}</span>
    <span v-if="nodeText" class="comfy-progress-node">{{ nodeText }}</span>
    <span class="comfy-progress-steps">{{ stepText }}</span>
    <span class="comfy-progress-time">{{ timeText }}</span>
  </div>
  <!-- Idle: placeholder -->
  <div v-else class="comfy-progress-bar" :class="{ 'comfy-progress-bar--compact': compact }">
    <span class="comfy-progress-label comfy-progress-label--idle">
      <MsIcon name="hourglass_empty" size="xs" /> {{ t('comfyui.status.idle') }}
    </span>
    <span class="comfy-progress-steps"></span>
    <span class="comfy-progress-time"></span>
  </div>
</template>

<style>
/* ── ComfyUI Progress Bar (non-scoped: class names are namespaced) ── */
.comfy-progress-bar {
  position: relative;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: var(--bg-in);
  border: 2px solid var(--bd);
  border-radius: var(--rs);
  font-size: .82rem;
  overflow: hidden;
  gap: 10px;
  min-height: 40px;
}

.comfy-progress-bar.active {
  border-color: rgba(0, 188, 212, .6);
}

.comfy-progress-bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, rgba(74, 222, 128, .22), rgba(0, 188, 212, .18));
  transition: width .3s ease;
  pointer-events: none;
}

.comfy-progress-bar > span {
  position: relative;
  z-index: 1;
}

.comfy-progress-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ac);
  flex-shrink: 0;
  animation: execPulse 1.2s infinite;
}

@keyframes execPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .3; }
}

.comfy-progress-label {
  font-weight: 600;
  color: var(--ac);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.comfy-progress-label--idle {
  color: var(--t3);
  font-weight: 500;
}

.comfy-progress-node {
  color: var(--t2);
  font-size: .78rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.comfy-progress-steps {
  flex: 1;
  text-align: center;
  font-size: .78rem;
  font-weight: 600;
  color: var(--t1);
  white-space: nowrap;
}

.comfy-progress-time {
  font-size: .78rem;
  color: var(--t3);
  white-space: nowrap;
  margin-left: auto;
}

/* ── Compact mode (Dashboard activity feed) ── */
.comfy-progress-bar--compact {
  margin-top: 6px;
  font-size: .72rem;
  padding: 8px 12px;
  min-height: 32px;
  gap: 8px;
}

.comfy-progress-bar--compact .comfy-progress-pulse {
  width: 6px;
  height: 6px;
}

.comfy-progress-bar--compact .comfy-progress-node {
  font-size: .7rem;
  max-width: 140px;
}

.comfy-progress-bar--compact .comfy-progress-steps {
  font-size: .7rem;
}

.comfy-progress-bar--compact .comfy-progress-time {
  font-size: .7rem;
}
</style>
