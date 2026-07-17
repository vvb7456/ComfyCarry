<script setup lang="ts">
import { watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloads } from '@/composables/useDownloads'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import DownloadItem from '@/components/models/DownloadItem.vue'

defineOptions({ name: 'DownloadsTab' })

const props = defineProps<{ active: boolean }>()

const { t } = useI18n({ useScope: 'global' })

const {
  activeTasks: dlActiveTasks,
  pausedTasks: dlPausedTasks,
  completedTasks: dlCompletedTasks,
  failedTasks: dlFailedTasks,
  pauseDownload: dlPause,
  resumeDownload: dlResume,
  cancelDownload: dlCancel,
  retryDownload: dlRetry,
  pauseAll: dlPauseAll,
  resumeAll: dlResumeAll,
  clearHistory: dlClearHistory,
  startPolling: dlStartPolling,
  stopPolling: dlStopPolling,
  tasks: dlTasks,
} = useDownloads()

// In-progress group: active + queued + paused
const inProgressTasks = computed(() =>
  dlTasks.value.filter(t =>
    t.status === 'active' || t.status === 'queued' || t.status === 'paused',
  ),
)

// History group: complete + failed merged, sorted by completed_at DESC
const historyTasks = computed(() => {
  const merged = [...dlCompletedTasks.value, ...dlFailedTasks.value]
  return merged.sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0))
})

const failedInHistory = computed(() =>
  historyTasks.value.filter(t => t.status === 'failed').length,
)

// Start/stop polling when tab visibility changes
watch(() => props.active, (val) => {
  if (val) dlStartPolling()
  else if (!dlActiveTasks.value.length) dlStopPolling()
}, { immediate: true })
</script>

<template>
  <!-- In-progress: active + queued + paused (always open) -->
  <CollapsibleGroup
    icon="download"
    :title="t('models.downloads.active')"
    :count="inProgressTasks.length"
  >
    <template #title-right>
      <BaseButton v-if="dlPausedTasks.length" size="xs" @click.stop="dlResumeAll()">
        {{ t('models.downloads.start_all') }}
      </BaseButton>
      <BaseButton v-if="dlActiveTasks.length" size="xs" @click.stop="dlPauseAll()">
        {{ t('models.downloads.pause_all') }}
      </BaseButton>
    </template>
    <div v-if="inProgressTasks.length" class="dl-section-list">
      <DownloadItem
        v-for="task in inProgressTasks"
        :key="task.download_id"
        :task="task"
        @pause="dlPause"
        @resume="dlResume"
        @cancel="dlCancel"
      />
    </div>
    <EmptyState v-else icon="download" :message="t('models.downloads.no_active')" />
  </CollapsibleGroup>

  <!-- History: complete + failed merged -->
  <CollapsibleGroup
    icon="history"
    :title="t('models.downloads.history')"
    :count="historyTasks.length"
    :default-open="false"
  >
    <template #title-right>
      <span v-if="failedInHistory" class="dl-fail-badge">{{ failedInHistory }}</span>
      <BaseButton v-if="historyTasks.length" size="xs" @click.stop="dlClearHistory()">
        {{ t('models.downloads.clear_history') }}
      </BaseButton>
    </template>
    <div v-if="historyTasks.length" class="dl-section-list">
      <DownloadItem
        v-for="task in historyTasks"
        :key="task.download_id"
        :task="task"
        @retry="dlRetry"
      />
    </div>
    <EmptyState v-else icon="history" :message="t('models.downloads.no_history')" />
  </CollapsibleGroup>
</template>

<style scoped>
.dl-section-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dl-fail-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: var(--text-xs);
  color: #fff;
  background: var(--red);
  border-radius: 9px;
  margin-right: 4px;
}
</style>
