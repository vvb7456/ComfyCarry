<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { useDownloads } from '@/composables/useDownloads'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'FavoriteVersionModal' })

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
  hit: CivitaiHit | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  favorite: [modelId: string, versionId: number, versionName: string, baseModel?: string]
  unfavorite: [modelId: string, versionId: number]
}>()

const { getVersionState, isInCart, cartItems } = useDownloads()

const versions = computed(() =>
  props.hit?.versions || (props.hit?.version ? [props.hit.version] : []),
)

function isInstalled(versionId: number) {
  if (!props.hit) return false
  return getVersionState(props.hit.id, versionId) === 'installed'
}

function isFavorited(versionId: number) {
  if (!props.hit) return false
  const mid = String(props.hit.id)
  return cartItems.value.some(it => it.modelId === mid && it.versionId === versionId)
}

function handleFavorite(v: { id: number; name: string; baseModel?: string }) {
  if (!props.hit) return
  const mid = String(props.hit.id)
  if (isFavorited(v.id)) {
    emit('unfavorite', mid, v.id)
  } else {
    emit('favorite', mid, v.id, v.name, v.baseModel)
  }
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="t('models.civitai.select_fav_version', { name: hit?.name || '' })"
    size="md"
  >
    <div class="fv-list">
      <div
        v-for="v in versions"
        :key="v.id"
        class="fv-item"
      >
        <div class="fv-info">
          <span class="fv-name">{{ v.name || v.id }}</span>
          <Badge v-if="isInstalled(v.id)" color="#10b981" size="sm">{{ t('models.downloads.installed') }}</Badge>
          <Badge v-if="v.baseModel" size="sm">{{ v.baseModel }}</Badge>
        </div>
        <BaseButton
          size="sm"
          :variant="isFavorited(v.id) ? 'danger' : 'primary'"
          @click="handleFavorite(v)"
        >
          <MsIcon :name="isFavorited(v.id) ? 'heart_minus' : 'favorite'" size="xs" />
          {{ isFavorited(v.id) ? t('models.civitai.unfavorite') : t('models.civitai.favorite') }}
        </BaseButton>
      </div>
    </div>

    <template #footer>
      <BaseButton @click="emit('update:modelValue', false)">
        {{ t('common.btn.close') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.fv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow-y: auto;
}

.fv-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
}

.fv-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fv-name {
  font-weight: 500;
  font-size: var(--text-sm);
}
</style>
