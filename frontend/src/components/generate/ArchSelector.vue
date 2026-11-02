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

const notReady = computed(() => {
  const targetKey = store.modelSelections[selectedGroupKey.value] ?? modelType.value
  return store.componentsReady[targetKey] === false
})

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
  ready: boolean
  isVideoArch: boolean
  media: MediaSource | null
  tags: ArchTag[]
}

/**
 * 统一架构标签规范 (全部由 ModelTypeConfig 决定性派生，零手写硬编码):
 * 1. 提示词语法: Tag 提示词 | 自然语言
 * 2. 生成模式: 文生图 / 图生图 / 参考生成 / 文生视频 / 图生视频
 * 3. 加速能力: 快速模式 (支持 fastModel 或 FAST_PRESETS)
 * 4. 控制能力: ControlNet (controlNetEnabled = true)
 */
function buildArchTags(cfg: ModelTypeConfig): ArchTag[] {
  const tags: ArchTag[] = []

  // 1. 提示词语法
  tags.push({
    label: cfg.promptStyle === 'tags' ? t('generate.arch.tag_tags') : t('generate.arch.tag_natural'),
    kind: 'prompt',
  })

  // 2. 生成模式
  if (cfg.mediaType === 'video') {
    if (cfg.videoModes?.length) {
      for (const m of cfg.videoModes) {
        tags.push({
          label: t(m === 'i2v' || m === 't2v' ? `generate.video.mode_${m}` : `generate.mode.${m}`),
          kind: 'mode',
        })
      }
    } else if (cfg.key.includes('t2v')) {
      tags.push({ label: t('generate.video.mode_t2v'), kind: 'mode' })
    } else {
      tags.push({ label: t('generate.video.mode_i2v'), kind: 'mode' })
    }
  } else {
    if (cfg.modes?.length) {
      for (const m of cfg.modes) {
        tags.push({ label: t(`generate.mode.${m}`), kind: 'mode' })
      }
    } else {
      tags.push({ label: t('generate.mode.t2i'), kind: 'mode' })
      if (cfg.modules.includes('i2i')) {
        tags.push({ label: t('generate.modules.i2i'), kind: 'mode' })
      }
    }
  }

  // 3. 快速模式
  if (cfg.fastModel || FAST_PRESETS[cfg.key]) {
    tags.push({ label: t('generate.arch.tag_fast'), kind: 'feature' })
  }

  // 4. ControlNet
  if (cfg.controlNetEnabled) {
    tags.push({ label: t('generate.arch.tag_controlnet'), kind: 'feature' })
  }

  return tags
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
    const resolvedKey = store.modelSelections[cfg.key] ?? cfg.key
    const ready = store.componentsReady[resolvedKey] !== false
    const media = mediaFailed.value[cfg.key] ? null : resolveArchMedia(cfg)

    return {
      key: cfg.key,
      label: t(`generate.tabs.${cfg.key}`),
      desc: t(`generate.arch.desc.${cfg.key}`),
      logo: cfg.logo,
      logoInvertDark: cfg.logoInvertDark,
      letter: cfg.label.slice(0, 2) || cfg.key.slice(0, 2).toUpperCase(),
      familyLabel,
      ready,
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

        <span class="arch-trigger__name">{{ t(`generate.tabs.${selectedGroupKey}`) }}</span>

        <span class="arch-trigger__badge">
          {{ config.mediaType === 'video' ? t('generate.header.task_video') : t('generate.header.task_image') }}
        </span>

        <span v-if="notReady" class="arch-trigger__warn">
          {{ t('generate.header.not_ready') }}
        </span>

        <span class="arch-trigger__action">
          <MsIcon name="swap_horiz" size="xs" color="none" />
          <span>{{ t('generate.arch.switch_btn') }}</span>
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
      <!-- 任务大类导航卡片 (取代原先简易分段开关) -->
      <div class="arch-cat-nav" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="modalTask === 'image'"
          class="arch-cat-card"
          :class="{ 'arch-cat-card--active': modalTask === 'image' }"
          @click="onModalTaskChange('image')"
        >
          <span class="arch-cat-card__icon">
            <MsIcon name="image" size="md" color="none" />
          </span>
          <span class="arch-cat-card__body">
            <span class="arch-cat-card__title">{{ t('generate.arch.cat_image_title') }}</span>
            <span class="arch-cat-card__sub">{{ t('generate.arch.cat_count', { count: imageArchCount }) }}</span>
          </span>
        </button>

        <button
          type="button"
          role="tab"
          :aria-selected="modalTask === 'video'"
          class="arch-cat-card"
          :class="{ 'arch-cat-card--active': modalTask === 'video' }"
          @click="onModalTaskChange('video')"
        >
          <span class="arch-cat-card__icon">
            <MsIcon name="videocam" size="md" color="none" />
          </span>
          <span class="arch-cat-card__body">
            <span class="arch-cat-card__title">{{ t('generate.arch.cat_video_title') }}</span>
            <span class="arch-cat-card__sub">{{ t('generate.arch.cat_count', { count: videoArchCount }) }}</span>
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected="false"
          disabled
          class="arch-cat-card arch-cat-card--disabled"
        >
          <span class="arch-cat-card__icon">
            <MsIcon name="edit" size="md" color="none" />
          </span>
          <span class="arch-cat-card__body">
            <span class="arch-cat-card__title">{{ t('generate.arch.cat_edit_title') }}</span>
            <span class="arch-cat-card__sub">{{ t('generate.arch.cat_edit_sub') }}</span>
          </span>
        </button>
      </div>

      <!-- 架构画廊网格 (带真实预览图/预览动图、架构简介与能力标签) -->
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
            <!-- 16:10 视觉封面区 -->
            <div class="arch-gallery-card__cover">
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

              <!-- 顶部悬浮角标行: 左侧系列归属 / 视频动图标识, 右侧当前使用或就绪状态 -->
              <div class="arch-gallery-card__top-badges">
                <div class="arch-gallery-card__top-left">
                  <span v-if="item.familyLabel" class="arch-pill arch-pill--family">
                    {{ item.familyLabel }}
                  </span>
                  <span v-if="item.isVideoArch" class="arch-pill arch-pill--video">
                    <MsIcon name="videocam" size="xs" color="none" />
                  </span>
                </div>

                <span v-if="item.key === selectedGroupKey" class="arch-pill arch-pill--active">
                  <MsIcon name="check" size="xs" color="none" />
                  <span>{{ t('generate.arch.current_used') }}</span>
                </span>
                <span
                  v-else
                  class="arch-pill"
                  :class="item.ready ? 'arch-pill--ready' : 'arch-pill--warn'"
                >
                  {{ item.ready ? t('generate.arch.ready') : t('generate.header.not_ready') }}
                </span>
              </div>

              <!-- 封面底部品牌标识与架构标题 -->
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
            </div>

            <!-- 底部信息区: 两行自然语言简介 + 统一规范能力标签 -->
            <div class="arch-gallery-card__body">
              <p class="arch-gallery-card__desc" :title="item.desc">{{ item.desc }}</p>
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

/* 与 DrawerTrigger / SegmentedControl(md) 同高 (34px) 同底色 */
.arch-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 6px 0 10px;
  box-sizing: border-box;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  color: var(--t1);
  font-family: inherit;
  font-size: var(--text-base);
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
  width: 20px;
  height: 20px;
  border-radius: 4px;
}

.arch-logo--md {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .35);
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

.arch-trigger__name {
  font-weight: 600;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arch-trigger__badge {
  font-size: .66rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ac) 14%, transparent);
  color: var(--ac);
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.4;
}

.arch-trigger__warn {
  font-size: .66rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--c-caution) 15%, transparent);
  color: var(--c-caution);
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.4;
}

.arch-trigger__action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 2px;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  color: var(--t2);
  font-size: .72rem;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color .15s, border-color .15s, background .15s;
}

.arch-trigger:hover:not(:disabled) .arch-trigger__action {
  color: var(--ac);
  border-color: color-mix(in srgb, var(--ac) 35%, var(--bd));
  background: color-mix(in srgb, var(--ac) 10%, var(--bg2));
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

  .arch-trigger__action {
    margin-left: auto;
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

/* ═══ Modal 顶部任务大类切换卡片 ═══ */
.arch-cat-nav {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: var(--sp-3);
}

.arch-cat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg3);
  border: 1.5px solid var(--bd);
  border-radius: var(--r);
  color: var(--t2);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, color .16s ease;
  min-width: 0;
}

.arch-cat-card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ac) 50%, var(--bd));
  background: color-mix(in srgb, var(--ac) 5%, var(--bg3));
  color: var(--t1);
}

.arch-cat-card--active {
  border-color: var(--ac);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ac) 15%, var(--bg3)),
    color-mix(in srgb, var(--ac2) 6%, var(--bg3))
  );
  color: var(--t1);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .16);
}

.arch-cat-card--disabled {
  opacity: .45;
  cursor: not-allowed;
}

.arch-cat-card__icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  color: var(--t2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background .16s ease, color .16s ease, border-color .16s ease, box-shadow .16s ease;
}

.arch-cat-card--active .arch-cat-card__icon {
  background: var(--ac);
  border-color: var(--ac);
  color: #fff;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--ac) 40%, transparent);
}

.arch-cat-card__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.arch-cat-card__title {
  font-size: .88rem;
  font-weight: 700;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arch-cat-card__sub {
  font-size: .7rem;
  color: var(--t3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arch-cat-card--active .arch-cat-card__sub {
  color: var(--t2);
}

/* ═══ Modal 架构画廊网格与卡片 ═══ */
.arch-modal__grid-wrap {
  overflow-y: auto;
  max-height: min(64vh, 580px);
  padding-right: 4px;
}

.arch-modal__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.arch-gallery-card {
  display: flex;
  flex-direction: column;
  padding: 0;
  background: var(--bg3);
  border: 2px solid var(--bd);
  border-radius: var(--r-lg, 12px);
  color: inherit;
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
  background: color-mix(in srgb, var(--ac) 5%, var(--bg3));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ac) 30%, transparent), var(--sh);
}

/* 16:10 封面区 */
.arch-gallery-card__cover {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  background: var(--bg2);
  overflow: hidden;
  flex-shrink: 0;
}

.arch-gallery-card__media {
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
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 25% 25%, color-mix(in srgb, var(--ac) 22%, transparent), transparent 60%),
    radial-gradient(circle at 80% 75%, color-mix(in srgb, var(--ac2) 18%, transparent), transparent 60%),
    var(--bg2);
}

/* 底部暗角渐变遮罩，保证封面上的品牌图标与白色标题在任何亮色预览图上清晰可读 */
.arch-gallery-card__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(10, 12, 18, .38) 0%,
    rgba(10, 12, 18, .05) 42%,
    rgba(10, 12, 18, .84) 100%
  );
  pointer-events: none;
}

.arch-gallery-card__top-badges {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  z-index: 1;
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

.arch-pill--active {
  background: var(--ac);
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .3);
}

.arch-pill--ready {
  background: rgba(15, 18, 26, .65);
  border: 1px solid rgba(255, 255, 255, .14);
  color: rgba(255, 255, 255, .85);
}

.arch-pill--warn {
  background: rgba(24, 18, 10, .78);
  border: 1px solid color-mix(in srgb, var(--c-caution) 55%, transparent);
  color: var(--c-caution);
}

.arch-gallery-card__hero {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 9px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  z-index: 1;
}

.arch-gallery-card__title {
  font-size: .92rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, .65);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 卡片下半部: 简介 + 标签 */
.arch-gallery-card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px 12px;
}

.arch-gallery-card__desc {
  margin: 0;
  font-size: .75rem;
  line-height: 1.48;
  color: var(--t2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: calc(1.48em * 2);
}

.arch-gallery-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.arch-tag {
  font-size: .67rem;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  color: var(--t2);
  white-space: nowrap;
  line-height: 1.35;
}

.arch-tag--feature {
  background: color-mix(in srgb, var(--ac) 10%, var(--bg2));
  border-color: color-mix(in srgb, var(--ac) 28%, var(--bd));
  color: var(--ac);
}

/* ═══ Modal 移动端适配 ═══ */
@media (max-width: 600px) {
  .arch-cat-nav {
    gap: 6px;
  }

  .arch-cat-card {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 5px;
    padding: 8px 6px;
  }

  .arch-cat-card__icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
  }

  .arch-cat-card__body {
    align-items: center;
  }

  .arch-cat-card__title {
    font-size: .78rem;
  }

  .arch-cat-card__sub {
    font-size: .64rem;
  }

  .arch-modal__grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}
</style>
