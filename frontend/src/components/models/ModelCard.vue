<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'

/**
 * ModelCard — shared visual shell for local & CivitAI model cards.
 *
 * Handles: image display (img/video/fallback), zoom icon, hover effects, title.
 * Consumers provide: #meta and #actions slot content.
 */
defineOptions({ name: 'ModelCard' })

const { t } = useI18n({ useScope: 'global' })

const props = defineProps<{
  /** Primary image URL */
  imageSrc?: string
  /** Fallback image URL (used if primary fails) */
  imageFallback?: string
  /** Whether fallback is a video */
  isVideo?: boolean
  /** Card title text */
  title: string
  /** Full-size image URL for zoom preview */
  zoomUrl?: string
  /** NSFW 图片模糊遮罩 (Civitai blur 模式): true 时媒体加 blur + 点击揭开 */
  nsfwBlur?: boolean
}>()

const emit = defineEmits<{
  click: []
  preview: [url: string]
}>()

// ── Image fallback state machine ──
const primaryFailed = ref(false)
const fallbackFailed = ref(false)

// A CivitAI video card passes the same URL as both imageSrc and imageFallback.
// In that case the URL is video-only; local model cards still use imageSrc for
// the sidecar image and imageFallback for a remote video fallback.
const videoOnlySource = computed(() =>
  props.isVideo && !!props.imageSrc && props.imageSrc === props.imageFallback,
)

const primaryAvailable = computed(() =>
  !!props.imageSrc && !videoOnlySource.value && !primaryFailed.value,
)

const fallbackAvailable = computed(() =>
  !!props.imageFallback && !fallbackFailed.value &&
  (!primaryAvailable.value && (!props.imageSrc || primaryFailed.value || videoOnlySource.value)),
)

const displaySrc = computed(() => {
  // isVideo describes the fallback media; a local sidecar image still wins.
  if (primaryAvailable.value) return props.imageSrc
  if (fallbackAvailable.value && !props.isVideo) return props.imageFallback
  return ''
})

const showVideo = computed(() => {
  return props.isVideo && fallbackAvailable.value
})

const showNoImg = computed(() => !displaySrc.value && !showVideo.value)

// Only allow zoom for the currently displayed image. In particular, do not
// leave a zoom button pointing at a missing local image after falling back to
// a remote video (or a different remote image).
const showZoom = computed(() => {
  if (!props.zoomUrl || !displaySrc.value || showVideo.value) return false
  if (props.imageSrc) return displaySrc.value === props.imageSrc && !primaryFailed.value
  return true
})

// NSFW blur 遮罩揭开状态 (点击卡片媒体区切换; 切换媒体输入时复位)
const nsfwRevealed = ref(false)

watch(
  () => [props.imageSrc, props.imageFallback, props.isVideo],
  () => { nsfwRevealed.value = false },
)

function onNsfwOverlayClick() {
  if (props.nsfwBlur && !nsfwRevealed.value) {
    nsfwRevealed.value = true
  }
}

function onImgError() {
  if (primaryAvailable.value) primaryFailed.value = true
  else fallbackFailed.value = true
}

function onVideoError() {
  fallbackFailed.value = true
}

function onZoomClick() {
  if (props.zoomUrl) emit('preview', props.zoomUrl)
}

// Cards are commonly reused by v-for when the model list refreshes. Error
// state belongs to the URL, so clear it whenever any media input changes.
watch(
  () => [props.imageSrc, props.imageFallback, props.isVideo],
  () => {
    primaryFailed.value = false
    fallbackFailed.value = false
  },
)
</script>

<template>
  <div class="mc" @click="emit('click')">
    <!-- Image -->
    <div class="mc-img">
      <video
        v-if="showVideo"
        :class="{ 'mc-nsfw-blurred': nsfwBlur && !nsfwRevealed }"
        :src="imageFallback"
        muted autoplay loop playsinline disablepictureinpicture preload="metadata"
        @error="onVideoError"
      />
      <img
        v-else-if="displaySrc"
        :class="{ 'mc-nsfw-blurred': nsfwBlur && !nsfwRevealed }"
        :src="displaySrc"
        alt=""
        loading="lazy"
        @error="onImgError"
      >
      <div v-if="showNoImg" class="mc-no-img">
        <MsIcon name="image_not_supported" />
        <slot name="no-image" />
      </div>
      <button
        v-if="nsfwBlur && !nsfwRevealed"
        type="button"
        class="mc-nsfw-overlay"
        :title="t('models.nsfw.reveal_hint')"
        @click.stop="onNsfwOverlayClick"
      >
        <MsIcon name="visibility_off" size="sm" />
      </button>
      <span
        v-if="showZoom"
        class="mc-zoom"
        @click.stop="onZoomClick"
      >
        <MsIcon name="zoom_in" size="sm" />
      </span>
    </div>

    <!-- Body -->
    <div class="mc-body">
      <div class="mc-title-row">
        <div class="mc-title text-truncate" :title="title">{{ title }}</div>
        <slot name="title-badge" />
      </div>
      <div v-if="$slots.meta" class="mc-meta">
        <slot name="meta" />
      </div>
      <div v-if="$slots.actions" class="mc-actions" @click.stop>
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mc {
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  transition: all .2s;
  cursor: pointer;
}
.mc:hover {
  border-color: color-mix(in srgb, var(--ac) 40%, transparent);
  transform: translateY(-1px);
  box-shadow: var(--sh);
}

/* ── Image ──
   3:4 竖版 —— Civitai 首图 ~80% 为竖图 (主流 2:3), 竖框裁切最少;
   HF 白名单 workflow_templates 缩略图为 1:1, 裁 25% 宽仍在可接受范围。 */
.mc-img {
  width: 100%;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: var(--bg-in);
  position: relative;
}
.mc-img img,
.mc-img video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform .3s;
}
.mc:hover .mc-img img,
.mc:hover .mc-img video {
  transform: scale(1.04);
}

.mc-no-img {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--t3);
  font-size: .82rem;
  height: 100%;
}

.mc-zoom {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  background: var(--overlay);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t-inv);
  cursor: zoom-in;
  opacity: 0;
  transition: opacity .2s;
  z-index: 2;
}
.mc:hover .mc-zoom {
  opacity: 1;
}

/* ── NSFW blur 遮罩 (Civitai blur 模式) ──
   媒体加模糊 + 中央眼睛图标; 点击揭开单张, 媒体切换时复位。 */
.mc-nsfw-blurred {
  filter: blur(22px) saturate(.8);
  transform: scale(1.08);
}

.mc-nsfw-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 0;
  color: #fff;
  cursor: pointer;
  z-index: 1;
}

.mc-nsfw-overlay .ms {
  filter: drop-shadow(0 1px 4px rgb(0 0 0 / 50%));
  font-size: 26px;
}

/* ── Body ── */
.mc-body {
  padding: 12px 14px;
}

.mc-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  min-width: 0;
}

.mc-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: .92rem;
  font-weight: 600;
  line-height: 1.3;
}
.mc:hover .mc-title {
  color: var(--ac);
}

.mc-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  align-items: center;
}

.mc-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  justify-content: flex-end;
}
</style>
