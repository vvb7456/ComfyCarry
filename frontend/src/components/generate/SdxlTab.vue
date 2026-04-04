<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import type { ExecState } from '@/composables/useExecTracker'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import ModuleTabs, { type SwitchTabItem } from '@/components/generate/ModuleTabs.vue'
import PromptEditor, { type ToolButton } from '@/components/generate/PromptEditor.vue'
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
import EmbeddingModal from '@/components/generate/EmbeddingModal.vue'
import RefImageModal from '@/components/generate/RefImageModal.vue'
import ModelMetaModal from '@/components/models/ModelMetaModal.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'
import type { ModelMeta, ModelMetaImage } from '@/types/models'
import { useImageToImage } from '@/composables/generate/useImageToImage'
import { useControlNet } from '@/composables/generate/useControlNet'
import { useModelDependency } from '@/composables/generate/useModelDependency'
import { useTagInterrogation, TAGGER_MODEL_CONFIG } from '@/composables/generate/useTagInterrogation'
import { useLlmAssist } from '@/composables/generate/useLlmAssist'
import { useEmbeddingPicker } from '@/composables/generate/useEmbeddingPicker'
import { CN_MODEL_CONFIGS, UPSCALE_MODEL_CONFIG } from '@/composables/generate/modelDepConfigs'
import { useToast } from '@/composables/useToast'

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
const { toast } = useToast()
const store = useGenerateStore()
const state = computed(() => store.currentState)
const options = inject(GenerateOptionsKey)!

/* ── I2I composable ── */
const i2i = useImageToImage()

/* ── ControlNet composables (one per type) ── */
const cnPose = useControlNet('pose', options.controlnetModels)
const cnCanny = useControlNet('canny', options.controlnetModels)
const cnDepth = useControlNet('depth', options.controlnetModels)
const cnMap = { pose: cnPose, canny: cnCanny, depth: cnDepth } as const

/* ── Model Dependency composables (one per CN type) ── */
const depPose = useModelDependency(CN_MODEL_CONFIGS.pose)
const depCanny = useModelDependency(CN_MODEL_CONFIGS.canny)
const depDepth = useModelDependency(CN_MODEL_CONFIGS.depth)
const depMap = { pose: depPose, canny: depCanny, depth: depDepth } as const

/* ── Upscale Model Dependency ── */
const depUpscale = useModelDependency(UPSCALE_MODEL_CONFIG)
let _upscaleReady = false

/* ── Tag Interrogation ── */
const tagger = useTagInterrogation()
const depTagger = useModelDependency(TAGGER_MODEL_CONFIG)
const _taggerReady = ref(false)
const showTaggerModal = ref(false)

/* ── LLM Assist ── */
const llm = useLlmAssist()
const showLlmModal = ref(false)

/* ── Embedding Picker ── */
const embPicker = useEmbeddingPicker()
const promptEditorRef = ref<InstanceType<typeof PromptEditor> | null>(null)

/* Preprocess modal visibility per CN type */
const showPPModal = ref({ pose: false, canny: false, depth: false })

/** Track expected output filename per CN preprocess (for auto-fill on done) */
const ppExpectedOutput: Record<string, string> = {}

async function onPPSubmit(cnType: 'pose' | 'canny' | 'depth', payload: { file: File | string; params: Record<string, unknown> }) {
  // Block preprocess if generation is actively running
  if (props.execState) {
    toast(t('generate.controlnet.preprocess_blocked'), 'warning')
    return
  }
  // Block if another preprocess is already running
  const anyRunning = Object.values(cnMap).some(cn => cn.preprocessStatus.value === 'running')
  if (anyRunning) {
    toast(t('generate.controlnet.preprocess_blocked'), 'warning')
    return
  }
  const promptId = await cnMap[cnType].submitPreprocess(payload.file, payload.params)
  if (promptId) {
    emit('register-task', promptId, 'preprocess', cnType)
  }
}

/** Called from GeneratePage when a preprocess task completes via SSE */
function handlePreprocessDone(cnType: string, success: boolean) {
  const cn = cnMap[cnType as keyof typeof cnMap]
  if (!cn) return
  // The output_filename is stored inside useControlNet's preprocessOutputFile
  cn.onPreprocessDone(success)
}

defineExpose({ handlePreprocessDone, handleTagDone })

// Check model dependency state when comfyuiDir becomes available
// Also runs on mount (immediate), passing empty string if ComfyUI not detected yet
let _depChecked = false
watch(() => options.comfyuiDir.value, (dir) => {
  if (!dir && _depChecked) return  // Skip only if we already ran check and dir is still empty
  _depChecked = true
  for (const type of ['pose', 'canny', 'depth'] as const) {
    depMap[type].check(dir).then(() => {
      // If already dismissed (show=false), mark CN ready
      if (!depMap[type].show.value) {
        cnMap[type].ready.value = true
      }
    })
  }
  // Upscale model dependency
  depUpscale.check(dir).then(() => {
    if (!depUpscale.show.value) _upscaleReady = true
  })
  // Tagger model dependency
  depTagger.check(dir).then(() => {
    if (!depTagger.show.value) _taggerReady.value = true
  })
}, { immediate: true })

function onDepEnter(type: 'pose' | 'canny' | 'depth') {
  cnMap[type].ready.value = true
  options.refresh()
}

function onUpscaleDepEnter() {
  _upscaleReady = true
  options.refresh()
}

function onDepDownload(type: 'pose' | 'canny' | 'depth') {
  const dir = options.comfyuiDir.value
  if (dir) depMap[type].startDownload(dir)
}

function onUpscaleDepDownload() {
  const dir = options.comfyuiDir.value
  if (dir) depUpscale.startDownload(dir)
}

/* ── Tag Interrogation ── */
function onTaggerDepEnter() {
  _taggerReady.value = true
  tagger.open()
}

function onTaggerDepDownload() {
  const dir = options.comfyuiDir.value
  if (dir) depTagger.startDownload(dir)
}

function openTagger() {
  if (_taggerReady.value) {
    tagger.open()
  }
  showTaggerModal.value = true
}

function onTaggerApply(tags: string) {
  if (tags) state.value.positive = tags
}

/** Watch tagger interrogation submit to register task */
watch(() => tagger.promptId.value, (pid) => {
  if (pid) emit('register-task', pid, 'tag', 'interrogate')
})

/** Called from GeneratePage when a tag interrogation task completes via SSE */
function handleTagDone(success: boolean) {
  tagger.onDone(success)
}

/* ── LLM Assist ── */
async function openLlm() {
  await llm.open()
  showLlmModal.value = true
}

function onLlmApply(result: { positive: string; negative?: string }) {
  state.value.positive = result.positive
  if (result.negative !== undefined) {
    state.value.negative = result.negative
  }
  toast(result.negative !== undefined ? t('generate.llm_modal.used_all') : t('generate.llm_modal.used'), 'success')
}

/* ── Embedding Insert ── */
function onEmbInsert(token: string, target: 'positive' | 'negative') {
  promptEditorRef.value?.insertAtCursor(target, token)
}

/* ── Prompt toolbar tool handler ── */
function onPromptTool(key: string) {
  switch (key) {
    case 'interrogate':
      openTagger()
      break
    case 'llm-assist':
      openLlm()
      break
    case 'embedding':
      embPicker.open()
      break
    // Future: wildcard
  }
}

onUnmounted(() => {
  depPose.destroy()
  depCanny.destroy()
  depDepth.destroy()
  depUpscale.destroy()
  depTagger.destroy()
  llm.close()
})

/* ── Preview image lightbox ── */
const previewOpen = ref(false)
const previewIndex = ref(0)
const previewUrls = computed(() => props.previewImages.map(img => img.url))

function onPreviewClick(url: string) {
  const idx = previewUrls.value.indexOf(url)
  previewIndex.value = idx >= 0 ? idx : 0
  previewOpen.value = true
}

/* ── Prompt toolbar buttons ── */
const promptTools = computed<ToolButton[]>(() => [
  { key: 'interrogate', icon: 'image_search', label: t('generate.prompt.tools.interrogate'), title: t('generate.prompt.tools.interrogate_title') },
  { key: 'llm-assist', icon: 'auto_awesome', label: t('generate.prompt.tools.llm_assist'), title: t('generate.prompt.tools.llm_assist_title') },
  { key: 'embedding', icon: 'link', label: t('generate.prompt.tools.embedding'), title: t('generate.prompt.tools.embedding_title') },
  { key: 'wildcard', icon: 'shuffle', label: t('generate.prompt.tools.wildcard'), title: t('generate.prompt.tools.wildcard_title') },
])

/* ── Module tabs ── */
const moduleTabs = computed<SwitchTabItem[]>(() => [
  { key: 'lora', label: t('generate.modules.lora'), icon: 'extension' },
  { key: 'i2i', label: t('generate.modules.i2i'), icon: 'image' },
  { key: 'pose', label: t('generate.modules.pose'), icon: 'accessibility_new' },
  { key: 'canny', label: t('generate.modules.canny'), icon: 'border_style' },
  { key: 'depth', label: t('generate.modules.depth'), icon: 'layers' },
  { key: 'upscale', label: t('generate.modules.upscale'), icon: 'hd' },
  { key: 'hires', label: t('generate.modules.hires'), icon: 'auto_fix_high' },
])

/* Derive enabled modules from store state */
const enabledModules = computed(() => {
  const s = state.value
  const enabled = new Set<string>()
  if (s.loras.some(l => l.enabled)) enabled.add('lora')
  if (s.i2i.enabled) enabled.add('i2i')
  if (s.controlNets.pose?.enabled) enabled.add('pose')
  if (s.controlNets.canny?.enabled) enabled.add('canny')
  if (s.controlNets.depth?.enabled) enabled.add('depth')
  if (s.upscale.enabled) enabled.add('upscale')
  if (s.hires.enabled) enabled.add('hires')
  return enabled
})

function onModuleToggle(key: string, enabled: boolean) {
  const s = state.value
  switch (key) {
    case 'lora':
      if (enabled && s.loras.length === 0) {
        toast(t('generate.lora.empty_warn'), 'warning')
        return
      }
      s.loras.forEach(l => { l.enabled = enabled })
      break
    case 'i2i':
      if (enabled && !s.i2i.image) {
        toast(t('generate.i2i.select_ref'), 'warning')
        return
      }
      s.i2i.enabled = enabled
      break
    case 'pose':
    case 'canny':
    case 'depth': {
      const cnKey = key as 'pose' | 'canny' | 'depth'
      const cn = cnMap[cnKey]
      if (enabled && !cn.validateEnable(cn.models.value)) {
        // Auto-switch to the CN tab so user sees the download gate
        if (!cn.ready.value) s.activeModule = cnKey
        return
      }
      if (s.controlNets[key]) s.controlNets[key].enabled = enabled
      break
    }
    case 'upscale':
      if (enabled && !_upscaleReady) {
        toast(t('generate.upscale.need_model'), 'warning')
        s.activeModule = 'upscale'
        return
      }
      s.upscale.enabled = enabled
      break
    case 'hires':
      s.hires.enabled = enabled
      break
  }
}

/* ── Checkpoint Picker ── */
const showCkptPicker = ref(false)
const ckptSelected = computed(() => new Set(state.value.checkpoint ? [state.value.checkpoint] : []))

function openCkptPicker() {
  // Refresh options in background (legacy: render first, then refresh)
  options.refresh()
  showCkptPicker.value = true
}

function onCkptSelect(name: string) {
  state.value.checkpoint = name
  showCkptPicker.value = false
  const displayName = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  toast(t('generate.toast.selected', { name: displayName.replace(/\.[^.]+$/, '') }), 'success')
}

/* ── LoRA Picker (confirm-based multi-select) ── */
const showLoraPicker = ref(false)
const loraModalPending = ref(new Set<string>())
const loraCountLabel = computed(() => t('generate.lora.count_selected', { count: loraModalPending.value.size }))

function openLoraPicker() {
  // Copy current selection to temp state (legacy: _loraModalPending = new Map(_loraSelected))
  loraModalPending.value = new Set(state.value.loras.map(l => l.name))
  options.refresh()
  showLoraPicker.value = true
}

function onLoraToggle(name: string) {
  const pending = new Set(loraModalPending.value)
  if (pending.has(name)) pending.delete(name)
  else pending.add(name)
  loraModalPending.value = pending
}

function onLoraConfirm() {
  const existing = new Map(state.value.loras.map(l => [l.name, l]))
  const newLoras = [...loraModalPending.value].map(name => {
    const prev = existing.get(name)
    return prev ? { ...prev } : { name, strength: 1.0, enabled: true }
  })
  state.value.loras = newLoras
  showLoraPicker.value = false
}

/* ── LoRA Detail Modal ── */
const showLoraDetail = ref(false)
const loraDetailMeta = ref<ModelMeta | null>(null)

function openLoraDetail(name: string) {
  const item = options.loras.value.find(l => l.name === name)
  if (!item) return
  const info = item.info as Record<string, unknown> | null

  // Build images array: local preview first, then CivitAI images
  const images: ModelMetaImage[] = []
  if (item.preview) {
    images.push({ url: `/api/local_models/preview?path=${encodeURIComponent(item.preview)}` })
  }
  const civitImages = info?.images as Array<Record<string, unknown>> | undefined
  if (civitImages) {
    for (const img of civitImages) {
      images.push({
        url: (img.url as string) || '',
        type: (img.type as string) || undefined,
        seed: img.seed as number | string | undefined,
        steps: img.steps as number | undefined,
        cfg: img.cfg as number | undefined,
        sampler: img.sampler as string | undefined,
        model: img.model as string | undefined,
        positive: img.positive as string | undefined,
        negative: img.negative as string | undefined,
      })
    }
  }

  const basename = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const civitId = info?.civitai_id as string | number | undefined
  loraDetailMeta.value = {
    name: (info?.name as string) || basename.replace(/\.[^.]+$/, ''),
    type: 'LORA',
    baseModel: (info?.baseModel as string) || undefined,
    id: civitId,
    versionId: (info?.versionId as string | number) || undefined,
    versionName: (info?.versionName as string) || undefined,
    sha256: (info?.sha256 as string) || undefined,
    filename: basename,
    civitaiUrl: civitId ? `https://civitai.com/models/${civitId}` : undefined,
    trainedWords: (info?.trainedWords as string[]) || undefined,
    images,
  }
  showLoraDetail.value = true
}
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

    <!-- ═══ 下部: 功能模块 ═══ -->
    <ModuleTabs
      :tabs="moduleTabs"
      :active-tab="state.activeModule"
      :enabled-tabs="enabledModules"
      @update:active-tab="state.activeModule = $event ?? 'lora'"
      @toggle="onModuleToggle"
    />

    <!-- 模块面板占位 -->
    <div v-show="state.activeModule === 'lora'" class="gen-module-panel">
      <LoraPanel @open-picker="openLoraPicker" @detail="openLoraDetail" />
    </div>
    <div v-show="state.activeModule === 'i2i'" class="gen-module-panel">
      <I2IPanel
        @pick="i2i.picker.open()"
        @file="i2i.handleUpload"
        @clear="i2i.clearImage"
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

    <!-- Embedding Modal -->
    <EmbeddingModal
      v-model="embPicker.visible.value"
      :picker="embPicker"
      @insert="onEmbInsert"
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

/* ═══ 下部: 模块面板 ═══ */
.gen-module-panel {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  min-height: 120px;
  margin-top: calc(-1 * var(--sp-2));
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
