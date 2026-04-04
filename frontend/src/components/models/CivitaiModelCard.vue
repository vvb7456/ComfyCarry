<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { MODEL_CATEGORY_COLORS } from '@/utils/constants'
import ModelCard from './ModelCard.vue'
import Badge from '@/components/ui/Badge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'CivitaiModelCard' })

const { t } = useI18n()

const props = defineProps<{
  hit: CivitaiHit
  inCart?: boolean
  /** 'idle' | 'downloading' | 'local' */
  downloadState?: string
}>()

const emit = defineEmits<{
  details: [hit: CivitaiHit]
  toggleCart: [hit: CivitaiHit]
  download: [hit: CivitaiHit]
  preview: [url: string]
}>()

// ── Image ──
const CDN_PREFIX = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/'

const imageObj = computed(() => {
  const imgs = props.hit.images?.length ? props.hit.images : (props.hit.version?.images || [])
  return imgs[0] || null
})

const isVideo = computed(() => imageObj.value?.type === 'video')

const imageSrc = computed(() => {
  const url = imageObj.value?.url
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `${CDN_PREFIX}${url}/width=450/default.jpg`
})

const zoomUrl = computed(() => {
  if (!imageSrc.value || isVideo.value) return ''
  const url = imageObj.value?.url
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `${CDN_PREFIX}${url}/default.jpg`
})

// ── Type badge color ──
const TYPE_KEY_MAP: Record<string, string> = {
  checkpoint: 'checkpoints',
  lora: 'loras',
  textualinversion: 'embeddings',
  controlnet: 'controlnet',
  vae: 'vae',
  upscaler: 'upscale_models',
}

const badgeColor = computed(() => {
  const key = TYPE_KEY_MAP[(props.hit.type || '').toLowerCase()] || ''
  return MODEL_CATEGORY_COLORS[key] || ''
})

// ── Meta ──
const baseModel = computed(() => props.hit.version?.baseModel || '')

const allVersions = computed(() =>
  props.hit.versions || (props.hit.version ? [props.hit.version] : []),
)

const versionCount = computed(() => allVersions.value.length)

const downloadCount = computed(() =>
  (props.hit.metrics?.downloadCount || 0).toLocaleString(),
)

// ── Download button state ──
const dlState = computed(() => props.downloadState || 'idle')
</script>

<template>
  <ModelCard
    :image-src="imageSrc"
    :image-fallback="isVideo ? imageSrc : ''"
    :is-video="isVideo"
    :title="hit.name || t('models.local.no_preview')"
    :zoom-url="zoomUrl"
    @click="emit('details', hit)"
    @preview="(url) => emit('preview', url)"
  >
    <template #no-image>
      {{ t('models.local.no_preview') }}
    </template>

    <template #meta>
      <Badge :color="badgeColor">{{ hit.type || '' }}</Badge>
      <Badge v-if="baseModel">{{ baseModel }}</Badge>
      <Badge v-if="versionCount > 1" :title="t('models.civitai.versions_count', { count: versionCount })">v{{ versionCount }}</Badge>
      <span class="cc-dl-count">
        <MsIcon name="download" size="xs" />
        {{ downloadCount }}
      </span>
    </template>

    <template #actions>
      <BaseButton size="sm" variant="success" @click="emit('details', hit)">
        {{ t('models.civitai.details') }}
      </BaseButton>
      <BaseButton
        size="sm"
        :variant="inCart ? 'danger' : 'default'"
        @click="emit('toggleCart', hit)"
      >
        {{ inCart ? t('models.civitai.unfavorite') : t('models.civitai.favorite') }}
      </BaseButton>
      <BaseButton
        v-if="dlState === 'local'"
        size="sm"
        disabled
        class="cc-dl-done"
      >
        {{ t('models.civitai.already_local') }}
      </BaseButton>
      <BaseButton
        v-else-if="dlState === 'partial'"
        size="sm"
        variant="primary"
        @click="emit('download', hit)"
      >
        {{ t('models.downloads.download') }}
      </BaseButton>
      <BaseButton
        v-else-if="dlState === 'downloading'"
        size="sm"
        disabled
        class="cc-dl-busy"
      >
        {{ t('models.civitai.downloading') }}
      </BaseButton>
      <BaseButton
        v-else
        size="sm"
        variant="primary"
        @click="emit('download', hit)"
      >
        {{ t('models.downloads.download') }}
      </BaseButton>
    </template>
  </ModelCard>
</template>

<style scoped>
.cc-dl-count {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: .75rem;
  color: var(--t2);
}

.cc-dl-done,
.cc-dl-busy {
  opacity: .5;
  cursor: default;
}
</style>
