<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LocalModel } from '@/composables/useLocalModels'
import { fmtBytes } from '@/utils/format'
import { MODEL_CATEGORY_COLORS } from '@/utils/constants'
import ModelCard from './ModelCard.vue'
import Badge from '@/components/ui/Badge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'LocalModelCard' })

const props = defineProps<{
  model: LocalModel
  fetching?: boolean
}>()

const emit = defineEmits<{
  details: [model: LocalModel]
  fetchInfo: [model: LocalModel]
  delete: [model: LocalModel]
  preview: [url: string]
}>()

const { t } = useI18n({ useScope: 'global' })

// ── Image props for ModelCard ──
const previewUrl = computed(() => {
  return props.model.has_preview && props.model.preview_url
    ? props.model.preview_url
    : ''
})

const remotePreviewUrl = computed(() => props.model.remote_preview_url || '')
const remotePreviewType = computed(() => props.model.remote_preview_type || 'image')
const isVideo = computed(() => remotePreviewType.value === 'video')

const zoomUrl = computed(() => {
  if (previewUrl.value) return previewUrl.value
  if (isVideo.value) return ''
  if (remotePreviewUrl.value) return remotePreviewUrl.value
  return ''
})

// ── Badge ──
const badgeColor = computed(() => MODEL_CATEGORY_COLORS[props.model.category])

// ── Capability flags (extra_model_paths may not support fetch/delete) ──
const canFetchInfo = computed(() => props.model.can_fetch_info)
const canDelete = computed(() => props.model.can_delete)

// ── Fetch button label ──
const fetchLabel = computed(() => {
  if (props.fetching) return t('models.local.fetching')
  return props.model.has_info ? t('models.local.fetched') : t('models.local.fetch_info')
})
</script>

<template>
  <ModelCard
    :image-src="previewUrl"
    :image-fallback="remotePreviewUrl"
    :is-video="isVideo"
    :title="model.display_name || model.filename"
    :zoom-url="zoomUrl"
    @click="emit('details', model)"
    @preview="(url) => emit('preview', url)"
  >
    <template #no-image>
      {{ t('models.local.no_preview') }}
    </template>

    <template #meta>
      <Badge :color="badgeColor">{{ model.category.toUpperCase() }}</Badge>
      <Badge v-if="model.base_model">{{ model.base_model }}</Badge>
      <Badge v-else-if="model.architecture && model.architecture !== 'unknown'">{{ model.architecture }}</Badge>
      <span class="mc-size">{{ fmtBytes(model.size_bytes) }}</span>
    </template>

    <template #actions>
      <BaseButton size="sm" variant="success" @click="emit('details', model)">
        {{ t('models.local.details') }}
      </BaseButton>
      <BaseButton
        v-if="canFetchInfo"
        size="sm"
        :variant="model.has_info ? 'default' : 'primary'"
        :disabled="fetching"
        :title="model.has_info ? t('models.local.refetch_tip') : ''"
        @click="emit('fetchInfo', model)"
      >
        <MsIcon v-if="model.has_info && !fetching" name="check" size="xs" />
        {{ fetchLabel }}
      </BaseButton>
      <BaseButton v-if="canDelete" size="sm" variant="danger" square @click="emit('delete', model)">
        <MsIcon name="delete" />
      </BaseButton>
    </template>
  </ModelCard>
</template>

<style scoped>
.mc-size {
  font-size: .78rem;
  color: var(--amber);
  font-weight: 500;
}
</style>
