<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { useDownloads } from '@/composables/useDownloads'
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

const { getVersionState } = useDownloads()

const versions = computed(() =>
  props.hit?.versions || (props.hit?.version ? [props.hit.version] : []),
)

function versionState(versionId: number) {
  if (!props.hit) return 'idle' as const
  return getVersionState(props.hit.id, versionId)
}

function handleDownload(versionId: number) {
  if (!props.hit) return
  emit('download', String(props.hit.id), (props.hit.type || 'Checkpoint').toLowerCase(), versionId)
  // Keep modal open so user sees version button switch to "downloading" state
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
        :class="{ 'vp-item--local': versionState(v.id) === 'installed' }"
      >
        <div class="vp-info">
          <span class="vp-name">{{ v.name || v.id }}</span>
          <Badge v-if="versionState(v.id) === 'installed'" color="#10b981" size="sm">{{ t('models.downloads.installed') }}</Badge>
          <Badge v-if="v.baseModel" size="sm">{{ v.baseModel }}</Badge>
        </div>
        <DownloadButton
          :state="versionState(v.id)"
          @download="handleDownload(v.id)"
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
