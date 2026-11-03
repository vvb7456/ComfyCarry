<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { FAST_PRESETS, MODEL_MENU, MODEL_TYPES, type ModelTypeConfig } from '@/config/model-types'
import { MODEL_WHITELIST } from '@/config/huggingface-models'
import BaseModal from '@/components/ui/BaseModal.vue'
import SegmentedControl, { type SegmentOption } from '@/components/ui/SegmentedControl.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'ArchSelector' })

const props = defineProps<{
  disabled?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()

const modelType = computed(() => store.activeModelType)
const state = computed(() => store.currentState)
const config = computed(() => store.currentConfig)

const selectedGroupKey = computed(() => config.value.menuKey ?? modelType.value)

const modeOptions = computed<SegmentOption[]>(() =>
  (config.value.videoModes ?? config.value.modes ?? []).map(m => ({
    value: m,
    label: t(m === 'i2v' || m === 't2v' ? `generate.video.mode_${m}` : `generate.mode.${m}`),
  })),
)

const currentMode = computed(() => state.value.video?.mode ?? state.value.mode)

const hasSpeed = computed(() => !!config.value.fastModel || !!FAST_PRESETS[config.value.key])

const speedOptions = computed<SegmentOption[]>(() => [
  { value: 'standard', label: t('generate.video.speed_std'), disabled: config.value.fastLocked && state.value.fast },
  { value: 'fast', label: t('generate.video.speed_fast'), disabled: config.value.fastLocked && !state.value.fast },
])

const hasControls = computed(() => modeOptions.value.length > 0 || hasSpeed.value)

const modalOpen = ref(false)
const modalTask = ref<'image' | 'video'>(config.value.mediaType)

function openModal() {
  if (props.disabled) return
  modalTask.value = config.value.mediaType
  modalOpen.value = true
}

watch(() => store.activeModelType, () => {
  if (modalOpen.value) modalOpen.value = false
})

const imageArchCount = computed(() => MODEL_MENU.filter(c => c.mediaType === 'image').length)
const videoArchCount = computed(() => MODEL_MENU.filter(c => c.mediaType === 'video').length)

function onModalTaskChange(v: 'image' | 'video') {
  modalTask.value = v
}

interface MediaSource {
  url: string
  isVideo: boolean
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const MAIN_WEIGHT_ENTRIES = MODEL_WHITELIST.filter(m => {
  const mt = m.version.file.modelType
  return (mt === 'checkpoints' || mt === 'diffusion_models') &&
    Boolean(m.images?.[0]?.url || m.version.images?.[0]?.url)
})

function resolveArchMedia(cfg: ModelTypeConfig): MediaSource | null {
  const candidates = MAIN_WEIGHT_ENTRIES.filter(m => m.version.file.architecture === cfg.pickerArch)
  if (!candidates.length) return null

  const labelNorm = normKey(cfg.label)
  const matched = candidates.find(m => normKey(m.version.baseModel) === labelNorm) ?? candidates[0]!
  const img = matched.images?.[0] ?? matched.version.images?.[0]
  return img?.url ? { url: img.url, isVideo: img.type === 'video' } : null
}

const mediaFailed = ref<Record<string, boolean>>({})

function onMediaError(key: string) {
  mediaFailed.value[key] = true
}

interface ArchTag {
  label: string
  kind: 'prompt' | 'mode' | 'feature'
}

interface ArchCardItem {
  key: string
  label: string
  desc: string
  logo?: string
  logoInvertDark?: boolean
  letter: string
  familyLabel?: string
  isVideoArch: boolean
  media: MediaSource | null
  tags: ArchTag[]
}

/**
 * 统一架构标签规范 (全部由 ModelTypeConfig 决定性派生，零手写硬编码):
 * 每张卡片固定输出 3 个高信息量标签，保证单行整齐排列:
 * 1. 提示词语法: Tag 提示词 | 自然语言
 * 2. 核心工作流 / 加速 / 控制能力 (参考生成、快速模式、ControlNet、文/图生图等)
 */
function buildArchTags(cfg: ModelTypeConfig): ArchTag[] {
  const tags: ArchTag[] = []

  // 1. 提示词语法
  tags.push({
    label: cfg.promptStyle === 'tags' ? t('generate.arch.tag_tags') : t('generate.arch.tag_natural'),
    kind: 'prompt',
  })

  // 2. 差异化模式与核心特性
  if (cfg.modes?.includes('ref') || cfg.videoModes?.includes('ref')) {
    tags.push({ label: t('generate.mode.ref'), kind: 'mode' })
  }
  if (cfg.fastModel || FAST_PRESETS[cfg.key]) {
    tags.push({ label: t('generate.arch.tag_fast'), kind: 'feature' })
  }
  if (cfg.controlNetEnabled && tags.length < 3) {
    tags.push({ label: t('generate.arch.tag_controlnet'), kind: 'feature' })
  }

  // 3. 补足基础生成模式至 3 个标签，保证所有卡片底部标签行高度与密度完全一致
  const fallbackModes: string[] = cfg.mediaType === 'video'
    ? [t('generate.video.mode_t2v'), t('generate.video.mode_i2v')]
    : [
        ...(cfg.modules.includes('i2i') ? [t('generate.modules.i2i')] : []),
        t('generate.mode.t2i'),
      ]

  for (const label of fallbackModes) {
    if (tags.length >= 3) break
    if (!tags.some(item => item.label === label)) {
      tags.push({ label, kind: 'mode' })
    }
  }

  return tags.slice(0, 3)
}

const FAMILY_LABEL_KEYS = new Set([
  'sdxl',
  'flux1',
  'flux2',
  'wan22',
  'minimax_h3',
  'qwen_image21',
  'anima',
  'zimage',
])

const modalItems = computed<ArchCardItem[]>(() => {
  const filtered = MODEL_MENU.filter(cfg => cfg.mediaType === modalTask.value)

  // 按家族分组并沿用发布时间排序，保证同系列架构相邻展示
  const relOf = (key: string) => MODEL_TYPES[key]?.releasedAt ?? '9999-99'
  const famKeyOf = (cfg: ModelTypeConfig) => cfg.familyOf ?? cfg.key

  const famEarliest: Record<string, string> = {}
  for (const cfg of filtered) {
    const fk = famKeyOf(cfg)
    const r = relOf(cfg.key)
    if (!famEarliest[fk] || r.localeCompare(famEarliest[fk]) < 0) {
      famEarliest[fk] = r
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const fa = famKeyOf(a)
    const fb = famKeyOf(b)
    if (fa !== fb) {
      return (famEarliest[fa] ?? '9999-99').localeCompare(famEarliest[fb] ?? '9999-99')
    }
    return relOf(a.key).localeCompare(relOf(b.key))
  })

  return sorted.map(cfg => {
    const fk = famKeyOf(cfg)
    const familyLabel = FAMILY_LABEL_KEYS.has(fk) ? t(`generate.header.family_${fk}`) : undefined
    const media = mediaFailed.value[cfg.key] ? null : resolveArchMedia(cfg)

    return {
      key: cfg.key,
      label: t(`generate.tabs.${cfg.key}`),
      desc: t(`generate.arch.desc.${cfg.key}`),
      logo: cfg.logo,
      logoInvertDark: cfg.logoInvertDark,
      letter: cfg.label.slice(0, 2) || cfg.key.slice(0, 2).toUpperCase(),
      familyLabel,
      isVideoArch: cfg.mediaType === 'video',
      media,
      tags: buildArchTags(cfg),
    }
  })
})

function selectArch(key: string) {
  modalOpen.value = false
  if (selectedGroupKey.value !== key || store.activeTask !== modalTask.value) {
    store.selectModelGroup(key)
  }
}
</script>

<template>
  <div class="arch-bar" :inert="disabled" :class="{ 'arch-bar--disabled': disabled }">
    <div class="arch-bar__main">
      <span class="arch-bar__label">{{ t('generate.header.model_label') }}</span>
      <button
        type="button"
        class="arch-trigger"
        :class="{ 'arch-trigger--open': modalOpen }"
        :disabled="disabled"
        :aria-label="t('generate.header.model_selector_aria')"
        @click="openModal"
      >
        <span
          class="arch-logo arch-logo--sm"
          :class="{ 'arch-logo--pad': config.logo }"
        >
          <img v-if="config.logo" :src="config.logo" :alt="config.label" class="arch-logo__img" />
          <span v-else class="arch-logo__letter">{{ config.label.slice(0, 2) }}</span>
        </span>

        <span class="arch-trigger__info">
          <span class="arch-trigger__top">
            <span class="arch-trigger__name">{{ t(`generate.tabs.${selectedGroupKey}`) }}</span>
            <span class="arch-trigger__badge">
              {{ config.mediaType === 'video' ? t('generate.header.task_video') : t('generate.header.task_image') }}
            </span>
          </span>
          <span class="arch-trigger__fact">{{ t('generate.arch.click_change') }}</span>
        </span>
      </button>
    </div>

    <div v-if="hasControls" class="arch-bar__controls">
      <SegmentedControl
        v-if="modeOptions.length > 0"
        :options="modeOptions"
        :model-value="currentMode"
        :disabled="disabled"
        size="md"
        class="arch-bar__seg"
        @update:model-value="store.setMode(String($event))"
      />
      <SegmentedControl
        v-if="hasSpeed"
        :options="speedOptions"
        :model-value="state.fast ? 'fast' : 'standard'"
        :disabled="disabled"
        size="md"
        class="arch-bar__seg"
        @update:model-value="store.setFast($event === 'fast')"
      />
    </div>

    <BaseModal
      v-model="modalOpen"
      :title="t('generate.arch.modal_title')"
      icon="view_in_ar"
      size="xl"
      width="940px"
      density="default"
      scroll="none"
    >
      <!-- 顶部任务大类导航栏 (底线式 Tab 导航条 + 通栏分割线, 与下方画廊卡片明确区分层级) -->
      <div class="arch-modal__nav" role="tablist">
        <div class="arch-modal__tabs">
          <button
            type="button"
            role="tab"
            :aria-selected="modalTask === 'image'"
            class="arch-nav-tab"
            :class="{ 'arch-nav-tab--active': modalTask === 'image' }"
            @click="onModalTaskChange('image')"
          >
            <MsIcon name="image" size="sm" color="none" />
            <span class="arch-nav-tab__label">{{ t('generate.arch.cat_image_title') }}</span>
            <span class="arch-nav-tab__badge">{{ imageArchCount }}</span>
          </button>

          <button
            type="button"
            role="tab"
            :aria-selected="modalTask === 'video'"
            class="arch-nav-tab"
            :class="{ 'arch-nav-tab--active': modalTask === 'video' }"
            @click="onModalTaskChange('video')"
          >
            <MsIcon name="videocam" size="sm" color="none" />
            <span class="arch-nav-tab__label">{{ t('generate.arch.cat_video_title') }}</span>
            <span class="arch-nav-tab__badge">{{ videoArchCount }}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected="false"
            disabled
            class="arch-nav-tab arch-nav-tab--disabled"
          >
            <MsIcon name="edit" size="sm" color="none" />
            <span class="arch-nav-tab__label">{{ t('generate.arch.cat_edit_title') }}</span>
            <span class="arch-nav-tab__badge arch-nav-tab__badge--muted">{{ t('generate.arch.cat_edit_sub') }}</span>
          </button>
        </div>

        <span class="arch-modal__nav-hint">
          {{ modalTask === 'video'
            ? t('generate.arch.cat_video_sub', { count: videoArchCount })
            : t('generate.arch.cat_image_sub', { count: imageArchCount }) }}
        </span>
      </div>

      <!-- 架构画廊网格 (3:4 竖版比例 + 统一基线底部 Overlay) -->
      <div class="arch-modal__grid-wrap">
        <div class="arch-modal__grid">
          <button
            v-for="item in modalItems"
            :key="item.key"
            type="button"
            class="arch-gallery-card"
            :class="{ 'arch-gallery-card--selected': item.key === selectedGroupKey }"
            @click="selectArch(item.key)"
          >
            <video
              v-if="item.media && item.media.isVideo"
              :key="item.media.url"
              :src="item.media.url"
              class="arch-gallery-card__media"
              autoplay
              loop
              muted
              playsinline
              @error="onMediaError(item.key)"
            />
            <img
              v-else-if="item.media"
              :key="item.media.url"
              :src="item.media.url"
              :alt="item.label"
              loading="lazy"
              class="arch-gallery-card__media"
              @error="onMediaError(item.key)"
            />
            <div v-else class="arch-gallery-card__fallback">
              <div
                class="arch-logo arch-logo--lg"
                :class="{ 'arch-logo--pad': item.logo }"
              >
                <img v-if="item.logo" :src="item.logo" :alt="item.label" class="arch-logo__img" />
                <span v-else class="arch-logo__letter">{{ item.letter }}</span>
              </div>
            </div>

            <div class="arch-gallery-card__scrim" />

            <!-- 顶部悬浮角标行: 左侧系列归属 / 视频动图标识, 右侧当前选中勾选标记 -->
            <div class="arch-gallery-card__top-badges">
              <div class="arch-gallery-card__top-left">
                <span v-if="item.familyLabel" class="arch-pill arch-pill--family">
                  {{ item.familyLabel }}
                </span>
                <span v-if="item.isVideoArch" class="arch-pill arch-pill--video">
                  <MsIcon name="videocam" size="xs" color="none" />
                </span>
              </div>

              <span
                v-if="item.key === selectedGroupKey"
                class="arch-gallery-card__check"
                :title="t('generate.arch.current_used')"
                :aria-label="t('generate.arch.current_used')"
              >
                <MsIcon name="check" size="xs" color="none" />
              </span>
            </div>

            <!-- 底部定高渐暗 Overlay: 顶部锁定品牌+标题, 中段两行简介, 底部单行3标签 -->
            <div class="arch-gallery-card__overlay">
              <div class="arch-gallery-card__hero">
                <div
                  class="arch-logo arch-logo--md"
                  :class="{ 'arch-logo--pad': item.logo }"
                >
                  <img v-if="item.logo" :src="item.logo" :alt="item.label" class="arch-logo__img" />
                  <span v-else class="arch-logo__letter">{{ item.letter }}</span>
                </div>
                <span class="arch-gallery-card__title" :title="item.label">{{ item.label }}</span>
              </div>

              <p class="arch-gallery-card__desc">{{ item.desc }}</p>

              <div class="arch-gallery-card__tags">
                <span
                  v-for="tag in item.tags"
                  :key="tag.label"
                  class="arch-tag"
                  :class="`arch-tag--${tag.kind}`"
                >
                  {{ tag.label }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
/* ═══ 顶栏内嵌架构与工作流控制条 ═══ */
.arch-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  min-width: 0;
}

.arch-bar--disabled {
  opacity: .45;
  cursor: not-allowed;
}

.arch-bar__main {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.arch-bar__label {
  font-size: var(--text-xs);
  color: var(--t3);
  user-select: none;
  white-space: nowrap;
}

/* 双行架构触发器: 恒高 38px, 贴合 PageHeaderRow 内容行基准高度, 不撑高页头 */
.arch-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 2px 12px 2px 6px;
  box-sizing: border-box;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  color: var(--t1);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background .15s, box-shadow .15s;
  min-width: 0;
}

.arch-trigger:hover:not(:disabled) {
  border-color: var(--ac);
  background: color-mix(in srgb, var(--ac) 4%, var(--bg3));
}

.arch-trigger--open {
  border-color: var(--ac);
}

.arch-trigger:disabled {
  cursor: not-allowed;
}

.arch-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.arch-logo--sm {
  width: 26px;
  height: 26px;
  border-radius: 6px;
}

.arch-logo--md {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .4);
}

.arch-logo--lg {
  width: 48px;
  height: 48px;
  border-radius: 12px;
}

.arch-logo--pad {
  background: var(--bg-logo-pad, #f1f3f5);
  border: 1px solid var(--bd);
  padding: 2px;
}

.arch-logo__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.arch-logo__letter {
  font-size: .7rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac2));
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
}

.arch-logo--lg .arch-logo__letter {
  font-size: 1.05rem;
}

.arch-trigger__info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  min-width: 0;
}

.arch-trigger__top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  line-height: 1.15;
}

.arch-trigger__name {
  font-size: .82rem;
  font-weight: 700;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arch-trigger__badge {
  font-size: .62rem;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ac) 14%, transparent);
  color: var(--ac);
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.25;
}

.arch-trigger__fact {
  font-size: .66rem;
  color: var(--t3);
  line-height: 1.15;
  white-space: nowrap;
  transition: color .15s;
}

.arch-trigger:hover:not(:disabled) .arch-trigger__fact {
  color: var(--ac);
}

.arch-bar__controls {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 窄屏 (<600px, 与 PageHeaderRow 断点对齐): 触发器与模式/速度开关各占通栏行 */
@container page (max-width: 600px) {
  .arch-bar {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 6px;
  }

  .arch-bar__label {
    display: none;
  }

  .arch-bar__main {
    width: 100%;
  }

  .arch-trigger {
    width: 100%;
  }

  .arch-bar__controls {
    width: 100%;
    display: flex;
    gap: 6px;
  }

  .arch-bar__seg {
    flex: 1 1 auto;
  }

  .arch-bar__seg :deep(.seg-control__item) {
    flex: 1;
    justify-content: center;
    text-align: center;
  }
}

/* ═══ Modal 顶部底线式导航栏 (与下方画廊卡片清晰区分视觉层级) ═══ */
.arch-modal__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -4px -24px 0;
  padding: 0 24px;
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.arch-modal__tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.arch-modal__tabs::-webkit-scrollbar {
  display: none;
}

.arch-nav-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px 11px;
  border: none;
  background: none;
  color: var(--t2);
  font: inherit;
  font-size: .88rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
  transition: color .15s ease, background .15s ease;
}

.arch-nav-tab::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2.5px;
  border-radius: 2px 2px 0 0;
  background: transparent;
  transition: background .16s ease, box-shadow .16s ease;
}

.arch-nav-tab:hover:not(:disabled) {
  color: var(--t1);
  background: color-mix(in srgb, var(--t1) 4%, transparent);
}

.arch-nav-tab--active {
  color: var(--t1);
  font-weight: 700;
}

.arch-nav-tab--active :deep(.ms) {
  color: var(--ac);
}

.arch-nav-tab--active::after {
  background: var(--ac);
  box-shadow: 0 -1px 8px color-mix(in srgb, var(--ac) 45%, transparent);
}

.arch-nav-tab--disabled {
  opacity: .42;
  cursor: not-allowed;
}

.arch-nav-tab__badge {
  font-size: .68rem;
  font-weight: 600;
  line-height: 1.3;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  color: var(--t2);
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}

.arch-nav-tab--active .arch-nav-tab__badge {
  background: color-mix(in srgb, var(--ac) 16%, transparent);
  border-color: color-mix(in srgb, var(--ac) 38%, transparent);
  color: var(--ac);
}

.arch-nav-tab__badge--muted {
  font-weight: 500;
  color: var(--t3);
}

.arch-modal__nav-hint {
  font-size: .75rem;
  color: var(--t3);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ═══ Modal 架构画廊网格与 3:4 竖版卡片 ═══
   桌面端使用 flex: none + 固定 height (恰好容纳两行完整卡片 + 第三行露头约 40px 提示可滚动),
   避免 flex-basis:0% 覆盖 height 导致切换至视频页(仅单行)时外层弹窗收缩跳动;
   内边距留足 16px 顶部缓冲与 6px 左右缓冲，保证首行卡片 hover 上浮 (-2px) 与
   2px 选中外发光环完全在滚动盒与渐隐遮罩的不透明区内，绝不被上方分割线裁切 */
.arch-modal__grid-wrap {
  flex: none;
  height: min(650px, calc(88vh - 106px));
  overflow-y: auto;
  margin: 0 -6px -16px;
  padding: 16px 6px 20px;
  mask-image: linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 8px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 8px), transparent 100%);
}

.arch-modal__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(205px, 1fr));
  gap: 12px;
}

.arch-gallery-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  /* 与 ModelCard / ModelPickerModal 同口径 3:4 竖版比例 */
  aspect-ratio: 3 / 4;
  padding: 0;
  background: var(--bg2);
  border: 2px solid var(--bd);
  border-radius: var(--r-lg, 12px);
  color: #fff;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
}

.arch-gallery-card:hover {
  border-color: var(--ac);
  box-shadow: var(--sh);
  transform: translateY(-2px);
}

.arch-gallery-card--selected {
  border-color: var(--ac);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac) 32%, transparent), var(--sh);
}

.arch-gallery-card__media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform .35s ease;
}

.arch-gallery-card:hover .arch-gallery-card__media {
  transform: scale(1.04);
}

.arch-gallery-card__fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 24%;
  background:
    radial-gradient(circle at 25% 25%, color-mix(in srgb, var(--ac) 24%, transparent), transparent 60%),
    radial-gradient(circle at 80% 75%, color-mix(in srgb, var(--ac2) 18%, transparent), transparent 60%),
    var(--bg2);
}

/* 渐暗遮罩: 上沿轻压保证角标清晰, 下半段提前加深压住高饱和度预览图, 保证白色文字清晰易读 */
.arch-gallery-card__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(6, 8, 14, .44) 0%,
    rgba(6, 8, 14, .05) 24%,
    rgba(6, 8, 14, .30) 44%,
    rgba(6, 8, 14, .88) 62%,
    rgba(6, 8, 14, .96) 78%,
    rgba(6, 8, 14, .99) 100%
  );
  pointer-events: none;
}

.arch-gallery-card__top-badges {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 10px 0;
}

.arch-gallery-card__top-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.arch-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: .66rem;
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.arch-pill--family {
  background: rgba(15, 18, 26, .68);
  border: 1px solid rgba(255, 255, 255, .14);
  color: rgba(255, 255, 255, .92);
}

.arch-pill--video {
  padding: 2px 5px;
  background: rgba(15, 18, 26, .68);
  border: 1px solid rgba(255, 255, 255, .14);
  color: #fff;
}

.arch-gallery-card__check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--ac);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .35);
}

/* 底部定高信息层 (Overlay):
   固定 120px 基准高度 —— 顶部锁定品牌图标+标题, 中间自然展示两行简介, 底部单行 3 标签并留出 16px 底边距,
   保证同行任意卡片的主标题、简介起点与标签行在水平方向上严格对齐 */
.arch-gallery-card__overlay {
  position: relative;
  z-index: 1;
  margin-top: auto;
  height: 120px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 6px;
  padding: 0 14px 16px;
}

.arch-gallery-card__hero {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  flex-shrink: 0;
  min-width: 0;
}

.arch-gallery-card__title {
  font-size: .92rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, .8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arch-gallery-card__desc {
  flex: 1;
  margin: 0;
  font-size: .74rem;
  line-height: 1.44;
  color: rgba(255, 255, 255, .94);
  text-shadow: 0 1px 3px rgba(0, 0, 0, .85);
  white-space: normal;
  word-break: break-word;
}

.arch-gallery-card__tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 5px;
  margin-top: auto;
  flex-shrink: 0;
  overflow: hidden;
}

.arch-tag {
  font-size: .64rem;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, .16);
  border: 1px solid rgba(255, 255, 255, .24);
  color: rgba(255, 255, 255, .96);
  white-space: nowrap;
  line-height: 1.35;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.arch-tag--feature {
  background: color-mix(in srgb, var(--ac) 42%, rgba(10, 12, 20, .82));
  border-color: color-mix(in srgb, var(--ac) 68%, rgba(255, 255, 255, .28));
  color: #fff;
}

/* ═══ Modal 移动端与平板响应式适配 ═══ */
@media (max-width: 768px) {
  /* 移动端全屏弹窗 (100dvh): 切换为 flex: 1 自动填满全屏剩余高度 */
  .arch-modal__grid-wrap {
    flex: 1;
    min-height: 0;
    height: auto;
  }

  .arch-modal__nav-hint {
    display: none;
  }
}

@media (max-width: 600px) {
  .arch-modal__nav {
    margin: -4px -16px 0;
    padding: 0 12px;
  }

  .arch-nav-tab {
    padding: 8px 8px 10px;
    font-size: .8rem;
    gap: 5px;
  }

  .arch-nav-tab__badge {
    font-size: .62rem;
    padding: 1px 5px;
  }

  .arch-modal__grid-wrap {
    padding: 12px 4px 16px;
    margin: 0 -4px -12px;
  }

  /* 移动端采用紧凑双列 3:4 网格, 单屏可同时浏览 4~6 款架构 */
  .arch-modal__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .arch-gallery-card__top-badges {
    padding: 7px 7px 0;
  }

  .arch-pill {
    font-size: .58rem;
    padding: 1px 5px;
  }

  .arch-gallery-card__check {
    width: 18px;
    height: 18px;
  }

  .arch-gallery-card__overlay {
    height: 106px;
    padding: 0 10px 12px;
    gap: 4px;
  }

  .arch-gallery-card__hero {
    height: 22px;
    gap: 6px;
  }

  .arch-logo--md {
    width: 22px;
    height: 22px;
    border-radius: 5px;
  }

  .arch-gallery-card__title {
    font-size: .8rem;
  }

  .arch-gallery-card__desc {
    font-size: .66rem;
    line-height: 1.38;
  }

  .arch-gallery-card__tags {
    gap: 3px;
  }

  .arch-tag {
    font-size: .56rem;
    padding: 1px 4px;
  }
}
</style>
