<script setup lang="ts">
import { computed, watch, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import CheckpointSelector, { type CheckpointInfo } from '@/components/generate/CheckpointSelector.vue'
import VideoSettings from '@/components/generate/VideoSettings.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import RangeField from '@/components/form/RangeField.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { localModelPreviewUrl } from '@/utils/modelPreview'

defineOptions({ name: 'BasicSettings' })

const props = withDefaults(defineProps<{
  disabled?: boolean
  modelField?: 'checkpoint' | 'unet'
  /** 视频模式透传: 起始画面原始宽高 (跟随比例推导用; 仅 mediaType:'video' 有意义) */
  refWidth?: number
  refHeight?: number
}>(), {
  modelField: 'checkpoint',
  refWidth: 0,
  refHeight: 0,
})

const emit = defineEmits<{
  /** slot: 双 UNet 架构下是哪个槽发起的 (undefined = 单槽架构, 行为同改造前) */
  'open-model': [slot?: 'high' | 'low']
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)
const config = computed(() => store.currentConfig)
const options = inject(GenerateOptionsKey)!

const isVideo = computed(() => config.value.mediaType === 'video')

/**
 * 双 UNet 架构 (Wan 2.2 14B) 渲染**两个独立选择槽**, 不再配对折叠。
 * 实测: 高噪/低噪两文件在结构上完全无法区分 (字节数/头部长度/张量 key 全同,
 * 且无 __metadata__), 文件名是唯一信号且不可靠 —— 自动配对没有可靠地基。
 * 两个槽各是一个 CheckpointSelector, 各自打开同一个 picker 的普通单选模式。
 */
const isDualSlot = computed(() => !!config.value.dualUnet)

/** 按文件名构造展示信息 (两个槽共用; 空名 → null 走空态) */
function describe(name: string): CheckpointInfo | null {
  if (!name) return null
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const item = [...options.unets.value, ...options.checkpoints.value].find(c => c.name === name)
  const info = item?.info as Record<string, unknown> | null
  return {
    name,
    displayName: (info?.name as string) || base.replace(/\.[^.]+$/, ''),
    previewUrl: localModelPreviewUrl(item?.preview),
    arch: item?.arch,
    baseModel: info?.baseModel as string | undefined,
  }
}

const selectedHigh = computed(() => describe(state.value.unetHigh))
const selectedLow = computed(() => describe(state.value.unetLow))

/** 缺失标记 (与 LoRA 卡片同语义: 引用保留, 只是标出本机没有) */
const archKey = computed(() => store.activeModelType)
const missingOf = (name: string) => !!name && store.isMissing(archKey.value, name)

const selected = computed<CheckpointInfo | null>(() => {
  const name = props.modelField === 'unet' ? state.value.unet : state.value.checkpoint
  // 合并 picker 模式 fallback: 若主字段空但另一字段有值 (两形态并存 tab), 用另一字段
  const altName = props.modelField === 'unet' ? state.value.checkpoint : state.value.unet
  const effectiveName = name || altName
  if (!effectiveName) return null
  const base = effectiveName.includes('/') ? effectiveName.slice(effectiveName.lastIndexOf('/') + 1) : effectiveName
  const fallbackName = base.replace(/\.[^.]+$/, '')
  const item = [...options.unets.value, ...options.checkpoints.value].find(c => c.name === effectiveName)
  if (item) {
    const info = item.info as Record<string, unknown> | null
    const displayName = (info?.name as string) || fallbackName
    const baseModel = info?.baseModel as string | undefined
    let previewUrl: string | null = null
    let previewIsVideo = false
    if (item.preview) {
      previewUrl = localModelPreviewUrl(item.preview)
    }
    const civitImages = info?.images as Array<{ url?: string; type?: string }> | undefined
    const civitImg = civitImages?.[0]
    const civitUrl = civitImg?.url?.startsWith?.('http') ? civitImg.url : null
    if (!previewUrl && civitUrl) {
      previewUrl = civitUrl
      previewIsVideo = civitImg?.type === 'video'
    }
    return {
      name: item.name, displayName, previewUrl,
      fallbackUrl: previewUrl ? civitUrl : null,
      previewIsVideo, arch: item.arch, baseModel,
      packaging: item.packaging,
    }
  }
  return { name: effectiveName, displayName: fallbackName }
})

function openModelModal(slot?: 'high' | 'low') {
  emit('open-model', slot)
}

const resolutionPresets = computed(() => {
  const presets = store.currentConfig.resolutions.map(r => ({
    value: r.value,
    label: r.label,
  }))
  presets.push({ value: 'custom', label: t('generate.basic.custom') })
  return presets
})

const isCustomRes = computed(() => state.value.resolution === 'custom')

watch(() => state.value.resolution, (v) => {
  if (v !== 'custom') {
    const [w, h] = v.split('x').map(Number)
    if (w && h) {
      state.value.width = w
      state.value.height = h
    }
  }
})
</script>

<template>
  <div class="basic-settings" :class="{ 'basic-settings--disabled': disabled }">
    <div class="gen-s-hdr">
      <MsIcon name="tune" class="hdr-icon" />
      {{ t('generate.basic.title') }}
    </div>

    <div class="basic-grid">
      <!-- Left: Checkpoint / UNet。双 UNet 架构改为「高噪 / 低噪」两个独立槽 -->
      <div class="basic-grid__model" :class="{ 'basic-grid__model--dual': isDualSlot }">
        <template v-if="isDualSlot">
          <div class="dual-slot">
            <div class="field-lbl">
              {{ t('generate.basic.unet_high') }}
              <HelpTip :text="t('generate.basic.unet_seg_help')" />
            </div>
            <CheckpointSelector
              :selected="selectedHigh"
              :missing="missingOf(state.unetHigh)"
              :empty-label="t('generate.basic.select_unet_high')"
              :change-label="t('generate.basic.click_change')"
              :disabled="disabled"
              @open="openModelModal('high')"
            />
          </div>
          <div class="dual-slot">
            <div class="field-lbl">{{ t('generate.basic.unet_low') }}</div>
            <CheckpointSelector
              :selected="selectedLow"
              :missing="missingOf(state.unetLow)"
              :empty-label="t('generate.basic.select_unet_low')"
              :change-label="t('generate.basic.click_change')"
              :disabled="disabled"
              @open="openModelModal('low')"
            />
          </div>
        </template>
        <CheckpointSelector
          v-else
          :selected="selected"
          :missing="missingOf(modelField === 'unet' ? state.unet : state.checkpoint)"
          :empty-label="modelField === 'unet' ? t('generate.basic.select_unet') : t('generate.basic.select_checkpoint')"
          :change-label="t('generate.basic.click_change')"
          :disabled="disabled"
          @open="openModelModal()"
        />
      </div>

      <!-- Right: 视频 → VideoSettings / 图像 → Resolution + Steps/CFG -->
      <div class="basic-grid__params">
        <template v-if="isVideo">
          <VideoSettings
            :disabled="disabled"
            :ref-width="refWidth"
            :ref-height="refHeight"
          />
        </template>
        <template v-else>
          <div class="field-group">
            <div class="field-lbl">{{ t('generate.basic.resolution') }}</div>
            <div class="res-row">
              <BaseSelect
                :model-value="state.resolution"
                :options="resolutionPresets"
                :disabled="disabled"
                @update:model-value="state.resolution = String($event)"
              />
              <div v-if="isCustomRes" class="custom-size">
                <NumberInput
                  :model-value="state.width"
                  :min="64"
                  :max="4096"
                  :step="8"
                  :disabled="disabled"
                  :placeholder="t('generate.basic.width')"
                  center
                  @update:model-value="state.width = $event"
                />
                <span class="custom-size__x">×</span>
                <NumberInput
                  :model-value="state.height"
                  :min="64"
                  :max="4096"
                  :step="8"
                  :disabled="disabled"
                  :placeholder="t('generate.basic.height')"
                  center
                  @update:model-value="state.height = $event"
                />
              </div>
            </div>
          </div>

          <!-- Steps + CFG side by side -->
          <div class="slider-row">
            <RangeField
              :model-value="state.steps"
              :min="1"
              :max="100"
              :step="1"
              :label="t('generate.basic.steps')"
              :marks="2"
              editable
              :disabled="disabled"
              @update:model-value="state.steps = $event"
            />
            <RangeField
              :model-value="state.cfg"
              :min="1"
              :max="20"
              :step="0.5"
              :label="t('generate.basic.cfg_scale')"
              :marks="2"
              :value-format="(v: number) => v.toFixed(1)"
              editable
              :disabled="disabled"
              @update:model-value="state.cfg = $event"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.basic-settings {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  container: gen-basic / inline-size;
}

.basic-settings--disabled {
  opacity: .55;
  pointer-events: none;
}

.gen-s-hdr {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--t2);
}

.hdr-icon {
  font-size: .9rem;
  color: var(--t3);
}

/* ── 2-column: model | params ── */
.basic-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  align-items: stretch;
}

.basic-grid__model {
  display: flex;
  min-width: 0;
  min-height: 90px;
}

.basic-grid__model :deep(.ckpt-selector) {
  flex: 1;
}

.basic-grid__model :deep(.ckpt-empty),
.basic-grid__model :deep(.ckpt-card) {
  height: 100%;
  min-height: 0;
}

/* 双 UNet 双槽 — 纵向堆叠, 各槽自带标签 */
.basic-grid__model--dual {
  flex-direction: column;
  gap: var(--sp-2);
}

.dual-slot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
}

.dual-slot :deep(.ckpt-selector) {
  flex: 1;
  min-height: 56px;
}

/* 以 BasicSettings 自己的容器宽度决定是否将模型和参数上下排列。
   顶部工作区保持双栏时，控制列也可能只有约 450px，此时不能继续强行
   保持第二层双栏。 */
@container gen-basic (max-width: 600px) {
  .basic-grid {
    grid-template-columns: 1fr;
  }
}

.basic-grid__params {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* ── Field label ── */
.field-lbl {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
  margin-bottom: 4px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Resolution row ── */
.res-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-2);
  align-items: start;
}

/* ── Custom size row ── */
.custom-size {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 两个 input 等宽, 与 ×(固定字符宽) 一起自然填满容器剩余宽度 */
.custom-size :deep(.number-input) {
  flex: 1;
}

.custom-size__x {
  font-size: .78rem;
  color: var(--t3);
  flex-shrink: 0;
}

/* ── Slider row (Steps + CFG side by side) ── */
.slider-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

@container gen-basic (max-width: 480px) {
  .res-row {
    grid-template-columns: 1fr;
  }
  .slider-row {
    grid-template-columns: 1fr;
  }
}
</style>
