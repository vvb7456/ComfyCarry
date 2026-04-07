<script setup lang="ts">
/**
 * PromptLibraryGate — Initialization gate for the prompt tag library.
 *
 * Shown when the library is not yet initialized. Offers:
 *   - Import from local data file
 *   - Download + import from remote source
 *   - Real-time SSE progress (downloading / importing)
 *   - Skip / dismiss option
 *
 * Visual style matches ModelDependencyGate.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UsePromptLibraryInitReturn } from '@/composables/generate/usePromptLibraryInit'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'PromptLibraryGate' })

const props = defineProps<{
  init: UsePromptLibraryInitReturn
}>()

const emit = defineEmits<{
  import: []
}>()

const { t } = useI18n({ useScope: 'global' })

const isDownloading = computed(() => props.init.progress.value?.phase === 'downloading')
const isImporting = computed(() => props.init.progress.value?.phase === 'importing')

const progressText = computed(() => {
  const p = props.init.progress.value
  if (!p) return ''
  if (p.phase === 'downloading') {
    return `${t('prompt-library.init.downloading')} ${p.percent}%`
  }
  // importing: step 1/4, 2/4, etc.
  return p.step ? `${p.step} · ${p.done}/${p.total}` : `${p.done}/${p.total}`
})

const progressWidth = computed(() => {
  const p = props.init.progress.value
  if (!p) return '0%'
  if (p.phase === 'downloading') return p.percent + '%'
  // importing: use done/total ratio
  if (p.total > 0) return Math.round(p.done / p.total * 100) + '%'
  return '0%'
})

function onImport() {
  emit('import')
}
</script>

<template>
  <!-- Loading state -->
  <div v-if="init.loading.value" class="plg-gate">
    <Spinner size="md" />
    <div class="plg-loading-text">{{ t('prompt-library.init.checking') }}</div>
  </div>

  <!-- Gate content -->
  <div v-else class="plg-gate">
    <div class="plg-header">
      <MsIcon name="widgets" color="none" class="plg-header-icon" />
      <div class="plg-title">{{ t('prompt-library.init.title') }}</div>
    </div>

    <!-- Data card (matches ModelDependencyGate card style) -->
    <div class="plg-card-grid">
      <div class="plg-card plg-card-selected plg-card-locked">
        <div class="plg-card-check">
          <MsIcon name="check_circle" color="none" />
        </div>
        <div class="plg-card-body">
          <div class="plg-card-name">{{ t('prompt-library.init.data_name') }}</div>
          <div class="plg-card-desc">{{ t('prompt-library.init.data_desc') }}</div>
        </div>
        <div class="plg-card-meta">
          <span class="plg-card-size">~5 MB</span>
          <Badge color="var(--amber)">{{ t('prompt-library.init.required') }}</Badge>
        </div>
      </div>
    </div>

    <!-- Actions area -->
    <div class="plg-actions">
      <!-- Progress (when downloading or importing) -->
      <div v-if="init.importing.value" class="plg-progress-area">
        <div class="plg-progress-wrap">
          <div class="plg-progress-bar" :style="{ width: progressWidth }" />
          <div class="plg-progress-pct">{{ progressText }}</div>
        </div>
        <div class="plg-progress-hint">
          {{ isDownloading ? t('prompt-library.init.downloading') : t('prompt-library.init.importing') }}
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="init.error.value" class="plg-error">
        <MsIcon name="error" size="sm" />
        {{ init.error.value }}
      </div>

      <!-- Button row -->
      <div v-else class="plg-btn-row">
        <BaseButton
          variant="primary"
          size="sm"
          @click="onImport"
        >
          <MsIcon name="download" size="sm" color="none" />
          {{ t('prompt-library.init.download_btn') }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plg-gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--sp-6) var(--sp-4);
  text-align: center;
}



.plg-loading-text {
  color: var(--t2);
  font-size: var(--text-sm);
  margin-top: 12px;
}

.plg-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: var(--sp-4);
}

.plg-header-icon {
  font-size: 2rem;
  color: var(--ac);
  opacity: .7;
}

.plg-title {
  color: var(--t1);
  font-weight: 600;
  font-size: var(--text-base);
}

/* Data card (mirrors ModelDependencyGate card) */
.plg-card-grid {
  display: flex;
  gap: var(--sp-3);
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
}

.plg-card {
  flex: 1 1 220px;
  max-width: 320px;
  min-width: 200px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  user-select: none;
  text-align: center;
}

.plg-card-selected {
  border-color: var(--ac);
  background: color-mix(in srgb, var(--ac) 6%, var(--bg2));
}

.plg-card-locked { cursor: default; }

.plg-card-check {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.plg-card-check .ms {
  font-size: 1.25rem;
  color: var(--t3);
  transition: color .15s;
}
.plg-card-selected .plg-card-check .ms { color: var(--ac); }

.plg-card-body {
  flex: 1;
  min-width: 0;
}
.plg-card-name {
  font-weight: 500;
  font-size: var(--text-sm);
  line-height: 1.3;
  white-space: nowrap;
}
.plg-card-desc {
  font-size: var(--text-xs);
  color: var(--t3);
  margin-top: 2px;
}

.plg-card-meta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}
.plg-card-size {
  font-size: var(--text-xs);
  color: var(--t3);
  white-space: nowrap;
}

/* Actions */
.plg-actions {
  margin-top: var(--sp-4);
  width: 100%;
  max-width: 340px;
}

.plg-btn-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
}

.plg-unavailable {
  color: var(--t3);
  font-size: var(--text-xs);
  text-align: center;
  padding: 0 var(--sp-2);
}

.plg-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  color: var(--red);
  font-size: var(--text-sm);
  text-align: center;
  margin-bottom: var(--sp-2);
}

/* Progress */
.plg-progress-area {
  text-align: center;
}

.plg-progress-wrap {
  position: relative;
  height: 24px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-sm);
  overflow: hidden;
}

.plg-progress-bar {
  height: 100%;
  background: var(--ac);
  border-radius: var(--r-sm);
  transition: width .3s ease;
}

.plg-progress-pct {
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

.plg-progress-hint {
  color: var(--t3);
  font-size: var(--text-xs);
  margin-top: 4px;
}
</style>
