<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { useDownloads, type VersionDownloadInfo } from '@/composables/useDownloads'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import DownloadButton from './DownloadButton.vue'

defineOptions({ name: 'VersionPickerModal' })

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
  hit: CivitaiHit | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  download: [modelId: string, modelType: string, versionId: number]
}>()

const { getVersionDownloadInfo, cancelDownload, retryVersion } = useDownloads()
const { confirm } = useConfirm()

const versions = computed(() =>
  props.hit?.versions || (props.hit?.version ? [props.hit.version] : []),
)

function versionInfo(versionId: number): VersionDownloadInfo {
  if (!props.hit) return { state: 'idle', progress: 0, speed: 0, downloadId: null }
  return getVersionDownloadInfo(props.hit.id, versionId)
}

function handleDownload(versionId: number) {
  if (!props.hit) return
  const info = versionInfo(versionId)
  // A4: failed → retryVersion; otherwise forward to parent
  if (info.state === 'failed') {
    retryVersion(String(props.hit.id), (props.hit.type || 'Checkpoint').toLowerCase(), versionId)
    return
  }
  emit('download', String(props.hit.id), (props.hit.type || 'Checkpoint').toLowerCase(), versionId)
  // Keep modal open so user sees version button switch to "downloading" state
}

async function handleCancel(versionId: number) {
  const info = versionInfo(versionId)
  if (!info.downloadId) return
  if (await confirm({
    message: t('models.downloads.confirm_cancel', { name: props.hit?.name || '' }),
    variant: 'danger',
    confirmText: t('common.btn.cancel'),
  })) {
    cancelDownload(info.downloadId)
  }
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="t('models.civitai.select_version', { name: hit?.name || '' })"
    size="md"
  >
    <div class="vp-list">
      <div
        v-for="v in versions"
        :key="v.id"
        class="vp-item"
        :class="{ 'vp-item--local': versionInfo(v.id).state === 'installed' }"
      >
        <div class="vp-info">
          <span class="vp-name">{{ v.name || v.id }}</span>
          <Badge v-if="versionInfo(v.id).state === 'installed'" color="#10b981" size="sm">{{ t('models.downloads.installed') }}</Badge>
          <Badge v-if="v.baseModel" size="sm">{{ v.baseModel }}</Badge>
        </div>
        <DownloadButton
          :state="versionInfo(v.id).state"
          :progress="versionInfo(v.id).progress"
          :speed="versionInfo(v.id).speed"
          :cancellable="!!versionInfo(v.id).downloadId"
          @download="handleDownload(v.id)"
          @cancel="handleCancel(v.id)"
        />
      </div>
    </div>

    <template #footer>
      <BaseButton @click="emit('update:modelValue', false)">
        {{ t('common.btn.cancel') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.vp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow-y: auto;
}

.vp-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
}

.vp-item--local {
  opacity: .7;
}

.vp-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.vp-name {
  font-weight: 500;
  font-size: var(--text-sm);
}
</style>
