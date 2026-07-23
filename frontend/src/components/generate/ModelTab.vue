<script setup lang="ts">
import { computed, inject, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import { useControlNetOrchestration } from '@/composables/generate/useControlNetOrchestration'
import { useModelModalManager } from '@/composables/generate/useModelModalManager'
import { useComponentStatus } from '@/composables/generate/useComponentStatus'
import { MODEL_TYPES } from '@/config/model-types'
import { UPSCALE_MODEL_CONFIG, getCnDepConfig, type CnBranch } from '@/composables/generate/modelDepConfigs'
import type { ExecState } from '@/composables/useExecTracker'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import ModuleTabs from '@/components/generate/ModuleTabs.vue'
import PromptEditor from '@/components/generate/PromptEditor.vue'
import ActionBar from '@/components/generate/ActionBar.vue'
import BasicSettings from '@/components/generate/BasicSettings.vue'
import AdvancedSettings from '@/components/generate/AdvancedSettings.vue'
import PreviewArea from '@/components/generate/PreviewArea.vue'
import ModelPickerModal from '@/components/generate/ModelPickerModal.vue'
import ComponentPanel from '@/components/generate/ComponentPanel.vue'
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

defineOptions({ name: 'ModelTab' })

const props = defineProps<{
  modelType: string
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

const config = computed(() => MODEL_TYPES[props.modelType]!)
const isSplit = computed(() => config.value.loader === 'split')
const modelField = computed<'checkpoint' | 'unet'>(() => isSplit.value ? 'unet' : 'checkpoint')

// §5.1 包装形态: 该 tab 支持的形态列表 (supportedPackaging) + 当前选中项的实际形态
const supportedPackaging = computed(() => config.value.supportedPackaging)
const hasDualPackaging = computed(() => supportedPackaging.value.length > 1)

// 合并 picker items: 两形态并存时把 checkpoints + unets 合并, 每项带 packaging 字段
// (单形态时退化为只取对应列表, items 已自带 packaging 字段)
const mergedPickerItems = computed(() => {
  if (!hasDualPackaging.value) {
    return isSplit.value ? options.unets.value : options.checkpoints.value
  }
  // 两形态并存: 合并 (checkpoints 在前, unets 在后, 每项 packaging 字段已标注)
  // 注: useGenerateOptions 已为 checkpoints 标 packaging='checkpoint', unets 标 packaging='split'
  return [...options.checkpoints.value, ...options.unets.value]
})

// 当前选中模型的包装形态 (用于驱动 AdvancedSettings 的 split/clip-skip-vae 显示 + submit payload)
const selectedPackaging = computed<'checkpoint' | 'split'>(() => {
  if (!hasDualPackaging.value) {
    return isSplit.value ? 'split' : 'checkpoint'
  }
  // 两形态并存: 按选中文件所在目录判定 loader 形态 (ComfyUI 加载节点目录绑定 —
  // 拆分件在 diffusion_models/=unets 列表, 整合包在 checkpoints/ 列表)。onModelSelect
  // 互斥写 state.unet XOR state.checkpoint, 故三处 (此处 / onModelSelect / useGenerateSubmit) 一致。
  if (state.value.unet) return 'split'
  if (state.value.checkpoint) return 'checkpoint'
  // 无选中: 与 useGenerateSubmit.ts 一致 — 都为空时判 split (若该 tab 支持), 否则 checkpoint
  return supportedPackaging.value.includes('split') ? 'split' : 'checkpoint'
})

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
  modelType: props.modelType,
})

/** controlNetEnabled=false 时本地覆盖 moduleTabs (CN 三项 disabled + toast) */
const localModuleTabs = computed(() => [
  { key: 'lora', label: t('generate.modules.lora'), icon: 'extension' },
  { key: 'i2i', label: t('generate.modules.i2i'), icon: 'image' },
  {
    key: 'pose',
    label: t('generate.modules.pose'),
    icon: 'accessibility_new',
    disabled: true,
    title: t('generate.error.cn_disabled'),
  },
  {
    key: 'canny',
    label: t('generate.modules.canny'),
    icon: 'border_style',
    disabled: true,
    title: t('generate.error.cn_disabled'),
  },
  {
    key: 'depth',
    label: t('generate.modules.depth'),
    icon: 'layers',
    disabled: true,
    title: t('generate.error.cn_disabled'),
  },
  { key: 'upscale', label: t('generate.modules.upscale'), icon: 'hd' },
  { key: 'hires', label: t('generate.modules.hires'), icon: 'auto_fix_high' },
])

const localEnabledModules = computed(() => {
  const currentState = state.value
  const enabled = new Set<string>()
  if (currentState.loras.some((lora) => lora.enabled)) enabled.add('lora')
  if (currentState.i2i.enabled) enabled.add('i2i')
  if (currentState.upscale.enabled) enabled.add('upscale')
  if (currentState.hires.enabled) enabled.add('hires')
  return enabled
})

function onLocalModuleToggle(key: string, enabled: boolean) {
  // 阻止 controlnet 三项 toggle，其余转发给 CN orchestration
  if (key === 'pose' || key === 'canny' || key === 'depth') {
    toast(t('generate.error.cn_disabled'), 'warning')
    return
  }
  cnModuleToggle(key, enabled)
}

const effectiveModuleTabs = computed(() =>
  config.value.controlNetEnabled ? moduleTabs.value : localModuleTabs.value,
)
const effectiveEnabledModules = computed(() =>
  config.value.controlNetEnabled ? enabledModules.value : localEnabledModules.value,
)
function onEffectiveModuleToggle(key: string, enabled: boolean) {
  if (config.value.controlNetEnabled) {
    cnModuleToggle(key, enabled)
  } else {
    onLocalModuleToggle(key, enabled)
  }
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
  showModelPicker,
  modelSelected,
  openModelPicker,
  onModelSelect: _onModelSelect,
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
} = useModelModalManager({
  options,
  previewImages: toRef(props, 'previewImages'),
  prepareTagger,
  modelField: modelField.value,
})

// §5.3 合并 picker 模式: 两形态并存时, 按选中项的 packaging 字段决定写 checkpoint 还是 unet
function onModelSelect(name: string) {
  if (!hasDualPackaging.value) {
    _onModelSelect(name)
    return
  }
  // 两形态并存: 按选中文件所在目录 (在哪个列表) 决定 loader — ComfyUI 加载节点目录绑定,
  // 必须按目录选 (checkpoints/→CheckpointLoaderSimple, diffusion_models/→UNETLoader),
  // 不能只看检测出的 content 形态 (误放文件 content≠dir 时会崩)。互斥写, 清另一字段。
  // 不走 _onModelSelect: 其 modelField 快照对双形态 tab 恒为 'checkpoint', 会误写 state.checkpoint。
  const inCkptDir = options.checkpoints.value.some(m => m.name === name)
  if (inCkptDir) {
    state.value.checkpoint = name
    state.value.unet = ''
  } else {
    state.value.unet = name
    state.value.checkpoint = ''
  }
  showModelPicker.value = false
  toast(t('generate.toast.selected', { name: name.split('/').pop()!.replace(/\.[^.]+$/, '') }), 'success')
}

// §6.3 运行组件状态机: 替代旧 tab 级依赖机制 (后者读 welcome_state, dismiss 后永远空)。
// useComponentStatus 只发 /api/downloads/check, 绝不碰 welcome_state, 无 dismiss 概念。
// 它内部 watch arch 且 immediate 刷新, 无需手动调首次 refresh。
const compStatus = useComponentStatus(() => props.modelType, () => options.comfyuiDir.value)
const componentPanelExpanded = ref(false)

// 就绪状态回流 store (单一真值): 页面级重复预检已删, 菜单状态完全靠各 tab 写入, 故 immediate
watch(() => compStatus.ready.value, (ready, prev) => {
  store.setComponentsReady(props.modelType, ready)
  // 由"未就绪"翻转为"就绪" = 组件刚下载完 → 强制刷新 ComfyUI 选项列表。
  // 不刷新的话新下载的文本编码器/VAE 不会出现在高级设置的下拉里 (后端 options 带缓存),
  // 刷新后由 autofillDefaultModels 的 watch 自动填上官方组件。
  // prev === undefined 表示 immediate 首次执行 (挂载即就绪), 无需刷新。
  if (ready && prev === false) void options.refresh()
}, { immediate: true })

// 切到本 tab 时复检组件状态: 组件跨架构共享 (如 ae.safetensors 同时服务 Z-Image/Flux1/Chroma),
// 在别的 tab 下载完后, 本 tab 的状态与菜单标记会滞留为"未就绪", 切回来时需要复检。
watch(() => store.activeModelType, (active) => {
  if (active === props.modelType) void compStatus.refresh()
})

// A2: CN 依赖 Gate 配置按本 tab 的 cnBranch 取 (sdxl → union; ilnoob → 专用)
const _cnBranch = (MODEL_TYPES[props.modelType]?.cnBranch as CnBranch | undefined)
const cnDepPose = getCnDepConfig('pose', _cnBranch)
const cnDepCanny = getCnDepConfig('canny', _cnBranch)
const cnDepDepth = getCnDepConfig('depth', _cnBranch)

/** 高级设置 CLIP / VAE 自动填充: 仅当前激活 tab + split 形态 (selectedPackaging) + 字段为空时填充 */
function autofillDefaultModels() {
  if (store.activeModelType !== props.modelType) return
  if (selectedPackaging.value !== 'split' || !config.value.defaultModels) return

  const defs = config.value.defaultModels
  // CLIP
  if (!state.value.clip && defs.clip) {
    const found = options.clips.value.find(c => c.name === defs.clip || c.name.endsWith('/' + defs.clip))
    if (found) state.value.clip = found.name
  }
  // CLIP2 (DualCLIPLoader, flux1)
  if (!state.value.clip2 && defs.clip2) {
    const found = options.clips.value.find(c => c.name === defs.clip2 || c.name.endsWith('/' + defs.clip2))
    if (found) state.value.clip2 = found.name
  }
  // VAE
  if (!state.value.vae && defs.vae) {
    const found = options.vaes.value.find(v => v.name === defs.vae || v.name.endsWith('/' + defs.vae))
    if (found) state.value.vae = found.name
  }
}

watch([() => options.clips.value, () => options.vaes.value, () => store.activeModelType], autofillDefaultModels, { immediate: true })

// §6.3 生成前置校验: 条件不满足时"软禁用"主生成按钮, 点击弹 toast 说明原因。
// 返回空串 = 可以生成; 非空 = 禁用原因 (已翻译文案)。
const runBlockedReason = computed<string>(() => {
  const st = state.value
  const pkg = selectedPackaging.value

  // 1. 主模型未选择 (整合包看 checkpoint, 拆分看 unet)
  const modelPicked = pkg === 'split' ? !!st.unet : !!st.checkpoint
  if (!modelPicked) return t('generate.error.no_checkpoint')

  // 整合包自带全部组件, 到此即可
  if (pkg !== 'split') return ''

  // 2. 运行组件未下载 / 下载中 (ready 为假即涵盖两种)
  if (compStatus.hasComponents.value && !compStatus.ready.value) {
    return t('generate.error.components_not_ready')
  }

  // 3. CLIP / CLIP2 / VAE 未在高级设置中选定
  if (!st.clip || !st.vae || (config.value.dualClip && !st.clip2)) {
    return t('generate.error.no_split_models')
  }

  return ''
})

/** 用户点了软禁用的生成按钮 → toast 说明原因 */
function onRunBlocked(reason: string) {
  toast(reason, 'warning')
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
  <div class="model-tab">
    <!-- ═══ 上部: 双列布局 ═══ -->
    <div class="gen-top-row">
      <!-- 左列: 控制区 -->
      <div class="gen-ctrl-col">
        <!-- 提示词 -->
        <PromptEditor
          ref="promptEditorRef"
          :positive="state.positive"
          :negative="state.negative"
          :show-negative="config.hasNegativePrompt"
          :prompt-style="config.promptStyle"
          :model-type="modelType"
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
          :blocked-reason="runBlockedReason"
          @run="emit('run', $event)"
          @blocked="onRunBlocked"
          @stop="emit('stop')"
        />

        <hr class="gen-sep">

        <!-- 基础设置 -->
        <BasicSettings
          :model-field="modelField"
          @open-model="openModelPicker"
        />

        <!-- §6.3 运行组件内联面板 (三态: 就绪/缺失/下载中)。packaging=checkpoint 或无组件需求时自渲染为空 -->
        <ComponentPanel
          :arch="modelType"
          :status="compStatus"
          :packaging="selectedPackaging"
          v-model:expanded="componentPanelExpanded"
        />

        <!-- 高级设置 -->
        <!-- 高级设置: 显示源从静态 isSplit 改为 reactive selectedPackaging -->
        <AdvancedSettings
          :show-split-models="selectedPackaging === 'split'"
          :dual-clip="config.dualClip"
          :show-clip-skip-vae="selectedPackaging === 'checkpoint'"
        />
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
        :tabs="effectiveModuleTabs"
        :active-tab="state.activeModule"
        :enabled-tabs="effectiveEnabledModules"
        @update:active-tab="state.activeModule = $event ?? 'lora'"
        @toggle="onEffectiveModuleToggle"
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
          :title="cnDepPose.title"
          :min-optional="cnDepPose.minOptional"
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
          :title="cnDepCanny.title"
          :min-optional="cnDepCanny.minOptional"
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
          :title="cnDepDepth.title"
          :min-optional="cnDepDepth.minOptional"
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
      v-model="showModelPicker"
      :title="hasDualPackaging
        ? t('generate.basic.select_model')
        : (isSplit ? t('generate.basic.select_unet') : t('generate.basic.select_checkpoint'))"
      icon="deployed_code"
      :items="mergedPickerItems"
      :selected="modelSelected"
      :current-arch="config.pickerArch"
      :search-placeholder="hasDualPackaging
        ? t('generate.basic.search_model')
        : (isSplit ? t('generate.basic.search_unet') : t('generate.basic.search_checkpoint'))"
      :show-packaging-filter="hasDualPackaging"
      :components-missing="compStatus.hasComponents.value && !compStatus.ready.value"
      @select="onModelSelect"
    />

    <ModelPickerModal
      v-model="showLoraPicker"
      :title="t('generate.lora.select_title')"
      icon="extension"
      :items="options.loras.value"
      :multi="true"
      :selected="loraModalPending"
      :current-arch="config.pickerArch"
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

    <!-- ControlNet Ref Image Picker Modals (only when CN enabled) -->
    <RefImageModal
      v-if="config.controlNetEnabled"
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
      v-if="config.controlNetEnabled"
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
      v-if="config.controlNetEnabled"
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

    <!-- ControlNet Preprocess Modals (only when CN enabled) -->
    <PreprocessModal
      v-if="config.controlNetEnabled"
      v-model="showPPModal.pose"
      type="pose"
      @submit="onPPSubmit('pose', $event)"
    />
    <PreprocessModal
      v-if="config.controlNetEnabled"
      v-model="showPPModal.canny"
      type="canny"
      @submit="onPPSubmit('canny', $event)"
    />
    <PreprocessModal
      v-if="config.controlNetEnabled"
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
      :show-negative="config.hasNegativePrompt"
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
.model-tab {
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
