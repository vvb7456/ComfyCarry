<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateQueueStore } from '@/stores/generateQueue'
import MsIcon from '@/components/ui/MsIcon.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

defineOptions({ name: 'DashboardGallery' })

const { t } = useI18n({ useScope: 'global' })
const queueStore = useGenerateQueueStore()

// ── Image Preview ─────────────────────────────────────────────────────
const previewOpen = ref(false)
const previewImages = ref<string[]>([])
const previewIndex = ref(0)

const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi']
function isVideoFilename(filename: string): boolean {
  const i = filename.toLowerCase().lastIndexOf('.')
  if (i < 0) return false
  return VIDEO_EXTS.includes(filename.slice(i))
}

function fmtTimeAgo(ts?: number | string): string {
  if (!ts) return ''
  const tNum = typeof ts === 'string' ? parseFloat(ts) : ts
  if (!tNum || isNaN(tNum)) return ''
  // Normalize seconds vs milliseconds (ComfyUI timestamp is in milliseconds)
  const sec = tNum > 1e12 ? Math.floor(tNum / 1000) : Math.floor(tNum)
  const nowSec = Math.floor(Date.now() / 1000)
  const diffSec = Math.max(0, nowSec - sec)
  if (diffSec < 60) return t('dashboard.time.just_now')
  if (diffSec < 3600) return t('dashboard.time.mins_ago', { n: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('dashboard.time.hours_ago', { n: Math.floor(diffSec / 3600) })
  return t('dashboard.time.yesterday')
}

interface RecentOutput {
  promptId: string
  filename: string
  timestamp: number
  timeAgo: string
  thumbUrl: string
  fullUrl: string
  animated: boolean
}

const recentOutputs = computed<RecentOutput[]>(() => {
  // Always sort descending by timestamp regardless of HistoryPanel sort preference
  const sorted = [...queueStore.historyItems].sort((a, b) => {
    const ta = Number(a.timestamp) || 0
    const tb = Number(b.timestamp) || 0
    return tb - ta
  })
  const items: RecentOutput[] = []
  for (const item of sorted) {
    const firstImg = (item.images || [])[0]
    if (!firstImg) continue
    const isVid = !!(firstImg.animated || isVideoFilename(firstImg.filename))
    const sub = firstImg.subfolder || ''
    const type = firstImg.type || 'output'
    const fn = firstImg.filename

    const thumb = isVid
      ? `/api/comfyui/video_thumb?filename=${encodeURIComponent(fn)}&subfolder=${encodeURIComponent(sub)}&type=${type}`
      : `/api/comfyui/view?filename=${encodeURIComponent(fn)}&subfolder=${encodeURIComponent(sub)}&type=${type}&preview=webp;80`
    const full = `/api/comfyui/view?filename=${encodeURIComponent(fn)}&subfolder=${encodeURIComponent(sub)}&type=${type}`

    items.push({
      promptId: item.prompt_id,
      filename: fn,
      timestamp: Number(item.timestamp) || 0,
      timeAgo: fmtTimeAgo(item.timestamp),
      thumbUrl: thumb,
      fullUrl: full,
      animated: isVid,
    })
    if (items.length >= 4) break
  }
  return items
})

function openOutputPreview(idx: number) {
  previewImages.value = recentOutputs.value.map((o) => o.fullUrl)
  previewIndex.value = idx
  previewOpen.value = true
}

function handleImgError(e: Event) {
  const target = e.target as HTMLImageElement
  if (target) {
    target.style.display = 'none'
  }
}

onMounted(() => {
  if (!queueStore.historyLoaded || queueStore.historyDirty) {
    queueStore.loadHistory()
  }
})
</script>

<template>
  <section class="dash-section">
    <div class="dash-section-header">
      <div class="dash-section-tagline">
        <span class="dash-accent-bar"></span>
        <span class="dash-tagline-text">{{ t('dashboard.taglines.recent') }}</span>
      </div>
      <div class="dash-section-title-row">
        <h2 class="dash-section-title">{{ t('dashboard.recent.title') }}</h2>
        <router-link
          to="/generate/image?panel=history"
          class="dash-section-action"
        >
          <span class="dash-section-action__text">{{ t('dashboard.actions.open_history') }}</span>
          <MsIcon name="arrow_forward" size="xs" />
        </router-link>
      </div>
    </div>

    <!-- Skeleton Loading -->
    <div v-if="!queueStore.historyLoaded && !queueStore.historyFailed && recentOutputs.length === 0" class="dash-output-grid">
      <div v-for="i in 4" :key="i" class="dash-output-skeleton"></div>
    </div>

    <!-- Unavailable / Failed State -->
    <EmptyState
      v-else-if="queueStore.historyFailed && recentOutputs.length === 0"
      :message="t('dashboard.recent.unavailable')"
    >
      <BaseButton variant="ghost" size="sm" @click="queueStore.loadHistory()">
        <MsIcon name="refresh" size="xs" />
        {{ t('dashboard.recent.retry') }}
      </BaseButton>
    </EmptyState>

    <!-- Empty -->
    <EmptyState v-else-if="recentOutputs.length === 0" :message="t('dashboard.recent.empty')" />

    <!-- Output Cards (Single Row, Never Wrap) -->
    <div v-else class="dash-output-grid">
      <div
        v-for="(item, idx) in recentOutputs"
        :key="item.promptId"
        class="dash-output-card"
        @click="openOutputPreview(idx)"
      >
        <div class="dash-output-thumb">
          <img
            :src="item.thumbUrl"
            :alt="item.filename"
            class="dash-output-img"
            loading="lazy"
            @error="handleImgError"
          />
          <div class="dash-output-placeholder">
            <MsIcon :name="item.animated ? 'movie' : 'image'" size="lg" />
          </div>
          <div v-if="item.animated" class="dash-output-video-badge">
            <MsIcon name="play_arrow" size="xs" />
          </div>
        </div>
        <div class="dash-output-info">
          <div class="dash-output-name text-truncate" :title="item.filename">
            {{ item.filename }}
          </div>
          <div class="dash-output-meta">
            {{ item.timeAgo }}
          </div>
        </div>
      </div>
    </div>

    <!-- Image Preview Modal -->
    <ImagePreview
      v-model="previewOpen"
      :images="previewImages"
      :initial-index="previewIndex"
    />
  </section>
</template>

<style scoped>
.dash-section-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  color: var(--ac);
  text-decoration: none;
  font-weight: 500;
  transition: opacity 0.15s ease;
}

.dash-section-action:hover {
  text-decoration: none;
  opacity: 0.85;
}

.dash-section-action:hover .dash-section-action__text {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.dash-section-action .ms {
  text-decoration: none !important;
  transition: transform 0.15s ease;
}

.dash-section-action:hover .ms {
  transform: translateX(2px);
}

/* ── Section 3: Gallery (Single Row, Never Wrap) ── */
.dash-output-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--sp-3);
}

.dash-output-card:nth-child(n+5),
.dash-output-skeleton:nth-child(n+5) {
  display: none !important;
}

.dash-output-card {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  display: flex;
  flex-direction: column;
}

.dash-output-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--ac) 40%, var(--bd));
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}

.dash-output-thumb {
  position: relative;
  width: 100%;
  /* 3:4 —— 全局产物卡统一比例 (与历史面板 / 批量预览网格同口径) */
  aspect-ratio: 3 / 4;
  background: var(--bg3);
  overflow: hidden;
}

.dash-output-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 2;
  transition: transform 0.25s ease;
}

.dash-output-card:hover .dash-output-img {
  transform: scale(1.04);
}

.dash-output-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
  opacity: 0.35;
  z-index: 1;
}

.dash-output-video-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  color: #fff;
  border-radius: var(--r-xs);
  padding: 2px 4px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dash-output-info {
  padding: var(--sp-2) 10px 10px 10px;
}

.dash-output-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--t1);
  margin-bottom: 2px;
}

.dash-output-meta {
  font-size: var(--text-xs);
  color: var(--t3);
  font-family: var(--font-tabular);
}

.dash-output-skeleton {
  width: 100%;
  aspect-ratio: 3 / 4;
  background: color-mix(in srgb, var(--t3) 12%, transparent);
  border-radius: var(--r-md);
  animation: pulse 1.5s ease-in-out infinite;
}

@media (max-width: 900px) {
  .dash-output-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .dash-output-card:nth-child(n+4),
  .dash-output-skeleton:nth-child(n+4) {
    display: none !important;
  }
}

@media (max-width: 640px) {
  .dash-output-grid {
    grid-template-columns: 1fr;
  }
  .dash-output-card:nth-child(n+2),
  .dash-output-skeleton:nth-child(n+2) {
    display: none !important;
  }
}
</style>
