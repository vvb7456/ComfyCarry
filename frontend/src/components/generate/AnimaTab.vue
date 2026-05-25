<script setup lang="ts">
import { computed, inject, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import { useControlNetOrchestration } from '@/composables/generate/useControlNetOrchestration'
import { useAnimaModalManager } from '@/composables/generate/useAnimaModalManager'
import { useModelDependency } from '@/composables/generate/useModelDependency'
import { ANIMA_MODEL_CONFIG, CN_MODEL_CONFIGS, UPSCALE_MODEL_CONFIG } from '@/composables/generate/modelDepConfigs'
import type { ExecState } from '@/composables/useExecTracker'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import ModuleTabs from '@/components/generate/ModuleTabs.vue'
import PromptEditor from '@/components/generate/PromptEditor.vue'
import ActionBar from '@/components/generate/ActionBar.vue'
import AnimaBasicSettings from '@/components/generate/AnimaBasicSettings.vue'
import AdvancedSettings from '@/components/generate/AdvancedSettings.vue'
import PreviewArea from '@/components/generate/PreviewArea.vue'
import ModelPickerModal from '@/components/generate/ModelPickerModal.vue'
import LoraPanel from '@/components/generate/LoraPanel.vue'
import I2IPanel from '@/components/generate/I2IPanel.vue'
import ControlNetPanel from '@/components/generate/ControlNetPanel.vue'
import UpscalePanel from '@/components/generate/UpscalePanel.vue'
import HiResPanel from '@/components/generate/HiResPanel.vue'
import ModelDependencyGate from '@/components/generate/ModelDependencyGate.vue'
import PreprocessModal from '@/components/generate/PreprocessModal.vue'
import TaggerModal from '@/components/generate/TaggerModal.vue'
import LlmModal from '@/components/generate/LlmModal.vue'
import PromptEditorModal from '@/components/generate/PromptEditorModal.vue'
import RefImageModal from '@/components/generate/RefImageModal.vue'
import MaskEditorModal from '@/components/generate/MaskEditorModal.vue'
import ModelMetaModal from '@/components/models/ModelMetaModal.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'
import { TAGGER_MODEL_CONFIG } from '@/composables/generate/useTagInterrogation'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AnimaTab' })

const props = defineProps<{
  execState: ExecState | null
  elapsed: number
  submitting: boolean
  previewImages: PreviewImage[]
  previewLoading: boolean
  previewCurrent: string | null
}>()

const emit = defineEmits<{
  run: [mode: string]
  stop: []
  'register-task': [promptId: string, type: 'preprocess' | 'tag', subtype: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const store = useGenerateStore()
const state = computed(() => store.currentState)
const options = inject(GenerateOptionsKey)!

const {
  i2i,
  tagger,
  _taggerReady,
  cnPose,
  cnCanny,
  cnDepth,
  depPose,
  depCanny,
  depDepth,
  depUpscale,
  depTagger,
  showPPModal,
  onModuleToggle: cnModuleToggle,
  onPPSubmit,
  handlePreprocessDone,
  onDepEnter,
  onUpscaleDepEnter,
  onDepDownload,
  onUpscaleDepDownload,
  onTaggerDepEnter,
  onTaggerDepDownload,
  prepareTagger,
  handleTagDone,
} = useControlNetOrchestration({
  options,
  execState: toRef(props, 'execState'),
  onRegisterTask: (promptId, type, subtype) => emit('register-task', promptId, type, subtype),
})

/** Anima 专属模块 tabs — ControlNet 三项 disabled (Anima 暂无 CN 生态) */
const moduleTabs = computed(() => [
  { key: 'lora', label: t('generate.modules.lora'), icon: 'extension' },
  { key: 'i2i', label: t('generate.modules.i2i'), icon: 'image' },
  {
    key: 'pose',
    label: t('generate.modules.pose'),
    icon: 'accessibility_new',
    disabled: true,
    title: t('generate.error.cn_disabled_anima'),
  },
  {
    key: 'canny',
    label: t('generate.modules.canny'),
    icon: 'border_style',
    disabled: true,
    title: t('generate.error.cn_disabled_anima'),
  },
  {
    key: 'depth',
    label: t('generate.modules.depth'),
    icon: 'layers',
    disabled: true,
    title: t('generate.error.cn_disabled_anima'),
  },
  { key: 'upscale', label: t('generate.modules.upscale'), icon: 'hd' },
  { key: 'hires', label: t('generate.modules.hires'), icon: 'auto_fix_high' },
])

const enabledModules = computed(() => {
  const currentState = state.value
  const enabled = new Set<string>()
  if (currentState.loras.some((lora) => lora.enabled)) enabled.add('lora')
  if (currentState.i2i.enabled) enabled.add('i2i')
  if (currentState.upscale.enabled) enabled.add('upscale')
  if (currentState.hires.enabled) enabled.add('hires')
  return enabled
})

function onModuleToggle(key: string, enabled: boolean) {
  // 阻止 controlnet 三项 toggle，其余转发给 CN orchestration (它能正确处理 lora/i2i/upscale/hires)
  if (key === 'pose' || key === 'canny' || key === 'depth') {
    toast(t('generate.error.cn_disabled_anima'), 'warning')
    return
  }
  cnModuleToggle(key, enabled)
}

const {
  llm,
  embPicker,
  wcManager,
  promptEditorRef,
  showTaggerModal,
  showLlmModal,
  showPromptEditorModal,
  previewOpen,
  previewIndex,
  previewUrls,
  promptTools,
  showUnetPicker,
  unetSelected,
  openUnetPicker,
  onUnetSelect,
  showLoraPicker,
  loraModalPending,
  loraCountLabel,
  showLoraDetail,
  loraDetailMeta,
  onPreviewClick,
  onPromptTool,
  onTaggerApply,
  onLlmApply,
  openLoraPicker,
  onLoraToggle,
  onLoraConfirm,
  openLoraDetail,
} = useAnimaModalManager({
  options,
  previewImages: toRef(props, 'previewImages'),
  prepareTagger,
})

/** Anima tab-级依赖 Gate：CLIP + VAE 不齐时遮盖整个 tab */
const depAnima = useModelDependency(ANIMA_MODEL_CONFIG)

watch(() => options.comfyuiDir.value, (dir) => {
  if (!dir) return
  depAnima.check(dir)
}, { immediate: true })

function onAnimaDepEnter() {
  options.refresh()
}
function onAnimaDepDownload() {
  const dir = options.comfyuiDir.value
  if (dir) depAnima.startDownload(dir)
}

/** Mask editor: image/mask preview URLs */
const maskEditorImageUrl = computed(() => {
  const img = state.value.i2i.image
  if (!img) return ''
  return `/api/generate/input_image_preview?name=${encodeURIComponent(img)}`
})
const maskEditorMaskUrl = computed(() => {
  const mask = state.value.i2i.mask
  if (!mask) return null
  return `/api/generate/input_image_preview?name=${encodeURIComponent(mask)}`
})
async function onMaskApply(blob: Blob) {
  await i2i.uploadMask(blob)
}

defineExpose({ handlePreprocessDone, handleTagDone })
</script>

<template>
  <div class="anima-tab">
    <!-- ═══ Tab级 Gate： Anima CLIP+VAE 未备时遮盖整个 tab ═══ -->
    <ModelDependencyGate
      v-if="depAnima.show.value"
      :dep="depAnima"
      :title="t(ANIMA_MODEL_CONFIG.title)"
      :min-optional="ANIMA_MODEL_CONFIG.minOptional"
      @enter="onAnimaDepEnter"
      @download="onAnimaDepDownload"
    />

    <!-- ═══ 上部: 双列布局 ═══ -->
    <div v-if="!depAnima.show.value" class="gen-top-row">
      <!-- 左列: 控制区 -->
      <div class="gen-ctrl-col">
        <PromptEditor
          ref="promptEditorRef"
          :positive="state.positive"
          :negative="state.negative"
          :show-negative="true"
          :tools="promptTools"
          @update:positive="state.positive = $event"
          @update:negative="state.negative = $event"
          @tool="onPromptTool"
        />

        <ActionBar
          :exec-state="execState"
          :elapsed="elapsed"
          :submitting="submitting"
          @run="emit('run', $event)"
          @stop="emit('stop')"
        />

        <hr class="gen-sep">

        <AnimaBasicSettings
          @open-unet="openUnetPicker"
        />

        <AdvancedSettings show-split-models />
      </div>

      <!-- 右列: 预览区 -->
      <div class="gen-preview-col">
        <PreviewArea
          :images="previewImages"
          :loading="previewLoading"
          :current-preview="previewCurrent"
          @click-image="onPreviewClick"
        />
      </div>
    </div>

    <!-- ═══ 下部: 功能模块 ═══ -->
    <div v-if="!depAnima.show.value" class="gen-module-wrap">
      <ModuleTabs
        :tabs="moduleTabs"
        :active-tab="state.activeModule"
        :enabled-tabs="enabledModules"
        @update:active-tab="state.activeModule = $event ?? 'lora'"
        @toggle="onModuleToggle"
      />

      <div v-show="state.activeModule === 'lora'" class="gen-module-panel">
        <LoraPanel @open-picker="openLoraPicker" @detail="openLoraDetail" />
      </div>
      <div v-show="state.activeModule === 'i2i'" class="gen-module-panel">
        <I2IPanel
          @pick="i2i.picker.open()"
          @file="i2i.handleUpload"
          @clear="i2i.clearImage"
          @mask-edit="i2i.openMaskEditor"
        />
      </div>
      <!-- ControlNet 三项保留 panel 标记 (disabled 状态下 tab 不会激活，仅占位防止误切换) -->
      <div v-show="state.activeModule === 'pose'" class="gen-module-panel">
        <ModelDependencyGate
          v-if="depPose.show.value"
          :dep="depPose"
          :title="CN_MODEL_CONFIGS.pose.title"
          :min-optional="CN_MODEL_CONFIGS.pose.minOptional"
          @enter="onDepEnter('pose')"
          @download="onDepDownload('pose')"
        />
        <ControlNetPanel
          v-else
          :cn="cnPose"
          @pick="cnPose.picker.open()"
          @clear="cnPose.clearImage"
          @open-preprocess="showPPModal.pose = true"
        />
      </div>
      <div v-show="state.activeModule === 'canny'" class="gen-module-panel">
        <ModelDependencyGate
          v-if="depCanny.show.value"
          :dep="depCanny"
          :title="CN_MODEL_CONFIGS.canny.title"
          :min-optional="CN_MODEL_CONFIGS.canny.minOptional"
          @enter="onDepEnter('canny')"
          @download="onDepDownload('canny')"
        />
        <ControlNetPanel
          v-else
          :cn="cnCanny"
          @pick="cnCanny.picker.open()"
          @clear="cnCanny.clearImage"
          @open-preprocess="showPPModal.canny = true"
        />
      </div>
      <div v-show="state.activeModule === 'depth'" class="gen-module-panel">
        <ModelDependencyGate
          v-if="depDepth.show.value"
          :dep="depDepth"
          :title="CN_MODEL_CONFIGS.depth.title"
          :min-optional="CN_MODEL_CONFIGS.depth.minOptional"
          @enter="onDepEnter('depth')"
          @download="onDepDownload('depth')"
        />
        <ControlNetPanel
          v-else
          :cn="cnDepth"
          @pick="cnDepth.picker.open()"
          @clear="cnDepth.clearImage"
          @open-preprocess="showPPModal.depth = true"
        />
      </div>
      <div v-show="state.activeModule === 'upscale'" class="gen-module-panel">
        <ModelDependencyGate
          v-if="depUpscale.show.value"
          :dep="depUpscale"
          :title="UPSCALE_MODEL_CONFIG.title"
          @enter="onUpscaleDepEnter"
          @download="onUpscaleDepDownload"
        />
        <UpscalePanel v-else />
      </div>
      <div v-show="state.activeModule === 'hires'" class="gen-module-panel">
        <HiResPanel />
      </div>
    </div>

    <!-- ═══ Picker Modals ═══ -->
    <ModelPickerModal
      v-model="showUnetPicker"
      :title="t('generate.basic.select_unet')"
      icon="deployed_code"
      :items="options.unets.value"
      :selected="unetSelected"
      :search-placeholder="t('generate.basic.search_unet')"
      @select="onUnetSelect"
    />

    <ModelPickerModal
      v-model="showLoraPicker"
      :title="t('generate.lora.select_title')"
      icon="extension"
      :items="options.loras.value"
      :multi="true"
      :selected="loraModalPending"
      :search-placeholder="t('generate.lora.search_placeholder')"
      :count-label="loraCountLabel"
      @toggle="onLoraToggle"
      @confirm="onLoraConfirm"
    />

    <ModelMetaModal v-model="showLoraDetail" :meta="loraDetailMeta" />

    <RefImageModal
      v-model="i2i.picker.visible.value"
      :title="t('generate.i2i.ref_image')"
      icon="image"
      :images="i2i.picker.images.value"
      :loading="i2i.picker.loading.value"
      :uploading="i2i.picker.uploading.value"
      :preview-url-fn="i2i.picker.previewUrl"
      @select="i2i.handleSelect"
      @upload="i2i.handleUpload"
    />

    <MaskEditorModal
      v-model="i2i.maskEditorVisible.value"
      :image-url="maskEditorImageUrl"
      :mask-url="maskEditorMaskUrl"
      :on-apply-mask="onMaskApply"
      :on-clear-mask="() => i2i.clearMask()"
    />

    <LlmModal v-model="showLlmModal" :llm="llm" @apply="onLlmApply" />

    <PromptEditorModal
      v-model="showPromptEditorModal"
      :positive="state.positive"
      :negative="state.negative"
      :emb-picker="embPicker"
      :wc-manager="wcManager"
      @update:positive="state.positive = $event"
      @update:negative="state.negative = $event"
    />

    <TaggerModal
      v-model="showTaggerModal"
      :tagger="tagger"
      :ready="_taggerReady"
      :dep="depTagger"
      :dep-title="TAGGER_MODEL_CONFIG.title"
      :dep-min-optional="TAGGER_MODEL_CONFIG.minOptional"
      @apply="onTaggerApply"
      @dep-enter="onTaggerDepEnter"
      @dep-download="onTaggerDepDownload"
    />

    <ImagePreview v-model="previewOpen" :images="previewUrls" :initial-index="previewIndex" />
  </div>
</template>

<style scoped>
.anima-tab {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.gen-top-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
  align-items: stretch;
}
@media (max-width: 900px) {
  .gen-top-row { grid-template-columns: 1fr; }
}

.gen-ctrl-col {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
}

.gen-sep {
  border: none;
  border-top: 1px solid var(--bd);
  margin: 0;
}

.gen-preview-col {
  position: relative;
  min-height: 0;
  overflow: hidden;
}
.gen-preview-col > :deep(*) {
  position: absolute;
  inset: 0;
}

.gen-module-wrap {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
}

.gen-module-wrap :deep(.switch-tabs) {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  padding-bottom: 0;
  background: var(--bg3);
  border-bottom: 1px solid var(--bd);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  position: relative;
}

.gen-module-wrap :deep(.switch-tab) {
  position: relative;
  margin-bottom: -1px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.gen-module-wrap :deep(.switch-tab:not(.active)) {
  background: transparent;
  border-color: transparent;
  color: var(--t3);
}
.gen-module-wrap :deep(.switch-tab:not(.active):hover:not(.disabled)) {
  background: color-mix(in srgb, var(--bg2) 50%, transparent);
  color: var(--t2);
}

.gen-module-wrap :deep(.switch-tab.active) {
  background: var(--bg2);
  border-color: var(--bd);
  border-bottom-color: var(--bg2);
  color: var(--ac);
  z-index: 1;
}

.gen-module-wrap :deep(.switch-tab.enabled) {
  background: color-mix(in srgb, var(--ac) 6%, transparent);
  border-color: transparent;
}

.gen-module-panel {
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
}
</style>
