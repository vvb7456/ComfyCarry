<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CartItem, DownloadTask } from '@/composables/useDownloads'
import Badge from '@/components/ui/Badge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { MODEL_CATEGORY_COLORS } from '@/utils/constants'

defineOptions({ name: 'DownloadItem' })

const { t } = useI18n()

const props = defineProps<{
  /** Cart item mode */
  cartItem?: CartItem
  /** Download task mode */
  task?: DownloadTask
  /** Whether this item is already installed locally */
  installed?: boolean
}>()

const emit = defineEmits<{
  download: [item: CartItem]
  remove: [key: string]
  pause: [id: string]
  resume: [id: string]
  cancel: [id: string]
  retry: [id: string]
}>()

// ── Shared display ──

const name = computed(() =>
  props.cartItem?.name || props.task?.meta?.model_name || props.task?.filename || 'Unknown',
)

const imageUrl = computed(() =>
  props.cartItem?.imageUrl || props.task?.meta?.image_url || '',
)

const modelType = computed(() =>
  props.cartItem?.type || props.task?.meta?.model_type || '',
)

const badgeColor = computed(() => {
  const t = modelType.value.toLowerCase()
  const keyMap: Record<string, string> = {
    checkpoint: 'checkpoints', lora: 'loras', textualinversion: 'embeddings',
    controlnet: 'controlnet', vae: 'vae', upscaler: 'upscale_models',
  }
  return MODEL_CATEGORY_COLORS[keyMap[t] || ''] || ''
})

const civitaiUrl = computed(() => {
  const id = props.cartItem?.modelId || props.task?.meta?.model_id
  return id ? `https://civitai.com/models/${id}` : ''
})

// ── Cart-specific ──

const cartKey = computed(() => {
  if (!props.cartItem) return ''
  return props.cartItem.versionId
    ? `${props.cartItem.modelId}:${props.cartItem.versionId}`
    : props.cartItem.modelId
})

// ── Task-specific ──

const speedText = computed(() => {
  const s = props.task?.speed || 0
  if (s <= 0) return ''
  if (s > 1024 * 1024) return `${(s / (1024 * 1024)).toFixed(1)} MB/s`
  if (s > 1024) return `${(s / 1024).toFixed(0)} KB/s`
  return `${s} B/s`
})

const progressPct = computed(() => Math.min(props.task?.progress || 0, 100))

const sizeText = computed(() => {
  const total = props.task?.total_bytes || 0
  if (!total) return ''
  const fmt = (b: number) => b > 1024 * 1024 * 1024
    ? `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${(b / (1024 * 1024)).toFixed(0)} MB`
  return `${fmt(props.task?.completed_bytes || 0)} / ${fmt(total)}`
})

const isCart = computed(() => !!props.cartItem)
const isActive = computed(() => props.task?.status === 'active')
const isPaused = computed(() => props.task?.status === 'paused')
const isQueued = computed(() => props.task?.status === 'queued')
const isComplete = computed(() => props.task?.status === 'complete')
const isFailed = computed(() => props.task?.status === 'failed')
</script>

<template>
  <div class="dli" :class="{ 'dli--failed': isFailed }">
    <!-- Thumbnail -->
    <div class="dli-thumb">
      <img v-if="imageUrl" :src="imageUrl" alt="" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'">
      <MsIcon v-else name="image_not_supported" />
    </div>

    <!-- Info -->
    <div class="dli-info">
      <div class="dli-name text-truncate">
        <a v-if="civitaiUrl" :href="civitaiUrl" target="_blank" rel="noopener" @click.stop>{{ name }}</a>
        <span v-else>{{ name }}</span>
      </div>
      <div class="dli-meta">
        <Badge v-if="isCart && installed" color="#10b981" size="sm">{{ t('models.downloads.installed') }}</Badge>
        <Badge v-if="modelType" :color="badgeColor" size="sm">{{ modelType }}</Badge>
        <Badge v-if="cartItem?.baseModel" size="sm">{{ cartItem.baseModel }}</Badge>
        <Badge v-if="task?.meta?.base_model" size="sm">{{ task.meta.base_model }}</Badge>
        <Badge v-if="isCart && cartItem?.versionName" size="sm">{{ cartItem.versionName }}</Badge>

        <!-- Task: version name text -->
        <span v-if="!isCart && task?.meta?.version_name" class="dli-version-text">{{ task.meta.version_name }}</span>

        <!-- Task status labels -->
        <span v-if="isPaused" class="dli-status dli-status--paused">{{ t('models.downloads.paused') }}</span>
        <span v-if="isQueued" class="dli-status dli-status--queued">{{ t('models.downloads.waiting') }}</span>
        <span v-if="isFailed && task?.error" class="dli-status dli-status--error">{{ task.error }}</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="dli-actions">
      <!-- Cart actions -->
      <template v-if="isCart">
        <BaseButton size="sm" variant="primary" :disabled="installed" @click="emit('download', cartItem!)">
          <MsIcon name="download" size="xs" /> {{ t('models.downloads.download') }}
        </BaseButton>
        <BaseButton size="sm" variant="danger" square @click="emit('remove', cartKey)">
          <MsIcon name="delete" />
        </BaseButton>
      </template>

      <!-- Active download actions -->
      <template v-else-if="isActive">
        <BaseButton size="sm" square @click="emit('pause', task!.download_id)">
          <MsIcon name="pause" />
        </BaseButton>
        <BaseButton size="sm" variant="danger" square @click="emit('cancel', task!.download_id)">
          <MsIcon name="close" />
        </BaseButton>
      </template>

      <!-- Paused actions -->
      <template v-else-if="isPaused">
        <BaseButton size="sm" square @click="emit('resume', task!.download_id)">
          <MsIcon name="play_arrow" />
        </BaseButton>
        <BaseButton size="sm" variant="danger" square @click="emit('cancel', task!.download_id)">
          <MsIcon name="close" />
        </BaseButton>
      </template>

      <!-- Queued actions -->
      <template v-else-if="isQueued">
        <BaseButton size="sm" variant="danger" square @click="emit('cancel', task!.download_id)">
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

    <!-- Progress bar (active/paused downloads only) -->
    <div v-if="(isActive || isPaused) && progressPct > 0" class="dli-progress">
      <div class="dli-progress-info">
        <span v-if="speedText">{{ speedText }}</span>
        <span v-if="sizeText">{{ sizeText }}</span>
        <span>{{ progressPct.toFixed(1) }}%</span>
      </div>
      <div class="dli-progress-bar">
        <div class="dli-progress-fill" :style="{ width: `${progressPct}%` }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.dli {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  flex-wrap: wrap;
}

.dli--failed {
  border-color: rgba(239, 68, 68, .3);
}

/* ── Thumbnail ── */
.dli-thumb {
  width: 48px;
  height: 48px;
  border-radius: var(--r-xs);
  overflow: hidden;
  background: var(--bg-in);
  flex-shrink: 0;
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

/* ── Info ── */
.dli-info {
  flex: 1;
  min-width: 0;
}

.dli-name {
  font-size: var(--text-sm);
  font-weight: 600;
  margin-bottom: 4px;
}

.dli-name a {
  color: inherit;
  text-decoration: none;
}
.dli-name a:hover {
  color: var(--ac);
}

.dli-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.dli-version-text {
  font-size: var(--text-xs);
  color: var(--t2);
}

.dli-status {
  font-size: var(--text-xs);
}

.dli-status--paused {
  color: var(--amber);
}

.dli-status--queued {
  color: var(--t3);
}

.dli-status--error {
  color: var(--red);
}

/* ── Actions ── */
.dli-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Progress ── */
.dli-progress {
  width: 100%;
}

.dli-progress-info {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--t2);
  margin-bottom: 3px;
}

.dli-progress-bar {
  height: 5px;
  background: var(--bg-in);
  border-radius: 3px;
  overflow: hidden;
}

.dli-progress-fill {
  height: 100%;
  background: var(--ac);
  border-radius: 3px;
  transition: width .3s;
}
</style>
