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
import { modelCategoryColor, modelCategoryLabel, civitaiModelUrl } from '@/utils/constants'
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
  favoriteItem?: FavoriteItem
  task?: DownloadTask
  /** Favorite mode: 该版本的下载状态 (驱动按钮 spinner/进度环), 缺省时退回 installed/idle */
  state?: VersionState
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
  return civitaiModelUrl(id)
})

const favoriteKey = computed(() => {
  if (!props.favoriteItem) return ''
  return props.favoriteItem.versionId
    ? `${props.favoriteItem.modelId}:${props.favoriteItem.versionId}`
    : props.favoriteItem.modelId
})

const speedText = computed(() => fmtSpeed(props.task?.speed || 0))

const progressPct = computed(() => Math.min(props.task?.progress || 0, 100))

const sizeText = computed(() => {
  const total = props.task?.total_bytes || 0
  if (!total) return ''
  return `${fmtBytes(props.task?.completed_bytes || 0)} / ${fmtBytes(total)}`
})

const isFavorite = computed(() => !!props.favoriteItem)

const favoriteState = computed<VersionState>(() => props.state ?? 'idle')
const isActive = computed(() => props.task?.status === 'active')
const isPaused = computed(() => props.task?.status === 'paused')
const isQueued = computed(() => props.task?.status === 'queued')
const isComplete = computed(() => props.task?.status === 'complete')
const isFailed = computed(() => props.task?.status === 'failed')

const showProgressRow = computed(() =>
  !isFavorite.value && !!props.task && (isActive.value || isPaused.value || isQueued.value),
)

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

const versionName = computed(() => {
  if (isFavorite.value) return props.favoriteItem?.versionName || ''
  return props.task?.meta?.version_name || ''
})

const metricFacts = computed(() => {
  if (isFavorite.value) return []
  const out: string[] = []
  if (showProgressRow.value) {
    if (speedText.value) out.push(speedText.value)
    if (sizeText.value) out.push(sizeText.value)
    out.push(`${progressPct.value.toFixed(1)}%`)
  } else if (props.task?.total_bytes) {
    out.push(fmtBytes(props.task.total_bytes))
  }
  return out
})
</script>

<template>
  <div class="dli">
    <div class="dli-thumb">
      <img v-if="imageUrl" :src="imageUrl" alt="" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'">
      <MsIcon v-else name="image_not_supported" />
    </div>

    <!-- Main: 严格分行 (Row 1 名称状态 / Row 2 纯Badge / Row 3 进度条 / Row 3或4 事实文本) -->
    <div class="dli-main">
      <!-- Row 1: 模型名称 + 状态点 (严格单行) -->
      <div class="dli-head">
        <a v-if="civitaiUrl" class="dli-name" :href="civitaiUrl" target="_blank" rel="noopener" @click.stop>{{ name }}</a>
        <span v-else class="dli-name">{{ name }}</span>

        <span v-if="stateText" class="dli-state">
          <StatusDot :status="stateDot" size="sm" />
          {{ stateText }}
        </span>
      </div>

      <!-- Row 2: 纯 Badge 行 (仅限前 2 个: 模型类型 + 基模架构, 严格单行) -->
      <div v-if="modelType || baseModelText" class="dli-badges">
        <Badge v-if="modelType" :color="badgeColor" class="dli-badge">{{ badgeLabel }}</Badge>
        <Badge v-if="baseModelText" class="dli-badge">{{ baseModelText }}</Badge>
      </div>

      <div v-if="showProgressRow" class="dli-progress">
        <UsageBar :percent="progressPct" :height="5" />
      </div>

      <!-- Row 3/4: 版本信息与事实文本 (轻量纯文字, 与历史视觉统一, 绝不折行) -->
      <div v-if="versionName || metricFacts.length" class="dli-facts">
        <span v-if="versionName" class="dli-version">{{ versionName }}</span>
        <span v-for="m in metricFacts" :key="m" class="dli-metric">{{ m }}</span>
      </div>

      <div v-if="isFailed && task?.error" class="dli-error" :title="errorText">{{ errorText }}</div>
    </div>

    <div class="dli-actions">
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
          <MsIcon name="cancel" />
        </BaseButton>
      </template>

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
          <MsIcon name="cancel" />
        </BaseButton>
      </template>

      <template v-else-if="isQueued">
        <BaseButton
          variant="danger"
          size="sm"
          icon-only
          :aria-label="t('common.btn.cancel')"
          :title="t('common.btn.cancel')"
          @click="emit('cancel', task!.download_id)"
        >
          <MsIcon name="cancel" />
        </BaseButton>
      </template>

      <template v-else-if="isFailed">
        <BaseButton size="sm" @click="emit('retry', task!.download_id)">
          <MsIcon name="replay" size="xs" /> {{ t('common.btn.retry') }}
        </BaseButton>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dli {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
}

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

.dli-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
}

.dli-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}

.dli-name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 0;
}
.dli-name:hover {
  color: var(--ac);
}

.dli-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--t2);
  white-space: nowrap;
  flex-shrink: 0;
}

.dli-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}

.dli-badge {
  max-width: 110px;
  min-width: 0;
  flex-shrink: 1;
}

.dli-facts {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  color: var(--t3);
  font-size: var(--text-xs);
  font-family: var(--font-tabular);
  min-width: 0;
  line-height: 1.4;
}
.dli-version {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 0;
}
.dli-metric {
  white-space: nowrap;
  flex-shrink: 0;
}
.dli-facts > span + span::before {
  content: '·';
  margin: 0 6px;
}

.dli-progress {
  margin: 2px 0;
}

.dli-error {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--red);
  line-height: 1.4;
  word-break: break-word;
}

.dli-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (max-width: 768px) {
  .dli {
    gap: 10px;
    padding: 10px 0;
  }

  .dli-badge {
    max-width: 90px;
  }
}
</style>
