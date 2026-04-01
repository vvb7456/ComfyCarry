<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { useDownloads } from '@/composables/useDownloads'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'

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

const { localCivitaiIds, downloadingVersionIds } = useDownloads()

const versions = computed(() =>
  props.hit?.versions || (props.hit?.version ? [props.hit.version] : []),
)

const localVersions = computed(() => {
  if (!props.hit) return new Set<string>()
  return localCivitaiIds.value.get(String(props.hit.id)) || new Set<string>()
})

function isLocal(versionId: number): boolean {
  return localVersions.value.has(String(versionId))
}

function isDownloading(versionId: number): boolean {
  return downloadingVersionIds.value.has(String(versionId))
}

function handleDownload(versionId: number) {
  if (!props.hit) return
  emit('download', String(props.hit.id), (props.hit.type || 'Checkpoint').toLowerCase(), versionId)
  emit('update:modelValue', false)
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
        :class="{ 'vp-item--local': isLocal(v.id) }"
      >
        <div class="vp-info">
          <span class="vp-name">{{ v.name || v.id }}</span>
          <Badge v-if="v.baseModel" size="sm">{{ v.baseModel }}</Badge>
        </div>
        <BaseButton
          v-if="isLocal(v.id)"
          size="sm"
          disabled
          class="vp-done"
        >
          {{ t('models.civitai.already_local') }}
        </BaseButton>
        <BaseButton
          v-else-if="isDownloading(v.id)"
          size="sm"
          disabled
          class="vp-busy"
        >
          {{ t('models.civitai.downloading') }}
        </BaseButton>
        <BaseButton
          v-else
          size="sm"
          variant="primary"
          @click="handleDownload(v.id)"
        >
          {{ t('models.downloads.download') }}
        </BaseButton>
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

.vp-done,
.vp-busy {
  opacity: .5;
  cursor: default;
}
</style>
