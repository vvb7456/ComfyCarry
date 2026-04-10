<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloads } from '@/composables/useDownloads'
import { useConfirm } from '@/composables/useConfirm'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import DownloadItem from '@/components/models/DownloadItem.vue'
import BatchAddModal from '@/components/models/BatchAddModal.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'DownloadsTab' })

const props = defineProps<{ active: boolean }>()

const { t } = useI18n({ useScope: 'global' })

const {
  cartItems: dlCartItems,
  cartCount: dlCartCount,
  clearCart: dlClearCart,
  removeFromCart: dlRemoveFromCart,
  activeTasks: dlActiveTasks,
  pausedTasks: dlPausedTasks,
  completedTasks: dlCompletedTasks,
  failedTasks: dlFailedTasks,
  downloadOne: dlDownloadOne,
  downloadAll: dlDownloadAll,
  pauseDownload: dlPause,
  resumeDownload: dlResume,
  cancelDownload: dlCancel,
  retryDownload: dlRetry,
  pauseAll: dlPauseAll,
  resumeAll: dlResumeAll,
  clearHistory: dlClearHistory,
  startPolling: dlStartPolling,
  stopPolling: dlStopPolling,
  getVersionState: dlGetVersionState,
} = useDownloads()

const { confirm } = useConfirm()

const batchAddOpen = ref(false)

// Count of cart items that are NOT yet installed locally
const downloadableCount = computed(() =>
  dlCartItems.value.filter(it =>
    !(it.versionId && dlGetVersionState(it.modelId, it.versionId) === 'installed'),
  ).length,
)

// Start/stop polling when tab visibility changes
watch(() => props.active, (val) => {
  if (val) dlStartPolling()
  else if (!dlActiveTasks.value.length) dlStopPolling()
}, { immediate: true })

async function handleClearCart() {
  if (await confirm({ message: t('models.downloads.confirm_clear') })) dlClearCart()
}
</script>

<template>
  <!-- Favorites -->
  <CollapsibleGroup icon="push_pin" :title="t('models.downloads.pending')" :count="dlCartCount">
    <template #title-right>
      <BaseButton size="sm" @click.stop="batchAddOpen = true">
        <MsIcon name="add" size="xs" /> {{ t('models.downloads.batch_add') }}
      </BaseButton>
      <BaseButton size="sm" variant="primary" :disabled="!downloadableCount" @click.stop="dlDownloadAll()">
        {{ t('models.downloads.download_all') }}<template v-if="downloadableCount">({{ downloadableCount }})</template>
      </BaseButton>
      <BaseButton size="sm" variant="danger" :disabled="!dlCartCount" @click.stop="handleClearCart">
        {{ t('models.downloads.clear_all') }}
      </BaseButton>
    </template>
    <div v-if="dlCartItems.length" class="dl-section-list">
      <DownloadItem
        v-for="item in dlCartItems"
        :key="item.modelId + ':' + (item.versionId || '')"
        :cart-item="item"
        :installed="!!(item.versionId && dlGetVersionState(item.modelId, item.versionId) === 'installed')"
        @download="(it) => dlDownloadOne(it.modelId, it.type, it.versionId)"
        @remove="dlRemoveFromCart"
      />
    </div>
    <EmptyState v-else icon="push_pin" :message="t('models.downloads.no_pending_hint')" />
  </CollapsibleGroup>

  <!-- Active -->
  <CollapsibleGroup icon="download" :title="t('models.downloads.active')" :count="dlActiveTasks.length + dlPausedTasks.length">
    <template #title-right>
      <BaseButton v-if="dlPausedTasks.length" size="xs" @click.stop="dlResumeAll()">
        {{ t('models.downloads.start_all') }}
      </BaseButton>
      <BaseButton v-if="dlActiveTasks.length" size="xs" @click.stop="dlPauseAll()">
        {{ t('models.downloads.pause_all') }}
      </BaseButton>
    </template>
    <div v-if="dlActiveTasks.length || dlPausedTasks.length" class="dl-section-list">
      <DownloadItem
        v-for="task in [...dlActiveTasks, ...dlPausedTasks]"
        :key="task.download_id"
        :task="task"
        @pause="dlPause"
        @resume="dlResume"
        @cancel="dlCancel"
      />
    </div>
    <EmptyState v-else icon="download" :message="t('models.downloads.no_active')" />
  </CollapsibleGroup>

  <!-- Completed -->
  <CollapsibleGroup icon="check_circle" :title="t('models.downloads.completed')" :count="dlCompletedTasks.length" :default-open="false">
    <template #title-right>
      <BaseButton v-if="dlCompletedTasks.length" size="xs" @click.stop="dlClearHistory()">{{ t('models.downloads.clear_history') }}</BaseButton>
    </template>
    <div v-if="dlCompletedTasks.length" class="dl-section-list">
      <DownloadItem
        v-for="task in dlCompletedTasks"
        :key="task.download_id"
        :task="task"
      />
    </div>
    <EmptyState v-else icon="check_circle" :message="t('models.downloads.no_completed')" />
  </CollapsibleGroup>

  <!-- Failed -->
  <CollapsibleGroup icon="error" :title="t('models.downloads.failed')" :count="dlFailedTasks.length" :default-open="false">
    <div v-if="dlFailedTasks.length" class="dl-section-list">
      <DownloadItem
        v-for="task in dlFailedTasks"
        :key="task.download_id"
        :task="task"
        @retry="dlRetry"
      />
    </div>
    <EmptyState v-else icon="error" :message="t('models.downloads.no_failed')" />
  </CollapsibleGroup>

  <!-- Batch Add Modal -->
  <BatchAddModal v-model="batchAddOpen" />
</template>

<style scoped>
.dl-section-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
