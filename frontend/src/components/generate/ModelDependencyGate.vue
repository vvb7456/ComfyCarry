<script setup lang="ts">
/**
 * ModelDependencyGate — Welcome page overlay for model download.
 *
 * Shows model cards (selectable, with installed/required badges),
 * download button with progress bar, and enter button.
 * Replaces the module panel content until the user dismisses.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UseModelDependencyReturn } from '@/composables/generate/useModelDependency'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'ModelDependencyGate' })

const props = defineProps<{
  dep: UseModelDependencyReturn
  title: string
  minOptional?: number
  /** Hide header + reduce padding when used inside a modal that already has a title bar */
  compact?: boolean
}>()

const emit = defineEmits<{
  enter: []
  download: []
}>()

const { t } = useI18n({ useScope: 'global' })

const needsDownload = computed(() =>
  props.dep.models.value.some(m =>
    props.dep.selected.value.has(m.id)
    && !props.dep.modelStatus.value.get(m.id)?.installed,
  ),
)

const hasSelected = computed(() => props.dep.selected.value.size > 0)

const optionalSelected = computed(() =>
  props.dep.models.value.filter(m => !m.required && props.dep.selected.value.has(m.id)).length,
)

const minOptional = computed(() => props.minOptional ?? 0)

const optionalSatisfied = computed(() => optionalSelected.value >= minOptional.value)

/** Whether the enter button should be shown */
const showEnter = computed(() => hasSelected.value && !needsDownload.value && optionalSatisfied.value)
const showDownload = computed(() => needsDownload.value)
const showHint = computed(() => !optionalSatisfied.value && hasSelected.value && !needsDownload.value)

/** Progress display text */
const progressText = computed(() => {
  const p = props.dep.progress.value
  if (!p) return ''
  const label = `${p.modelIndex + 1}/${p.totalModels} · ${p.modelName}`
  const pct = Math.round(p.percent) + '%'
  const speed = fmtSpeed(p.speed)
  return speed ? `${label} · ${pct} · ${speed}` : `${label} · ${pct}`
})

const progressWidth = computed(() => {
  const p = props.dep.progress.value
  return p ? p.percent + '%' : '0%'
})

function fmtSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return ''
  if (bytesPerSec >= 1073741824) return (bytesPerSec / 1073741824).toFixed(1) + ' GB/s'
  if (bytesPerSec >= 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s'
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s'
  return bytesPerSec + ' B/s'
}

function onCardClick(modelId: string) {
  props.dep.toggleSelect(modelId)
}

function onEnter() {
  props.dep.dismiss()
  emit('enter')
}
</script>

<template>
  <!-- Loading state -->
  <div v-if="dep.loading.value" class="mdep-welcome">
    <Spinner size="md" />
    <div class="mdep-loading-text">{{ t('generate.model_dep.detecting') }}</div>
  </div>

  <!-- Welcome gate -->
  <div v-else class="mdep-welcome" :class="{ 'mdep-welcome--compact': compact }">
    <div v-if="!compact" class="mdep-welcome-header">
      <span class="ms mdep-header-icon">widgets</span>
      <div class="mdep-title">{{ t(title) }}</div>
    </div>

    <!-- Model cards -->
    <div class="mdep-card-grid">
      <div
        v-for="m in dep.models.value"
        :key="m.id"
        class="mdep-card"
        :class="{
          'mdep-card-selected': dep.selected.value.has(m.id),
          'mdep-card-done': dep.modelStatus.value.get(m.id)?.installed,
          'mdep-card-locked': dep.modelStatus.value.get(m.id)?.installed || m.required,
        }"
        @click="onCardClick(m.id)"
      >
        <div class="mdep-card-check">
          <span class="ms">{{ dep.selected.value.has(m.id) ? 'check_circle' : 'radio_button_unchecked' }}</span>
        </div>
        <div class="mdep-card-body">
          <div class="mdep-card-name">{{ m.name }}</div>
          <div v-if="m.description" class="mdep-card-desc">{{ m.description }}</div>
        </div>
        <div class="mdep-card-meta">
          <span v-if="m.size" class="mdep-card-size">{{ m.size }}</span>
          <Badge v-if="dep.modelStatus.value.get(m.id)?.installed" color="var(--green)">{{ t('generate.model_dep.installed') }}</Badge>
          <Badge v-else-if="m.required" color="var(--amber)">{{ t('generate.model_dep.required') }}</Badge>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="mdep-actions">
      <!-- Progress area (when downloading) -->
      <div v-if="dep.downloading.value" class="mdep-progress-area">
        <div class="mdep-progress-wrap">
          <div class="mdep-progress-bar" :style="{ width: progressWidth }" />
          <div class="mdep-progress-pct">{{ progressText }}</div>
        </div>
        <BaseButton variant="danger" size="xs" class="mdep-cancel-btn" @click="dep.cancelDownload()">
          <span class="ms ms-sm">close</span> {{ t('common.btn.cancel') }}
        </BaseButton>
      </div>

      <!-- Error message -->
      <div v-else-if="dep.error.value" class="mdep-error">
        {{ t('generate.model_dep.download_failed') }}: {{ dep.error.value }}
      </div>

      <!-- Button row -->
      <div v-else class="mdep-btn-row">
        <div v-if="showHint" class="mdep-hint">{{ t('generate.model_dep.select_at_least_one') }}</div>
        <BaseButton v-if="showDownload" variant="primary" size="sm" @click="$emit('download')">
          <span class="ms ms-sm">download</span> {{ t('generate.model_dep.download_selected') }}
        </BaseButton>
        <BaseButton v-if="showEnter" variant="primary" size="sm" @click="onEnter">
          <span class="ms ms-sm">arrow_forward</span> {{ t('generate.model_dep.enter') }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mdep-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--sp-6) var(--sp-4);
  text-align: center;
}

.mdep-welcome--compact {
  padding: var(--sp-2) 0;
}

.mdep-loading-text {
  color: var(--t2);
  font-size: .85rem;
  margin-top: 12px;
}

.mdep-welcome-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: var(--sp-4);
}

.mdep-header-icon {
  font-size: 2rem;
  color: var(--ac);
  opacity: .7;
}

.mdep-title {
  color: var(--t1);
  font-weight: 600;
  font-size: var(--text-base);
}

/* Card grid */
.mdep-card-grid {
  display: flex;
  gap: var(--sp-3);
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
}

.mdep-card {
  flex: 1 1 220px;
  max-width: 320px;
  min-width: 200px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  cursor: pointer;
  transition: border-color .15s, background .15s;
  user-select: none;
}
.mdep-card:hover { border-color: var(--bd-f); background: var(--bg3); }

.mdep-card-selected {
  border-color: var(--ac);
  background: color-mix(in srgb, var(--ac) 6%, var(--bg2));
}
.mdep-card-selected:hover { border-color: var(--ac); }

.mdep-card-locked { cursor: default; }

.mdep-card-done {
  border-color: var(--green);
  background: color-mix(in srgb, var(--green) 4%, var(--bg2));
  opacity: .75;
}
.mdep-card-done:hover { border-color: var(--green); }

.mdep-card-check {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.mdep-card-check .ms {
  font-size: 1.25rem;
  color: var(--t3);
  transition: color .15s;
}
.mdep-card-selected .mdep-card-check .ms { color: var(--ac); }
.mdep-card-done .mdep-card-check .ms { color: var(--green); }

.mdep-card-body {
  flex: 1;
  min-width: 0;
}
.mdep-card-name {
  font-weight: 500;
  font-size: var(--text-sm);
  line-height: 1.3;
  white-space: nowrap;
}
.mdep-card-desc {
  font-size: var(--text-xs);
  color: var(--t3);
  margin-top: 2px;
}

.mdep-card-meta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}
.mdep-card-size {
  font-size: var(--text-xs);
  color: var(--t3);
  white-space: nowrap;
}

/* Actions */
.mdep-actions {
  margin-top: var(--sp-4);
  width: 100%;
}
.mdep-btn-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
}

.mdep-hint {
  color: var(--t3);
  font-size: .82rem;
}

.mdep-error {
  color: var(--red);
  font-size: .85rem;
  text-align: center;
}

/* Progress */
.mdep-progress-area { text-align: center; }
.mdep-progress-wrap {
  position: relative;
  height: 24px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.mdep-progress-bar {
  height: 100%;
  background: var(--ac);
  border-radius: var(--r-sm);
  transition: width .3s ease;
}
.mdep-progress-pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--t1);
  mix-blend-mode: difference;
  pointer-events: none;
  white-space: nowrap;
}
.mdep-cancel-btn {
  margin-top: 6px;
}
</style>
