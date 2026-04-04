<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'

export interface CheckpointInfo {
  name: string
  displayName: string
  previewUrl?: string | null
  fallbackUrl?: string | null
  previewIsVideo?: boolean
  arch?: string
  baseModel?: string
}

const props = defineProps<{
  selected: CheckpointInfo | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  open: []
}>()

const { t } = useI18n({ useScope: 'global' })

function onImgError(e: Event) {
  const img = e.target as HTMLImageElement
  // Try CivitAI fallback if available
  if (!img.dataset.fb && props.selected?.fallbackUrl && img.src !== props.selected.fallbackUrl) {
    img.dataset.fb = '1'
    img.src = props.selected.fallbackUrl
  } else {
    img.style.display = 'none'
  }
}
</script>

<template>
  <div
    class="ckpt-selector"
    :class="{ 'ckpt-selector--disabled': disabled }"
    @click="emit('open')"
  >
    <!-- Empty state -->
    <div v-if="!selected" class="ckpt-empty">
      <span class="ckpt-empty__icon">+</span>
      <span class="ckpt-empty__text">{{ t('generate.basic.select_checkpoint') }}</span>
    </div>

    <!-- Selected state — horizontal: left 30% image | right info -->
    <div v-else class="ckpt-card">
      <div class="ckpt-card__img">
        <!-- Video preview -->
        <video
          v-if="selected.previewIsVideo && selected.previewUrl"
          :src="selected.previewUrl"
          muted
          autoplay
          loop
          playsinline
          disablepictureinpicture
          preload="metadata"
        />
        <!-- Image preview with fallback -->
        <img
          v-else-if="selected.previewUrl"
          :src="selected.previewUrl"
          alt=""
          loading="lazy"
          @error="onImgError"
        />
        <div v-if="!selected.previewUrl" class="ckpt-card__no-img">
          <MsIcon name="deployed_code" size="lg" color="none" />
        </div>
        <!-- Model tag badge -->
        <span v-if="selected.baseModel" class="ckpt-card__tag">{{ selected.baseModel }}</span>
        <span v-else-if="selected.arch && selected.arch !== 'unknown'" class="ckpt-card__tag ckpt-card__tag--dim">{{ selected.arch }}</span>
      </div>
      <div class="ckpt-card__info">
        <div class="ckpt-card__name" :title="selected.displayName">{{ selected.displayName }}</div>
        <span class="ckpt-card__hint">{{ t('generate.basic.click_change') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ckpt-selector {
  cursor: pointer;
  border-radius: var(--r);
  overflow: hidden;
  transition: all .15s;
}

.ckpt-selector--disabled {
  opacity: .55;
  pointer-events: none;
}

/* ── Empty state ── */
.ckpt-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  min-height: 60px;
  background: transparent;
  border: 2px dashed var(--bd);
  border-radius: var(--r);
  color: var(--t3);
  font-size: .85rem;
}

.ckpt-empty__icon {
  font-size: 1.2rem;
  font-weight: bold;
}

.ckpt-selector:hover .ckpt-empty {
  border-color: var(--ac);
  color: var(--ac);
}

/* ── Selected card — horizontal layout ── */
.ckpt-card {
  display: flex;
  align-items: stretch;
  height: 100%;
  min-height: 0;
  border: 2px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  background: var(--bg3);
  position: relative;
  padding-left: 30%;
}

.ckpt-selector:hover .ckpt-card {
  border-color: var(--ac);
  box-shadow: var(--sh);
}

.ckpt-card__img {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 30%;
  background: var(--bg-in, var(--bg3));
  overflow: hidden;
}

.ckpt-card__img img,
.ckpt-card__img video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ckpt-card__no-img {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
  opacity: .3;
}

/* ── Model tag badge (top-left of image area) ── */
.ckpt-card__tag {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  font-size: .58rem;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--ac);
  color: #fff;
  white-space: nowrap;
  max-width: calc(100% - 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  line-height: 1.4;
}

.ckpt-card__tag--dim {
  background: rgba(0, 0, 0, .5);
  color: rgba(255, 255, 255, .8);
}

.ckpt-card__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 6px 10px;
  gap: 2px;
}

.ckpt-card__name {
  font-size: .75rem;
  font-weight: 600;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.ckpt-card__hint {
  font-size: .7rem;
  color: var(--t3);
}
</style>
