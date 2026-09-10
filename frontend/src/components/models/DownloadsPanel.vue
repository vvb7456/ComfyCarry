<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloads } from '@/composables/useDownloads'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import DownloadItem from '@/components/models/DownloadItem.vue'

/**
 * DownloadsPanel — 下载任务 (进行中 / 历史), 挂在模型页的「收藏&下载」抽屉里。
 *
 * 不感知自己是否可见: 连接由抽屉打开时统一触发, 见 ModelsPage.openDrawer()。
 */
defineOptions({ name: 'DownloadsPanel' })

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
    <ul v-if="inProgressTasks.length" class="list-plain dl-list">
      <li v-for="task in inProgressTasks" :key="task.download_id">
        <DownloadItem
          :task="task"
          @pause="dlPause"
          @resume="dlResume"
          @cancel="dlCancel"
        />
      </li>
    </ul>
    <EmptyState v-else icon="download" :message="t('models.downloads.no_active')" density="compact" />
  </CollapsibleGroup>

  <!-- History: complete + failed merged -->
  <CollapsibleGroup
    icon="history"
    :title="t('models.downloads.history')"
    :count="historyTasks.length"
    :default-open="false"
  >
    <template #title-right>
      <Badge v-if="failedInHistory" tone="negative">{{ failedInHistory }}</Badge>
      <BaseButton v-if="historyTasks.length" size="xs" @click.stop="dlClearHistory()">
        {{ t('models.downloads.clear_history') }}
      </BaseButton>
    </template>
    <ul v-if="historyTasks.length" class="list-plain dl-list">
      <li v-for="task in historyTasks" :key="task.download_id">
        <DownloadItem
          :task="task"
          @retry="dlRetry"
        />
      </li>
    </ul>
    <EmptyState v-else icon="history" :message="t('models.downloads.no_history')" density="compact" />
  </CollapsibleGroup>
</template>

<style scoped>
/* 下载任务列表: 行组件负责骨架, 容器只发丝线分隔 */
.dl-list > li + li {
  border-top: 1px solid color-mix(in srgb, var(--bd) 65%, transparent);
}
</style>
