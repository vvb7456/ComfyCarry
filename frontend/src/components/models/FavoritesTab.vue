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
import type { CartItem } from '@/composables/useDownloads'

defineOptions({ name: 'FavoritesTab' })

const props = defineProps<{ active: boolean }>()

const { t } = useI18n({ useScope: 'global' })

const {
  favoritesItems: favItems,
  favoritesCount: favCount,
  clearFavorites: clearFav,
  removeFavorite: removeFav,
  downloadOne: dlDownloadOne,
  downloadAll: dlDownloadAll,
  refreshStatus: dlRefreshStatus,
  startPolling: dlStartPolling,
  stopPolling: dlStopPolling,
  activeTasks: dlActiveTasks,
  getVersionState: dlGetVersionState,
  getVersionDownloadInfo: dlGetVersionInfo,
  cancelDownload: dlCancelDownload,
  tasks: dlTasks,
  loadFavorites: dlLoadFavorites,
} = useDownloads()

const { confirm } = useConfirm()

const batchAddOpen = ref(false)
const downloadingAll = ref(false)

/** 版本级下载信息 (state + progress/speed/downloadId) — 驱动每行按钮的 spinner */
function itemInfo(item: CartItem) {
  return dlGetVersionInfo(item.modelId, item.versionId || item.modelId)
}

/** hover 取消 — 与 CivitaiModelCard 一致, 先确认再撤 */
async function handleCancel(item: CartItem) {
  const id = itemInfo(item).downloadId
  if (!id) return
  if (await confirm({ message: t('models.downloads.confirm_cancel', { name: item.name || '' }) })) {
    await dlCancelDownload(id)
  }
}

async function handleDownloadAll() {
  downloadingAll.value = true
  try {
    await dlDownloadAll()
  } finally {
    downloadingAll.value = false
  }
}

// Count of favorite items that are NOT yet installed locally
const downloadableCount = computed(() =>
  favItems.value.filter(it =>
    !(it.versionId && dlGetVersionState(it.modelId, it.versionId) === 'installed'),
  ).length,
)

// For each favorite item, surface the error text if the matching task is failed.
// Resolves "toast 一闪即逝" by showing a persistent red error badge + tooltip.
function failedError(item: CartItem): string {
  const mid = String(item.modelId)
  const vid = item.versionId ? String(item.versionId) : mid
  const task = dlTasks.value.find(t => {
    const tvid = t.meta?.version_id ? String(t.meta.version_id) : null
    const tmid = t.meta?.model_id ? String(t.meta.model_id) : null
    return tvid === vid || (!tvid && tmid === mid)
  })
  if (task?.status === 'failed' && task.error) return task.error
  return ''
}

// Start/stop polling when tab visibility changes; ensure favorites loaded
watch(() => props.active, (val) => {
  if (val) {
    dlLoadFavorites()
    dlStartPolling()
    dlRefreshStatus()
  } else if (!dlActiveTasks.value.length) {
    dlStopPolling()
  }
}, { immediate: true })

async function handleClearFavorites() {
  if (await confirm({ message: t('models.downloads.confirm_clear') })) clearFav()
}
</script>

<template>
  <CollapsibleGroup icon="push_pin" :title="t('models.downloads.pending')" :count="favCount">
    <template #title-right>
      <BaseButton size="sm" @click.stop="batchAddOpen = true">
        <MsIcon name="add" size="xs" /> {{ t('models.downloads.batch_add') }}
      </BaseButton>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!downloadableCount"
        :loading="downloadingAll"
        @click.stop="handleDownloadAll"
      >
        {{ t('models.downloads.download_all') }}<template v-if="downloadableCount">({{ downloadableCount }})</template>
      </BaseButton>
      <BaseButton size="sm" variant="danger" :disabled="!favCount" @click.stop="handleClearFavorites">
        {{ t('models.downloads.clear_all') }}
      </BaseButton>
    </template>
    <div v-if="favItems.length" class="fav-section-list">
      <div v-for="item in favItems" :key="item.modelId + ':' + (item.versionId || '')" class="fav-row">
        <DownloadItem
          :cart-item="item"
          :installed="!!(item.versionId && dlGetVersionState(item.modelId, item.versionId) === 'installed')"
          :state="itemInfo(item).state"
          :progress="itemInfo(item).progress"
          :speed="itemInfo(item).speed"
          :download-id="itemInfo(item).downloadId"
          @download="(it) => dlDownloadOne(it.modelId, it.type, it.versionId)"
          @cancel="() => handleCancel(item)"
          @remove="removeFav"
        />
        <div v-if="failedError(item)" class="fav-error" :title="failedError(item)">
          <MsIcon name="error" size="xs" />
          <span>{{ failedError(item) }}</span>
        </div>
      </div>
    </div>
    <EmptyState v-else icon="push_pin" :message="t('models.downloads.no_pending_hint')" />
  </CollapsibleGroup>

  <BatchAddModal v-model="batchAddOpen" />
</template>

<style scoped>
.fav-section-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fav-row {
  position: relative;
}

.fav-error {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 2px 8px;
  font-size: var(--text-xs);
  color: var(--red);
}
</style>
