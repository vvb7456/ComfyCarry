<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FavoriteItem, DownloadTask, VersionState } from '@/composables/useDownloads'
import Badge from '@/components/ui/Badge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import DownloadButton from '@/components/models/DownloadButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import { modelCategoryColor, modelCategoryLabel } from '@/utils/constants'
import { fmtBytes, fmtSpeed } from '@/utils/format'

defineOptions({ name: 'DownloadItem' })

const { t, te } = useI18n()

// 后端错误可能是 i18n key (如 models.err.dl_interrupted) 也可能是自由文本
// (aria2/civitai 错误原文): 命中 key 就翻译, 否则原样显示。
const errorText = computed(() => {
  const e = props.task?.error
  if (!e) return ''
  return te(e) ? t(e) : e
})

const props = defineProps<{
  /** Favorite item mode */
  favoriteItem?: FavoriteItem
  /** Download task mode */
  task?: DownloadTask
  /** Whether this item is already installed locally */
  installed?: boolean
  /** Favorite mode: 该版本的下载状态 (驱动按钮 spinner/进度环), 缺省时退回 installed/idle */
  state?: VersionState
  /** Favorite mode: 进度 % / 速度 B/s (state 为 queued/downloading 时显示) */
  progress?: number
  speed?: number
  /** Favorite mode: 有 downloadId 才允许 hover 取消 */
  downloadId?: string | null
}>()

const emit = defineEmits<{
  download: [item: FavoriteItem]
  remove: [key: string]
  pause: [id: string]
  resume: [id: string]
  cancel: [id: string]
  retry: [id: string]
}>()

// ── Shared display ──

const name = computed(() =>
  props.favoriteItem?.name || props.task?.meta?.model_name || props.task?.filename || 'Unknown',
)

const imageUrl = computed(() =>
  props.favoriteItem?.imageUrl || props.task?.meta?.image_url || '',
)

const modelType = computed(() =>
  props.favoriteItem?.type || props.task?.meta?.model_type || '',
)

// badge 颜色/文案走统一归一 (civitai 原始 type / HF 驼峰 type / 目录 key 均可命中)
const badgeColor = computed(() => modelCategoryColor(modelType.value))
const badgeLabel = computed(() => modelCategoryLabel(modelType.value))

const baseModelText = computed(() =>
  props.favoriteItem?.baseModel || props.task?.meta?.base_model || '',
)

const civitaiUrl = computed(() => {
  const id = props.favoriteItem?.modelId || props.task?.meta?.model_id
  // 负整数 ID 为 HF 白名单模型, 无 CivitAI 页面, 隐藏链接 (SPEC §4-E)
  if (!id || Number(id) < 0) return ''
  return `https://civitai.com/models/${id}`
})

// ── Favorite-specific ──

const favoriteKey = computed(() => {
  if (!props.favoriteItem) return ''
  return props.favoriteItem.versionId
    ? `${props.favoriteItem.modelId}:${props.favoriteItem.versionId}`
    : props.favoriteItem.modelId
})

// ── Task-specific ──

const speedText = computed(() => fmtSpeed(props.task?.speed || 0))

const progressPct = computed(() => Math.min(props.task?.progress || 0, 100))

const sizeText = computed(() => {
  const total = props.task?.total_bytes || 0
  if (!total) return ''
  return `${fmtBytes(props.task?.completed_bytes || 0)} / ${fmtBytes(total)}`
})

const isFavorite = computed(() => !!props.favoriteItem)

/** Favorite 按钮状态: 显式 state 优先, 否则按 installed 退回旧行为 */
const favoriteState = computed<VersionState>(() =>
  props.state ?? (props.installed ? 'installed' : 'idle'),
)
const isActive = computed(() => props.task?.status === 'active')
const isPaused = computed(() => props.task?.status === 'paused')
const isQueued = computed(() => props.task?.status === 'queued')
const isComplete = computed(() => props.task?.status === 'complete')
const isFailed = computed(() => props.task?.status === 'failed')

/** Whether the progress row should render (active group, even at 0%). */
const showProgressRow = computed(() =>
  !isFavorite.value && !!props.task && (isActive.value || isPaused.value || isQueued.value),
)

// ── 状态表达: 圆点 + 状态词 (ListRow 同口径) ──
type DlState = 'active' | 'paused' | 'queued' | 'failed' | 'completed'

const stateKey = computed<DlState | ''>(() => {
  if (isFavorite.value) return ''
  if (isActive.value) return 'active'
  if (isPaused.value) return 'paused'
  if (isQueued.value) return 'queued'
  if (isFailed.value) return 'failed'
  if (isComplete.value) return 'completed'
  return ''
})

const stateDot = computed<'running' | 'loading' | 'stopped' | 'error'>(() => {
  switch (stateKey.value) {
    case 'active':
    case 'completed':
      return 'running'
    case 'paused':
    case 'queued':
      return 'loading'
    case 'failed':
      return 'error'
    default:
      return 'stopped'
  }
})

const stateText = computed(() => {
  const k = stateKey.value
  if (!k) return ''
  if (k === 'active') return t('models.downloads.downloading')
  if (k === 'queued') return t('models.downloads.waiting')
  return t(`models.downloads.${k}`)
})

/** 副行事实: 版本名 + 速度 / 大小 / 进度 (任务模式) */
const taskFacts = computed(() => {
  if (isFavorite.value) return []
  const out: string[] = []
  const version = props.task?.meta?.version_name
  if (version) out.push(version)
  if (showProgressRow.value) {
    if (speedText.value) out.push(speedText.value)
    if (sizeText.value) out.push(sizeText.value)
    out.push(`${progressPct.value.toFixed(1)}%`)
  }
  return out
})
</script>

<template>
  <div class="dli">
    <!-- Thumbnail -->
    <div class="dli-thumb">
      <img v-if="imageUrl" :src="imageUrl" alt="" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'">
      <MsIcon v-else name="image_not_supported" />
    </div>

    <!-- Main -->
    <div class="dli-main">
      <div class="dli-head">
        <a v-if="civitaiUrl" class="dli-name" :href="civitaiUrl" target="_blank" rel="noopener" @click.stop>{{ name }}</a>
        <span v-else class="dli-name">{{ name }}</span>

        <span v-if="stateText" class="dli-state">
          <StatusDot :status="stateDot" size="sm" />
          {{ stateText }}
        </span>

        <Badge v-if="isFavorite && installed" color="#10b981">{{ t('models.downloads.installed') }}</Badge>
        <Badge v-if="modelType" :color="badgeColor">{{ badgeLabel }}</Badge>
        <Badge v-if="baseModelText">{{ baseModelText }}</Badge>
        <Badge v-if="isFavorite && favoriteItem?.versionName">{{ favoriteItem.versionName }}</Badge>
      </div>

      <div v-if="taskFacts.length" class="dli-facts">
        <span v-for="fact in taskFacts" :key="fact">{{ fact }}</span>
      </div>

      <div v-if="isFailed && task?.error" class="dli-error">{{ errorText }}</div>

      <div v-if="showProgressRow" class="dli-progress">
        <UsageBar :percent="progressPct" :height="5" />
      </div>
    </div>

    <!-- Actions -->
    <div class="dli-actions">
      <!-- Favorite actions -->
      <template v-if="isFavorite">
        <DownloadButton
          :state="favoriteState"
          :progress="progress || 0"
          :speed="speed || 0"
          :cancellable="!!downloadId"
          @download="emit('download', favoriteItem!)"
          @cancel="downloadId && emit('cancel', downloadId)"
        />
        <BaseButton
          variant="danger"
          size="sm"
          icon-only
          :aria-label="t('models.downloads.remove')"
          :title="t('models.downloads.remove')"
          @click="emit('remove', favoriteKey)"
        >
          <MsIcon name="delete" />
        </BaseButton>
      </template>

      <!-- Active download actions -->
      <template v-else-if="isActive">
        <BaseButton
          size="sm"
          icon-only
          :aria-label="t('models.downloads.pause')"
          :title="t('models.downloads.pause')"
          @click="emit('pause', task!.download_id)"
        >
          <MsIcon name="pause" />
        </BaseButton>
        <BaseButton
          variant="danger"
          size="sm"
          icon-only
          :aria-label="t('common.btn.cancel')"
          :title="t('common.btn.cancel')"
          @click="emit('cancel', task!.download_id)"
        >
          <MsIcon name="close" />
        </BaseButton>
      </template>

      <!-- Paused actions -->
      <template v-else-if="isPaused">
        <BaseButton
          size="sm"
          icon-only
          :aria-label="t('models.downloads.resume')"
          :title="t('models.downloads.resume')"
          @click="emit('resume', task!.download_id)"
        >
          <MsIcon name="play_arrow" />
        </BaseButton>
        <BaseButton
          variant="danger"
          size="sm"
          icon-only
          :aria-label="t('common.btn.cancel')"
          :title="t('common.btn.cancel')"
          @click="emit('cancel', task!.download_id)"
        >
          <MsIcon name="close" />
        </BaseButton>
      </template>

      <!-- Queued actions -->
      <template v-else-if="isQueued">
        <BaseButton
          variant="danger"
          size="sm"
          icon-only
          :aria-label="t('common.btn.cancel')"
          :title="t('common.btn.cancel')"
          @click="emit('cancel', task!.download_id)"
        >
          <MsIcon name="close" />
        </BaseButton>
      </template>

      <!-- Failed actions -->
      <template v-else-if="isFailed">
        <BaseButton size="sm" @click="emit('retry', task!.download_id)">
          <MsIcon name="refresh" size="xs" /> {{ t('models.downloads.retry') }}
        </BaseButton>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 下载任务行: 对齐 ListRow 骨架, 但首列是多媒体的 48px 缩略图 (媒体预览保留)。
   行本身透明、无边框, 分隔线由外层 ul.list-plain 的 li 发丝线承担。 */
.dli {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 14px 0;
}

/* ── Thumbnail ── */
.dli-thumb {
  width: 48px;
  height: 48px;
  border-radius: var(--r-xs);
  overflow: hidden;
  background: var(--bg-in);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
}

.dli-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ── Main ── */
.dli-main {
  min-width: 0;
}

.dli-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.dli-name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
  text-decoration: none;
}
.dli-name:hover {
  color: var(--ac);
}

.dli-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--t2);
}

.dli-facts {
  display: flex;
  flex-wrap: wrap;
  color: var(--t3);
  font-size: var(--text-xs);
  font-family: var(--font-tabular);
}
.dli-facts > span + span::before {
  content: '·';
  margin: 0 6px;
}

.dli-error {
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--red);
  line-height: 1.45;
  word-break: break-word;
}

/* ── Progress ── */
.dli-progress {
  margin-top: 8px;
}

/* ── Actions ── */
.dli-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .dli {
    grid-template-columns: 48px minmax(0, 1fr);
    gap: 10px;
  }

  .dli-actions {
    grid-column: 2;
    justify-content: flex-end;
  }
}
</style>
