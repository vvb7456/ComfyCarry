<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'CheckpointSelector' })

export interface CheckpointInfo {
  name: string
  displayName: string
  previewUrl?: string | null
  fallbackUrl?: string | null
  previewIsVideo?: boolean
  arch?: string
  baseModel?: string
  /** 打包形态 (整合包/拆分), 两形态并存 tab 下显示徽章 */
  packaging?: 'checkpoint' | 'split'
}

const props = defineProps<{
  selected: CheckpointInfo | null
  disabled?: boolean
  /** Override default 'select checkpoint' empty label (i18n string already resolved by caller) */
  emptyLabel?: string
  changeLabel?: string
  /** 该模型本机缺失 (引用保留但标警示, 与 LoRA 卡片同语义) */
  missing?: boolean
}>()

const emit = defineEmits<{
  open: []
}>()

const { t } = useI18n({ useScope: 'global' })

function onImgError(e: Event) {
  const img = e.target as HTMLImageElement
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
    :class="{ 'ckpt-selector--disabled': disabled, 'ckpt-selector--missing': missing }"
    @click="emit('open')"
  >
    <!-- 空态与其他架构一字不差 — 视频不再换专用长文案 (已移到 picker 空结果态),
         「+」统一用 MsIcon add (AddCard 同款), 不用字面 '+' -->
    <div v-if="!selected" class="ckpt-empty">
      <span class="ckpt-empty__icon"><MsIcon name="add" size="sm" color="none" /></span>
      <span class="ckpt-empty__text">{{ emptyLabel || t('generate.basic.select_checkpoint') }}</span>
    </div>

    <div v-else class="ckpt-card">
      <div class="ckpt-card__img">
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
        <img
          v-else-if="selected.previewUrl"
          :src="selected.previewUrl"
          alt=""
          loading="lazy"
          @error="onImgError"
        />
        <div v-if="!selected.previewUrl" class="ckpt-card__no-img">
          <MsIcon name="image_not_supported" size="lg" color="none" />
        </div>
        <!-- 缺失标记: 引用了但本机没有。条目保留, 补齐文件后即恢复 -->
        <div v-if="missing" class="ckpt-card__missing" :title="t('generate.missing.tag_hint')">
          <MsIcon name="error_outline" size="sm" color="none" />
        </div>
        <span v-if="selected.baseModel" class="ckpt-card__tag">{{ selected.baseModel }}</span>
        <span v-else-if="selected.arch && selected.arch !== 'unknown'" class="ckpt-card__tag ckpt-card__tag--dim">{{ selected.arch }}</span>
        <span
          v-if="selected.packaging"
          class="ckpt-card__pkg-badge"
          :class="`ckpt-card__pkg-badge--${selected.packaging}`"
        >
          {{ selected.packaging === 'checkpoint'
            ? t('generate.picker.packaging_checkpoint')
            : t('generate.picker.packaging_split') }}
        </span>
      </div>
      <div class="ckpt-card__info">
        <div class="ckpt-card__name" :title="selected.displayName">{{ selected.displayName }}</div>
        <span class="ckpt-card__hint">{{ changeLabel || t('generate.basic.click_change') }}</span>
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  flex-shrink: 0;
}

.ckpt-selector:hover .ckpt-empty {
  border-color: var(--ac);
  color: var(--ac);
}

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
  background: var(--overlay);
  color: var(--t-inv-2);
}

.ckpt-card__pkg-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  font-size: .55rem;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
  pointer-events: none;
  line-height: 1.4;
}
.ckpt-card__pkg-badge--checkpoint {
  background: var(--tag-packaging-checkpoint);
  color: #fff;
}
.ckpt-card__pkg-badge--split {
  background: var(--tag-packaging-split);
  color: #fff;
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

/* 缺失标记: 卡片右上角, 与左下角的打包徽章错开 */
.ckpt-card__missing {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--c-caution);
  color: var(--t-inv);
}
.ckpt-selector--missing .ckpt-card {
  border-color: var(--c-caution);
}
</style>
