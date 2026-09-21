<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { useCivitaiSettings } from '@/composables/useCivitaiSettings'
import { fmtCompact } from '@/utils/format'
import { modelCategoryColor, modelCategoryLabel } from '@/utils/constants'
import ModelCard from './ModelCard.vue'
import Badge from '@/components/ui/Badge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import DownloadButton from './DownloadButton.vue'
import { useConfirm } from '@/composables/useConfirm'
import { useDownloads, type ModelAggregateState, type VersionDownloadInfo } from '@/composables/useDownloads'

defineOptions({ name: 'CivitaiModelCard' })

const { t } = useI18n()

const props = defineProps<{
  hit: CivitaiHit
  isFavorite?: boolean
  /** 'idle' | 'downloading' | 'local' */
  downloadState?: string
}>()

const emit = defineEmits<{
  details: [hit: CivitaiHit]
  toggleFavorite: [hit: CivitaiHit]
  download: [hit: CivitaiHit]
  preview: [url: string]
}>()

const CDN_PREFIX = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/'

// 级别未开放的图不作为封面 (优先挑允许的图); 开放但需模糊的传遮罩给 ModelCard。
const { levelAllows, shouldBlur } = useCivitaiSettings()

const imageObj = computed(() => {
  const imgs = props.hit.images?.length ? props.hit.images : (props.hit.version?.images || [])
  if (!imgs.length) return null
  const allowed = imgs.find(img => levelAllows(img.nsfwLevel))
  return allowed || null
})

const isNsfwMedia = computed(() => shouldBlur(imageObj.value?.nsfwLevel))

const isVideo = computed(() => imageObj.value?.type === 'video')

// 竖版 3:4 卡显示高度升至 ~427px, DPR2 下 450 不够; 550 是 Civitai CDN 标准档
const imageSrc = computed(() => {
  const url = imageObj.value?.url
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `${CDN_PREFIX}${url}/width=550/default.jpg`
})

const zoomUrl = computed(() => {
  if (!imageSrc.value || isVideo.value) return ''
  const url = imageObj.value?.url
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `${CDN_PREFIX}${url}/default.jpg`
})

const badgeColor = computed(() => modelCategoryColor(props.hit.type))
const badgeLabel = computed(() => modelCategoryLabel(props.hit.type))

const baseModel = computed(() => props.hit.version?.baseModel || '')

const allVersions = computed(() =>
  props.hit.versions || (props.hit.version ? [props.hit.version] : []),
)

const versionCount = computed(() => allVersions.value.length)

const downloadCount = computed(() => fmtCompact(props.hit.metrics?.downloadCount || 0))
const dlState = computed<ModelAggregateState>(() => (props.downloadState as ModelAggregateState) || 'idle')
const { getVersionDownloadInfo, cancelDownload, retryVersion } = useDownloads()
const { confirm } = useConfirm()

const dlInfo = computed<VersionDownloadInfo>(() => {
  const v = props.hit.version
  if (!v?.id) return { state: 'idle', progress: 0, speed: 0, downloadId: null }
  return getVersionDownloadInfo(props.hit.id, v.id)
})

const dlBtnState = computed(() => {
  if (dlState.value === 'installed') return 'installed' as const
  if (dlState.value === 'partial') return 'idle' as const
  return dlInfo.value.state
})

async function handleCancelDownload() {
  const id = dlInfo.value.downloadId
  if (!id) return
  if (await confirm({
    title: t('models.confirm.cancel_download.title'),
    message: t('models.confirm.cancel_download.message', { name: props.hit.name || '' }),
    confirmText: t('models.confirm.cancel_download.button'),
    cancelText: t('models.confirm.cancel_download.cancel'),
  })) {
    cancelDownload(id)
  }
}

function handleCardRetry() {
  const v = props.hit.version
  retryVersion(String(props.hit.id), (props.hit.type || 'Checkpoint').toLowerCase(), v?.id)
}

function handleCardDownload() {
  if (dlBtnState.value === 'failed') {
    handleCardRetry()
  } else {
    emit('download', props.hit)
  }
}
</script>

<template>
  <ModelCard
    :image-src="imageSrc"
    :image-fallback="isVideo ? imageSrc : ''"
    :is-video="isVideo"
    :title="hit.name || t('models.local.no_preview')"
    :zoom-url="zoomUrl"
    :nsfw-blur="isNsfwMedia"
    @click="emit('details', hit)"
    @preview="(url) => emit('preview', url)"
  >
    <template #no-image>
      {{ t('models.local.no_preview') }}
    </template>

    <template #meta>
      <Badge :color="badgeColor">{{ badgeLabel }}</Badge>
      <Badge v-if="baseModel" :title="baseModel">{{ baseModel }}</Badge>
      <Badge v-if="versionCount > 1" :title="t('models.civitai.versions_count', { count: versionCount })">v{{ versionCount }}</Badge>
      <span class="cc-dl-count">
        <MsIcon name="download" size="xs" />
        {{ downloadCount }}
      </span>
    </template>

    <template #actions>
      <BaseButton size="sm" @click="emit('details', hit)">
        {{ t('models.civitai.details') }}
      </BaseButton>
      <BaseButton
        size="sm"
        @click="emit('toggleFavorite', hit)"
      >
        {{ isFavorite ? t('models.civitai.unfavorite') : t('models.civitai.favorite') }}
      </BaseButton>
      <DownloadButton
        :state="dlBtnState"
        :progress="dlInfo.progress"
        :speed="dlInfo.speed"
        :cancellable="!!dlInfo.downloadId"
        @download="handleCardDownload"
        @cancel="handleCancelDownload"
      />
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
</style>
