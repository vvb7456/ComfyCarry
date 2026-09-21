<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PreviewImage, PreviewPhase, VideoMeta } from '@/composables/generate/useGeneratePreview'
import {
  derivePreviewPhase,
  deriveStageSegment,
  isVideoFile,
  buildVideoThumbUrl,
} from '@/composables/generate/useGeneratePreview'
import type { ExecState } from '@/composables/useExecTracker'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'PreviewArea' })

const props = withDefaults(defineProps<{
  images: PreviewImage[]
  loading: boolean
  currentPreview: string | null
  /** 媒体类型: 'image' = 图像架构 (默认, 回归保护); 'video' = 视频架构。
   *  ModelTab 传 :media-type="config.mediaType"。未传则退化为图像行为。 */
  mediaType?: 'image' | 'video'
  /** 执行态: 驱动五态状态机。ModelTab 传 :exec-state="execState"。
   *  未传 (null) 时 phase 退化为 empty/queued 二态 (回归保护)。 */
  execState?: ExecState | null
}>(), {
  mediaType: 'image',
  execState: null,
})

const emit = defineEmits<{
  clickImage: [url: string]
}>()

const { t } = useI18n({ useScope: 'global' })

// phase 仅描述「执行中」的子态; 完成态 = 有产物且不在执行中。
// hasOutput 必须带 !execState: 否则上一轮产物还挂着时 (后台模式逐轮不清),
// phase 恒为 'empty', 采样/合成子态全部失效。
const phase = computed<PreviewPhase>(() =>
  derivePreviewPhase({
    hasOutput: props.images.length > 0 && !props.execState,
    loading: props.loading,
    execState: props.execState ?? null,
    livePreview: props.currentPreview,
    mediaType: props.mediaType,
  }),
)

/** 执行中且已有实时帧 → 实时帧优先于旧产物。
 *  没有这条, 上一轮的成品图会把本轮的实时预览整轮盖死 (后台模式 100% 必现)。 */
const showLive = computed(() => !!props.execState && !!props.currentPreview)

/** 采样段号 (双段「第 n/2 段」); 仅视频架构且双段采样时非 null。 */
const stageSegment = computed(() =>
  deriveStageSegment(props.execState ?? null, props.mediaType),
)

/** 是否显示「采样中·第 n/2 段」标注: 视频架构 + sampling 态 + 双段。 */
const showStage = computed(() =>
  props.mediaType === 'video' && phase.value === 'sampling' && stageSegment.value !== null,
)

/** 是否显示「合成中」文案: 视频架构 + composing 态。 */
const isComposing = computed(() =>
  props.mediaType === 'video' && phase.value === 'composing',
)

// url → VideoMeta; 由 <video> loadedmetadata 事件填充。fps 浏览器拿不到, 留 undefined。
const videoMetaMap = ref<Record<string, VideoMeta>>({})

function onVideoLoadedMetadata(e: Event, url: string, filename: string) {
  const el = e.target as HTMLVideoElement
  const meta: VideoMeta = {
    duration: Number.isFinite(el.duration) ? Math.round(el.duration) : undefined,
    width: el.videoWidth || undefined,
    height: el.videoHeight || undefined,
    format: videoFormat(filename),
  }
  videoMetaMap.value = { ...videoMetaMap.value, [url]: meta }
}

function videoFormat(filename: string): string | undefined {
  const m = filename.match(/\.(mp4|webm|mov|avi|mkv)(\?|$)/i)
  return m?.[1]?.toUpperCase()
}

function isVideo(img: PreviewImage): boolean {
  if (typeof img.animated === 'boolean') return img.animated
  return isVideoFile(img.filename)
}

function thumbUrl(img: PreviewImage): string {
  return buildVideoThumbUrl(img)
}

function downloadName(url: string): string {
  try {
    const u = new URL(url, window.location.origin)
    return u.searchParams.get('filename') || 'video'
  } catch {
    return 'video'
  }
}

function firstImage(): PreviewImage {
  return props.images[0] as PreviewImage
}

const singleVideo = computed(() =>
  props.images.length === 1 && isVideo(firstImage()),
)

function isGridVideo(img: PreviewImage): boolean {
  return isVideo(img)
}

function metaText(img: PreviewImage): string {
  const meta = videoMetaMap.value[img.url]
  if (!meta) return ''
  const parts: string[] = []
  if (meta.duration) parts.push(`${meta.duration}s`)
  if (meta.width && meta.height) parts.push(`${meta.width}×${meta.height}`)
  if (meta.fps) parts.push(`${meta.fps}fps`)
  if (meta.format) parts.push(meta.format)
  return parts.join(' · ')
}
</script>

<template>
  <div class="gen-preview-card">
    <!-- 执行中永远显示「当前这一轮」: 合成中 → 实时帧。
         上一轮产物排在其后, 否则后台/live 连跑时旧图会盖死本轮实时预览。 -->

    <!-- 合成中 (视频架构) -->
    <div v-if="isComposing" class="gen-preview-loading">
      <div class="preview-spinner" />
      <span class="preview-status-text">{{ t('generate.video.composing') }}</span>
    </div>

    <!-- 采样中: b64 实时预览帧 (视频模型同样发帧, 表现为静帧刷新)。
         视频架构双段采样额外显示「第 n/2 段」标注 -->
    <div v-else-if="showLive" class="gen-preview-single">
      <img :src="currentPreview!" alt="Preview" class="preview-live" />
      <span v-if="showStage" class="preview-stage-badge">
        {{ t('generate.video.stage', { i: stageSegment!.current, n: stageSegment!.total }) }}
      </span>
    </div>

    <template v-else-if="images.length > 0">
      <template v-if="images.length === 1">
        <div v-if="singleVideo" class="gen-preview-single gen-preview-video-wrap">
          <video
            :src="firstImage().url"
            controls
            loop
            muted
            playsinline
            class="preview-video"
            @click="emit('clickImage', firstImage().url)"
            @loadedmetadata="onVideoLoadedMetadata($event, firstImage().url, firstImage().filename)"
          />
          <div class="preview-video-meta">
            <span v-if="metaText(firstImage())" class="preview-meta-text">{{ metaText(firstImage()) }}</span>
            <a
              :href="firstImage().url"
              :download="downloadName(firstImage().url)"
              class="preview-video-download"
            >
              <MsIcon name="download" size="sm" color="none" />
              {{ t('generate.video.download') }}
            </a>
          </div>
        </div>
        <div v-else class="gen-preview-single">
          <img :src="firstImage().url" alt="Generated" @click="emit('clickImage', firstImage().url)" />
        </div>
      </template>

      <div v-else class="gen-preview-grid">
        <template v-for="(img, i) in images" :key="i">
          <div v-if="isGridVideo(img)" class="grid-video-item" @click="emit('clickImage', img.url)">
            <img :src="thumbUrl(img)" :alt="'Video ' + (i + 1)" class="grid-video-thumb" />
            <div class="grid-video-badge">
              <MsIcon name="play_arrow" size="sm" color="none" />
            </div>
          </div>
          <img
            v-else
            :src="img.url"
            alt="Generated"
            @click="emit('clickImage', img.url)"
          />
        </template>
      </div>
    </template>

    <div v-else-if="loading || execState" class="gen-preview-loading">
      <div class="preview-spinner" />
    </div>

    <div v-else class="gen-preview-empty">
      <MsIcon :name="mediaType === 'video' ? 'movie' : 'image'" color="none" class="preview-icon" />
      <span class="preview-hint">{{
        mediaType === 'video'
          ? t('generate.preview.empty_video')
          : t('generate.preview.empty')
      }}</span>
    </div>
  </div>
</template>

<style scoped>
.gen-preview-card {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: 0;
}

.gen-preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
}
.preview-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--bd);
  border-top-color: var(--ac);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.preview-status-text {
  font-size: .85rem;
  color: var(--t3);
}

.gen-preview-single {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-2);
}
.gen-preview-single img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: pointer;
  border-radius: var(--r-md);
  transition: opacity .2s;
}
.gen-preview-single img:hover { opacity: .9; }

.gen-preview-video-wrap {
  flex-direction: column;
}
.preview-video {
  width: 100%;
  height: 100%;
  max-height: calc(100% - 32px);
  object-fit: contain;
  cursor: pointer;
  border-radius: var(--r-md);
  background: #000;
}

.preview-video-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-2) 0 0;
  flex-shrink: 0;
}
.preview-meta-text {
  font-size: .8rem;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
}
.preview-video-download {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: .82rem;
  color: var(--ac);
  text-decoration: none;
  cursor: pointer;
  transition: opacity .15s;
}
.preview-video-download:hover { opacity: .8; }

.gen-preview-grid {
  display: grid;
  /* 允许最后一个窄列收缩到容器宽度，避免小预览区被 180px 最小列宽撑出横向溢出。 */
  grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  gap: var(--sp-2);
  padding: var(--sp-2);
  height: 100%;
  overflow-y: auto;
}
.gen-preview-grid img {
  width: 100%;
  /* 3:4 —— 全局产物卡统一比例 */
  aspect-ratio: 3 / 4;
  object-fit: cover;
  cursor: pointer;
  border-radius: var(--r-md);
  transition: opacity .2s;
}
.gen-preview-grid img:hover { opacity: .9; }

.grid-video-item {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  cursor: pointer;
  border-radius: var(--r-md);
  overflow: hidden;
  transition: opacity .2s;
}
.grid-video-item:hover { opacity: .9; }
.grid-video-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--r-md);
}
.grid-video-badge {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .6);
  border-radius: 50%;
  color: #fff;
  pointer-events: none;
}

/* Live preview */
.preview-live { opacity: 0.85; cursor: default; }
.preview-live:hover { opacity: 0.85; }

.preview-stage-badge {
  position: absolute;
  bottom: var(--sp-2);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  background: rgba(0, 0, 0, .55);
  border-radius: 12px;
  color: rgba(255, 255, 255, .9);
  font-size: .8rem;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  white-space: nowrap;
}

.gen-preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-6);
}
.preview-icon { font-size: 3.5rem; color: var(--t3); opacity: .2; }
.preview-hint { font-size: .85rem; color: var(--t3); }
</style>
