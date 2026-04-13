<script setup lang="ts">
import { computed, inject, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import { useControlNetOrchestration } from '@/composables/generate/useControlNetOrchestration'
import { useSdxlModalManager } from '@/composables/generate/useSdxlModalManager'
import type { ExecState } from '@/composables/useExecTracker'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import ModuleTabs from '@/components/generate/ModuleTabs.vue'
import PromptEditor from '@/components/generate/PromptEditor.vue'
import ActionBar from '@/components/generate/ActionBar.vue'
import BasicSettings from '@/components/generate/BasicSettings.vue'
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
import { CN_MODEL_CONFIGS, UPSCALE_MODEL_CONFIG } from '@/composables/generate/modelDepConfigs'

defineOptions({ name: 'SdxlTab' })

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
  moduleTabs,
  enabledModules,
  onModuleToggle,
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
  showCkptPicker,
  ckptSelected,
  showLoraPicker,
  loraModalPending,
  loraCountLabel,
  showLoraDetail,
  loraDetailMeta,
  onPreviewClick,
  onPromptTool,
  onTaggerApply,
  onLlmApply,
  openCkptPicker,
  onCkptSelect,
  openLoraPicker,
  onLoraToggle,
  onLoraConfirm,
  openLoraDetail,
} = useSdxlModalManager({
  options,
  previewImages: toRef(props, 'previewImages'),
  prepareTagger,
})

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
  <div class="sdxl-tab">
    <!-- ═══ 上部: 双列布局 ═══ -->
    <div class="gen-top-row">
      <!-- 左列: 控制区 -->
      <div class="gen-ctrl-col">
        <!-- 提示词 -->
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

        <!-- 操作栏 -->
        <ActionBar
          :exec-state="execState"
          :elapsed="elapsed"
          :submitting="submitting"
          @run="emit('run', $event)"
          @stop="emit('stop')"
        />

        <hr class="gen-sep">

        <!-- 基础设置 -->
        <BasicSettings @open-checkpoint="openCkptPicker" />

        <!-- 高级设置 -->
        <AdvancedSettings />
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

    <!-- ═══ 下部: 功能模块 (Tab + Panel 融合卡片) ═══ -->
    <div class="gen-module-wrap">
      <ModuleTabs
        :tabs="moduleTabs"
        :active-tab="state.activeModule"
        :enabled-tabs="enabledModules"
        @update:active-tab="state.activeModule = $event ?? 'lora'"
        @toggle="onModuleToggle"
      />

      <!-- 模块面板 -->
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

    <!-- ═══ Picker Modals (Teleport to body) ═══ -->
    <ModelPickerModal
      v-model="showCkptPicker"
      :title="t('generate.basic.select_checkpoint')"
      icon="deployed_code"
      :items="options.checkpoints.value"
      :selected="ckptSelected"
      :search-placeholder="t('generate.basic.search_checkpoint')"
      @select="onCkptSelect"
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

    <!-- LoRA Detail Modal -->
    <ModelMetaModal
      v-model="showLoraDetail"
      :meta="loraDetailMeta"
    />

    <!-- I2I Ref Image Picker Modal -->
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

    <!-- Mask Editor Modal -->
    <MaskEditorModal
      v-model="i2i.maskEditorVisible.value"
      :image-url="maskEditorImageUrl"
      :mask-url="maskEditorMaskUrl"
      :on-apply-mask="onMaskApply"
      :on-clear-mask="() => i2i.clearMask()"
    />

    <!-- ControlNet Ref Image Picker Modals -->
    <RefImageModal
      v-model="cnPose.picker.visible.value"
      :title="t('generate.controlnet.select_title', { label: t('generate.controlnet.bone_map') })"
      icon="accessibility_new"
      :images="cnPose.picker.images.value"
      :loading="cnPose.picker.loading.value"
      :uploading="cnPose.picker.uploading.value"
      :preview-url-fn="cnPose.picker.previewUrl"
      @select="cnPose.handleSelect"
      @upload="cnPose.handleUpload"
    />
    <RefImageModal
      v-model="cnCanny.picker.visible.value"
      :title="t('generate.controlnet.select_title', { label: t('generate.controlnet.edge_map') })"
      icon="border_style"
      :images="cnCanny.picker.images.value"
      :loading="cnCanny.picker.loading.value"
      :uploading="cnCanny.picker.uploading.value"
      :preview-url-fn="cnCanny.picker.previewUrl"
      @select="cnCanny.handleSelect"
      @upload="cnCanny.handleUpload"
    />
    <RefImageModal
      v-model="cnDepth.picker.visible.value"
      :title="t('generate.controlnet.select_title', { label: t('generate.controlnet.depth_map') })"
      icon="layers"
      :images="cnDepth.picker.images.value"
      :loading="cnDepth.picker.loading.value"
      :uploading="cnDepth.picker.uploading.value"
      :preview-url-fn="cnDepth.picker.previewUrl"
      @select="cnDepth.handleSelect"
      @upload="cnDepth.handleUpload"
    />

    <!-- ControlNet Preprocess Modals -->
    <PreprocessModal
      v-model="showPPModal.pose"
      type="pose"
      @submit="onPPSubmit('pose', $event)"
    />
    <PreprocessModal
      v-model="showPPModal.canny"
      type="canny"
      @submit="onPPSubmit('canny', $event)"
    />
    <PreprocessModal
      v-model="showPPModal.depth"
      type="depth"
      @submit="onPPSubmit('depth', $event)"
    />

    <!-- LLM Assist Modal -->
    <LlmModal
      v-model="showLlmModal"
      :llm="llm"
      @apply="onLlmApply"
    />

    <!-- Prompt Editor Modal -->
    <PromptEditorModal
      v-model="showPromptEditorModal"
      :positive="state.positive"
      :negative="state.negative"
      :emb-picker="embPicker"
      :wc-manager="wcManager"
      @update:positive="state.positive = $event"
      @update:negative="state.negative = $event"
    />

    <!-- Tagger Modal (handles gate internally when not ready) -->
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

    <!-- Preview lightbox -->
    <ImagePreview v-model="previewOpen" :images="previewUrls" :initial-index="previewIndex" />
  </div>
</template>

<style scoped>
.sdxl-tab {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

/* ═══ 上部: 双列网格 ═══ */
.gen-top-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
  align-items: stretch;
}
@media (max-width: 900px) {
  .gen-top-row { grid-template-columns: 1fr; }
}

/* ── 左列 ── */
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

/* ── 右列: 预览 ── */
.gen-preview-col {
  position: relative;
  min-height: 0;
  overflow: hidden;
}
.gen-preview-col > :deep(*) {
  position: absolute;
  inset: 0;
}

/* ═══ 下部: 模块容器 (Tab + Panel 融合) ═══ */
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

/* 所有 Tab 按钮与分割线重叠 (-1px) */
.gen-module-wrap :deep(.switch-tab) {
  position: relative;
  margin-bottom: -1px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

/* 非激活 Tab: 退后层, 半透明 + 无底部 border */
.gen-module-wrap :deep(.switch-tab:not(.active)) {
  background: transparent;
  border-color: transparent;
  color: var(--t3);
}
.gen-module-wrap :deep(.switch-tab:not(.active):hover:not(.disabled)) {
  background: color-mix(in srgb, var(--bg2) 50%, transparent);
  color: var(--t2);
}

/* 激活 Tab: 弹出, 与内容区背景一致, 底部 border 断开 */
.gen-module-wrap :deep(.switch-tab.active) {
  background: var(--bg2);
  border-color: var(--bd);
  border-bottom-color: var(--bg2);
  color: var(--ac);
  z-index: 1;
}

/* 启用但非激活 Tab: 微弱高亮 */
.gen-module-wrap :deep(.switch-tab.enabled) {
  background: color-mix(in srgb, var(--ac) 6%, transparent);
  border-color: transparent;
  color: var(--t2);
}

.gen-module-panel {
  padding: var(--sp-4);
  min-height: 120px;
}

/* ── 通用占位 ── */
.gen-placeholder {
  background: var(--bg3);
  border: 1px dashed var(--bd);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  text-align: center;
  font-size: .82rem;
  color: var(--t3);
}
.gen-placeholder--sm { padding: var(--sp-2) var(--sp-3); }
</style>
