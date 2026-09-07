<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CivitaiHit } from '@/composables/useCivitaiSearch'
import { useCivitaiNsfw } from '@/composables/useCivitaiNsfw'
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

// ── Image ──
const CDN_PREFIX = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/'

// ── NSFW 浏览级别 ──
// 级别未开放的图不作为封面 (优先挑允许的图); 开放但需模糊的传遮罩给 ModelCard。
const { levelAllows, shouldBlur } = useCivitaiNsfw()

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

// ── Type badge (文案/颜色走统一归一, civitai 单数 type → 目录 key) ──
const badgeColor = computed(() => modelCategoryColor(props.hit.type))
const badgeLabel = computed(() => modelCategoryLabel(props.hit.type))

// ── Meta ──
const baseModel = computed(() => props.hit.version?.baseModel || '')

const allVersions = computed(() =>
  props.hit.versions || (props.hit.version ? [props.hit.version] : []),
)

const versionCount = computed(() => allVersions.value.length)

// 紧凑格式 (56.8k / 1.2M) — 卡片 meta 行空间敏感, 完整千分位留给详情弹窗
const downloadCount = computed(() => fmtCompact(props.hit.metrics?.downloadCount || 0))

// ── Download button state ──
const dlState = computed<ModelAggregateState>(() => (props.downloadState as ModelAggregateState) || 'idle')

// ── Installed overlay badges + version-level download info ──
const { getVersionState, getVersionDownloadInfo, cancelDownload, retryVersion } = useDownloads()
const { confirm } = useConfirm()

/** Current version info for the card's primary version (single-version models). */
const dlInfo = computed<VersionDownloadInfo>(() => {
  const v = props.hit.version
  if (!v?.id) return { state: 'idle', progress: 0, speed: 0, downloadId: null }
  return getVersionDownloadInfo(props.hit.id, v.id)
})

/** Map card-level state to the DownloadButton state: installed/idle pass through; downloading→version info state. */
const dlBtnState = computed(() => {
  if (dlState.value === 'installed') return 'installed' as const
  if (dlState.value === 'partial') return 'idle' as const
  // For a single-version model, surface the granular version state (queued/downloading/verifying/...)
  return dlInfo.value.state
})

async function handleCancelDownload() {
  const id = dlInfo.value.downloadId
  if (!id) return
  if (await confirm({
    message: t('models.downloads.confirm_cancel', { name: props.hit.name || '' }),
    variant: 'danger',
    confirmText: t('common.btn.cancel'),
  })) {
    cancelDownload(id)
  }
}

/** Failed/retry click from card button → retryVersion */
function handleCardRetry() {
  const v = props.hit.version
  retryVersion(String(props.hit.id), (props.hit.type || 'Checkpoint').toLowerCase(), v?.id)
}

/** Download button click handler: idle → forward to parent (opens picker or downloads);
 *  failed → retryVersion. */
function handleCardDownload() {
  if (dlBtnState.value === 'failed') {
    handleCardRetry()
  } else {
    emit('download', props.hit)
  }
}

/** List of versions that are installed locally */
const installedVersions = computed(() =>
  allVersions.value.filter(v => getVersionState(props.hit.id, v.id) === 'installed'),
)

/** true when all versions installed (single or multi) */
const allInstalled = computed(() => dlState.value === 'installed')

/** true when some (not all) versions installed in a multi-version model */
const partialInstalled = computed(() =>
  !allInstalled.value && installedVersions.value.length > 0,
)

/** Hover tooltip: list installed version names */
const installedTooltip = computed(() =>
  installedVersions.value.map(v => v.name || `v${v.id}`).join(', '),
)
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
      <Badge v-if="allInstalled || partialInstalled" color="#10b981" size="sm" :title="installedTooltip">
        {{ partialInstalled ? `${t('models.downloads.installed')} ${installedVersions.length}/${versionCount}` : t('models.downloads.installed') }}
      </Badge>
      <Badge :color="badgeColor">{{ badgeLabel }}</Badge>
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
        :variant="isFavorite ? 'danger' : 'default'"
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
