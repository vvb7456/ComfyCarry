<script setup lang="ts">
import { computed, inject, provide, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateModelKey, GenerateOptionsKey } from '@/composables/generate/keys'
import { packagingOf } from '@/composables/generate/useGenerateOptions'
import { useControlNetOrchestration } from '@/composables/generate/useControlNetOrchestration'
import { CN_TYPES, PP_PARAMS_DEF } from '@/composables/generate/useControlNet'
import { useModelModalManager } from '@/composables/generate/useModelModalManager'
import { useDependencyStatus } from '@/composables/generate/useDependencyStatus'
import { componentDepRows } from '@/composables/generate/depRows'
import type { ExecState } from '@/composables/useExecTracker'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import ModuleTabs from '@/components/generate/ModuleTabs.vue'
import PromptEditor from '@/components/generate/PromptEditor.vue'
import ActionBar from '@/components/generate/ActionBar.vue'
import BasicSettings from '@/components/generate/BasicSettings.vue'
import AdvancedSettings from '@/components/generate/AdvancedSettings.vue'
import PreviewArea from '@/components/generate/PreviewArea.vue'
import ModelPickerModal from '@/components/generate/ModelPickerModal.vue'
import DependencyBar from '@/components/generate/DependencyBar.vue'
import LoraPanel from '@/components/generate/LoraPanel.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { IMAGE_ACCEPT, useRefImagePicker } from '@/composables/generate/useRefImagePicker'
import { COMPONENT_FILENAMES } from '@/config/component-registry'
import I2IPanel from '@/components/generate/I2IPanel.vue'
import ControlNetPanel from '@/components/generate/ControlNetPanel.vue'
import UpscalePanel from '@/components/generate/UpscalePanel.vue'
import HiResPanel from '@/components/generate/HiResPanel.vue'
import FaceDetailerPanel from '@/components/generate/FaceDetailerPanel.vue'
import PreprocessModal from '@/components/generate/PreprocessModal.vue'
import TaggerModal from '@/components/generate/TaggerModal.vue'
import LlmModal from '@/components/generate/LlmModal.vue'
import PromptEditorModal from '@/components/generate/PromptEditorModal.vue'
import RefImageModal from '@/components/generate/RefImageModal.vue'
import RefMediaPanel from '@/components/generate/RefMediaPanel.vue'
import MaskEditorModal from '@/components/generate/MaskEditorModal.vue'
import type { RefItem } from '@/stores/generate'
import LocalModelModal from '@/components/models/LocalModelModal.vue'
import ImagePreview from '@/components/ui/ImagePreview.vue'
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
  /** 冻结: 后台运行中整页只读, 绑在 .gen-ctrl-col / .gen-module-wrap 两个 div 上 */
  frozen?: boolean
}>()

const emit = defineEmits<{
  run: [mode: string]
  stop: []
  'register-task': [promptId: string, type: 'preprocess' | 'tag', subtype: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const store = useGenerateStore()
const state = computed(() => store.stateFor(props.modelType))
const options = inject(GenerateOptionsKey)!

const config = computed(() => store.configFor(props.modelType))
provide(GenerateModelKey, { modelType: props.modelType, state, config })
const isSplit = computed(() => config.value.loader === 'split')
const modelField = computed<'checkpoint' | 'unet'>(() => isSplit.value ? 'unet' : 'checkpoint')

// mediaType==='video' 为视频架构 (Wan 2.2 三条目); 图像架构 (媒体=image) 一字不变。
const isVideo = computed(() => config.value.mediaType === 'video')

// 起始画面原始尺寸 (派生展示数据, 不进 store): 由本文件的 loadRefSize 探测,
// 转手喂给 BasicSettings.refWidth/refHeight → VideoSettings「贴合起始画面」推导用。
const refSize = ref<{ width: number; height: number }>({ width: 0, height: 0 })

const showNegative = computed(() =>
  config.value.hasNegativePrompt,
)

const videoMode = computed(() => state.value.video?.mode ?? state.value.mode)

// 媒体栏随模式显示，开关放在不会随之消失的提示词标题行。
const showModeSwitch = computed(() => (config.value.videoModes ?? config.value.modes ?? []).length > 0)
const videoModeOptions = computed(() =>
  (config.value.videoModes ?? config.value.modes ?? []).map(m => ({
    value: m,
    label: t(m === 'i2v' || m === 't2v' ? `generate.video.mode_${m}` : `generate.mode.${m}`),
  })),
)
function onVideoModeChange(v: string) {
  store.setMode(v)
}

// 起始画面挂载判定 — 挂在提示词容器左栏 (PromptEditor 的 #media 槽):
//  - 条目内双模式 (wan22_5b/minimax_h3): 仅 i2v 模式渲染 (文生模式下左栏整块消失)
//  - 无 videoModes 的条目: 按 modelType 的 t2v 语义判断 (wan22_t2v = 纯文生不渲染,
//    wan22_i2v 等其余视频条目恒渲染)。原硬编码 'wan22_t2v' 判据由该语义泛化覆盖。
const showStartFrame = computed(() => {
  if (!isVideo.value) return false
  // Ref2VA 参考生成条目无起始画面 (左媒体栏让位给 RefMediaPanel)
  if (videoMode.value === 'ref') return false
  if (config.value.videoModes?.length) return videoMode.value === 'i2v'
  return !props.modelType.includes('t2v')
})

// 末帧挂载判定 (MiniMax H3 首尾帧): 仅 minimax_h3 且 i2v 模式时渲染。
// 其余架构恒 false (不渲染), 末帧是可选项, 不阻断生成。
const showLastFrame = computed(() => ['minimax_h3', 'wan22_i2v'].includes(props.modelType) && videoMode.value === 'i2v')

// 参考素材面板挂载判定 (MiniMax H3 Ref2VA): 左媒体栏渲染 RefMediaPanel,
// 与 showStartFrame 分支互斥 (两者不会同时渲染)。
const showRefPanel = computed(() => videoMode.value === 'ref')

// state.video 可能为 undefined (图像架构); 参考素材面板仅视频架构渲染,
// 这里用 computed getter/setter 包裹 v-model, 避免模板里直接解包 undefined。
const videoRefs = computed<RefItem[]>({
  get: () => state.value.video?.refs ?? state.value.refs,
  set: (v) => {
    if (state.value.video) state.value.video.refs = v
    else state.value.refs = v
  },
})

const videoPicker = useRefImagePicker('video_ref')

const startFrameName = computed(() => {
  const n = state.value.video?.refImage ?? ''
  if (!n) return undefined
  return n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
})
const startFramePreview = computed(() => {
  const n = state.value.video?.refImage
  if (!n) return undefined
  return `/api/generate/input_image_preview?name=${encodeURIComponent(n)}`
})

/** 起始画面原始像素尺寸 —— 「贴合起始画面」分辨率项的推导输入。
 *  派生展示数据, 不进 store; 取不到时归 0, 下游退化为档位预设。 */
function loadRefSize(name: string) {
  if (!name) {
    refSize.value = { width: 0, height: 0 }
    return
  }
  const img = new Image()
  img.onload = () => {
    refSize.value = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 }
  }
  img.onerror = () => { refSize.value = { width: 0, height: 0 } }
  img.src = `/api/generate/input_image_preview?name=${encodeURIComponent(name)}`
}

// refImage 任何来源的变化 (手动上传 / picker 选择 / 「生成视频」带入 / t2v 切回) 都要刷新尺寸
watch(() => isVideo.value ? state.value.video?.refImage ?? '' : state.value.refs[0]?.name ?? '',
  name => loadRefSize(name), { immediate: true })

function onStartFramePick(name: string) {
  if (state.value.video) {
    state.value.video.refImage = name
    state.value.video.resolution = 'ref'
  }
  videoPicker.close()
}
async function onStartFrameUpload(file: File) {
  const result = await videoPicker.uploadFile(file)
  if (!result) return
  if (state.value.video) {
    state.value.video.refImage = result.filename
    state.value.video.resolution = 'ref'
  }
  if (result.width && result.height) {
    refSize.value = { width: result.width, height: result.height }
  }
  toast(t('generate.i2i.uploaded'), 'success')
}
function onStartFrameClear() {
  if (state.value.video) {
    state.value.video.refImage = ''
    if (state.value.video.resolution === 'ref') state.value.video.resolution = 'custom'
  }
}

const lastFramePicker = useRefImagePicker('video_last_frame')

const lastFrameName = computed(() => {
  const n = state.value.video?.lastImage ?? ''
  if (!n) return undefined
  return n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
})
const lastFramePreview = computed(() => {
  const n = state.value.video?.lastImage
  if (!n) return undefined
  return `/api/generate/input_image_preview?name=${encodeURIComponent(n)}`
})

function onLastFramePick(name: string) {
  if (state.value.video) state.value.video.lastImage = name
  lastFramePicker.close()
}
async function onLastFrameUpload(file: File) {
  const result = await lastFramePicker.uploadFile(file)
  if (!result) return
  if (state.value.video) state.value.video.lastImage = result.filename
  toast(t('generate.i2i.uploaded'), 'success')
}
function onLastFrameClear() {
  if (state.value.video) state.value.video.lastImage = ''
}

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
// 调 useGenerateOptions 导出的 packagingOf helper, 与 useGenerateSubmit.resolvePackaging
// 共用同一判据 —— 两处若用不同判据, 脏数据下会分叉。
// name = state.checkpoint || state.unet; 未选时 name='' 不在 checkpoints 列表 → 'split'。
const selectedPackaging = computed<'checkpoint' | 'split'>(() =>
  packagingOf(state.value.checkpoint || state.value.unet, config.value, options.checkpoints.value.map(m => m.name)),
)

const {
  i2i,
  tagger,
  cnMap,
  depMap,
  preprocessDepMap,
  cnModelsReady,
  depUpscale,
  depTagger,
  depFace,
  upscaleVaeReady,
  showPPModal,
  moduleTabs,
  enabledModules,
  onModuleToggle,
  onPPSubmit,
  handlePreprocessDone,
  prepareTagger,
  handleTagDone,
} = useControlNetOrchestration({
  options,
  execState: toRef(props, 'execState'),
  onRegisterTask: (promptId, type, subtype) => emit('register-task', promptId, type, subtype),
  modelType: props.modelType,
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
  showModelPicker,
  modelSelected,
  openModelPicker,
  onModelSelect: _onModelSelect,
  showLoraPicker,
  loraModalPending,
  loraCountLabel,
  showLoraDetail,
  loraDetailModelId,
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
  modelType: props.modelType,
})

// 双 UNet 架构的槽位路由。picker 是同一个 (普通单选), 由这个 ref 记住当前是给哪个槽选。
// 高噪/低噪不可自动区分, 改为用户显式各选一次。
const pickerSlot = ref<'high' | 'low' | null>(null)

function openModelPickerFor(slot?: 'high' | 'low') {
  pickerSlot.value = slot ?? null
  openModelPicker()
}

// 合并 picker 模式: 两形态并存时, 按选中文件所在目录 (在哪个列表) 决定写 checkpoint 还是 unet —
// ComfyUI 加载节点目录绑定, 必须按目录选 (checkpoints/→CheckpointLoaderSimple,
// diffusion_models/→UNETLoader), 不能只看检测出的 content 形态 (误放文件 content≠dir 时会崩)。
// 双 UNet: 按 pickerSlot 写 unetHigh 或 unetLow。
// **不做任何预填/推荐** —— 高噪/低噪无法从文件本身区分, 靠文件名猜出来的建议是噪声。
// 两个槽都由用户显式各选一次, 面板不替他做判断。
function onModelSelect(name: string) {
  if (config.value.dualUnet && pickerSlot.value) {
    const slot = pickerSlot.value
    if (slot === 'high') state.value.unetHigh = name
    else state.value.unetLow = name
    state.value.unet = state.value.unetHigh || name
    showModelPicker.value = false
    pickerSlot.value = null
    toast(t('generate.msg.selected', { name: name.split('/').pop()!.replace(/\.[^.]+$/, '') }), 'success')
    return
  }

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
  toast(t('generate.msg.selected', { name: name.split('/').pop()!.replace(/\.[^.]+$/, '') }), 'success')
}

// 运行组件: 与 ControlNet/放大/面部/反推 用同一个依赖状态机, 唯一真相是磁盘。
// 清单随 fast 档位变化 (视频快速档要把 lightning 加速件计入必需集, 否则缺件会
// 误判为就绪), 引擎 watch 清单变化自动重判, 无需手动调首次 refresh。
const compStatus = useDependencyStatus(
  () => componentDepRows(config.value.runtimeKey!, { fast: state.value.fast, mode: videoMode.value }, t, selectedPackaging.value),
  {
    source: 'runtime-component',
    metaOf: () => ({ arch: props.modelType }),
  },
)
const componentPanelExpanded = ref(false)

// Lightning 加速件物理落在 loras/ 目录, 会混进 LoRA 添加入口的选择器。
// 视频架构下用同源 COMPONENT_FILENAMES 过滤, 不另立名单;
// 图像架构不过滤 (行为一字不变, 回归保护)。LoraPanel 内部卡片渲染已用同一集合过滤,
// 这里只管 picker 的 items 绑定。
const loraPickerItems = computed(() => {
  return options.loras.value.filter(l => {
    const bname = l.name.includes('/') ? l.name.slice(l.name.lastIndexOf('/') + 1) : l.name
    return !COMPONENT_FILENAMES.has(bname)
  })
})

// 就绪状态回流 store (单一真值): 页面级重复预检已删, 菜单状态完全靠各 tab 写入, 故 immediate
watch(() => compStatus.ready.value, (ready) => {
    store.setComponentsReady(props.modelType, ready)
}, { immediate: true })

// 切到本 tab 时复检组件状态: 组件跨架构共享 (如 ae.safetensors 同时服务 Z-Image/Flux1/Chroma),
// 在别的 tab 下载完后, 本 tab 的状态与菜单标记会滞留为"未就绪", 切回来时需要复检。
watch(() => store.activeModelType, (active) => {
  if (active === props.modelType) void compStatus.refresh()
})

// 视频架构「隐藏实时模式」: 视频任务无实时预览语义 (分钟级任务), live 模式无意义。
// ActionBar 已按 mediaType 过滤 runModes; 此处做状态层兜底: 视频架构下若 runMode
// 被切到 'live' (含历史持久化数据), 立即校正回 'normal', 防止以 live 提交。
watch(() => state.value.runMode, (mode) => {
  if (store.activeModelType !== props.modelType) return
  if (isVideo.value && mode === 'live') {
    state.value.runMode = 'normal'
  }
}, { immediate: true })

// 5B 模式字段兜底: store.createDefaultVideoState 未设 mode (store 层初始化缺口);
// 此处在消费侧补默认值, 保证 store.video.mode 与 UI/提交链一致。仅当前激活 tab +
// 视频架构 + 有 videoModes + video 存在但 mode 缺失时写一次 (同 autofillDefaultModels 风格)。
watch(() => [store.activeModelType, state.value.video] as const, () => {
  if (store.activeModelType !== props.modelType) return
  if (!isVideo.value) return
  const modes = config.value.videoModes
  if (!modes?.length) return
  const v = state.value.video
    if (v && !modes.includes(v.mode!)) {
    v.mode = modes[0]
  }
}, { immediate: true })

watch([() => store.activeModelType, moduleTabs], () => {
  if (store.activeModelType !== props.modelType) return
  if (!moduleTabs.value.some(tab => tab.key === state.value.activeModule && !tab.disabled)) {
    state.value.activeModule = 'lora'
  }
}, { immediate: true })

/** 各依赖状态条的称呼 (进"XX 已就绪 / 缺少 N 项 XX"文案) */
const depNouns = computed(() => ({
  upscale: t('generate.dep.noun_upscale'),
  face: t('generate.dep.noun_face'),
  components: t('generate.components.title'),
}))

/** 模块面板顶部状态条的展开态 (每模块各自记) */
const depExpanded = ref<Record<string, boolean>>({
  ...Object.fromEntries(CN_TYPES.map(type => [type, false])), upscale: false, face: false,
})

/** 高级设置 CLIP / VAE 自动填充: 仅当前激活 tab + split 形态 (selectedPackaging) + 字段为空时填充 */
function autofillDefaultModels() {
  if (store.activeModelType !== props.modelType) return
  if (selectedPackaging.value !== 'split' || !config.value.defaultModels) return

  const defs = config.value.defaultModels
  if (!state.value.clip && defs.clip) {
    const found = options.clips.value.find(c => c.name === defs.clip || c.name.endsWith('/' + defs.clip))
    if (found) state.value.clip = found.name
  }
  if (!state.value.clip2 && defs.clip2) {
    const found = options.clips.value.find(c => c.name === defs.clip2 || c.name.endsWith('/' + defs.clip2))
    if (found) state.value.clip2 = found.name
  }
  if (!state.value.vae && defs.vae) {
    const found = options.vaes.value.find(v => v.name === defs.vae || v.name.endsWith('/' + defs.vae))
    if (found) state.value.vae = found.name
  }
  if (!state.value.audioVae && defs.audioVae) {
    const found = options.vaes.value.find(v => v.name === defs.audioVae || v.name.endsWith('/' + defs.audioVae))
    if (found) state.value.audioVae = found.name
  }
}

watch([() => options.clips.value, () => options.vaes.value, () => store.activeModelType], autofillDefaultModels, { immediate: true })

// 生成前置校验: 条件不满足时"软禁用"主生成按钮, 点击弹 toast 说明原因。
// 返回空串 = 可以生成; 非空 = 禁用原因 (已翻译文案)。
const runBlockedReason = computed<string>(() => {
  const st = state.value
  const pkg = selectedPackaging.value

  // 双 UNet: 两个槽独立选择, 必须都填且互异 —— 只填一个是常见中间态, 要能说清缺什么
  if (config.value.dualUnet) {
    if (!st.unetHigh || !st.unetLow) return t('generate.error.no_unet_pair')
    if (st.unetHigh === st.unetLow) return t('generate.error.video_same_unet')
  } else {
    const modelPicked = pkg === 'split' ? !!st.unet : !!st.checkpoint
    if (!modelPicked) return t('generate.error.no_checkpoint')
  }

  if (showStartFrame.value && !st.video?.refImage
    && !(config.value.controlNetEnabled && Object.values(st.controlNets).some(cn => cn.enabled))) return t('generate.error.no_start_frame')

  // 1b'. Ref2VA 参考生成: 至少一个参考素材 (图/视频/音频均可) → 软禁用 + 点击 toast。
  //      音频不能作为唯一参考 (官方约束) → 同样软禁用。
  if (showRefPanel.value) {
    const refs = videoRefs.value
    if (!refs.length) return t('generate.error.minimax_h3_refs_required')
    if (isVideo.value && refs.every(r => r.type === 'audio')) return t('generate.error.minimax_h3_refs_audio_requires_visual')
  }

  // 1c. 模块已启用但依赖缺件。开关本身会拦, 但 enabled 是持久化的 —— 上次开着、
  // 这次模型被删/换了架构 (专用 CN 模型按 branch 分家) 都会留下开着却跑不了的状态。
  for (const cnKey of CN_TYPES) {
    if (config.value.controlNetEnabled && st.controlNets[cnKey]?.enabled && !cnModelsReady(cnKey)) {
      return t(`generate.controlnet.need_download_${cnKey}`)
    }
  }
  if (st.upscale.enabled && !depUpscale.ready.value) return t('generate.upscale.need_model')
  if (st.faceDetailer.enabled && !depFace.ready.value) return t('generate.face.need_model')

  if (compStatus.has.value && !compStatus.ready.value) {
    return t('generate.error.components_not_ready')
  }

  if (pkg !== 'split') return ''

  if (!st.clip || !st.vae || (config.value.dualClip && !st.clip2)) {
    return t('generate.error.no_split_models')
  }

  return ''
})

function onRunBlocked(reason: string) {
  toast(reason, 'warning')
}

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
    <div class="gen-top-row">
      <div class="gen-ctrl-col" :inert="frozen" :class="{ 'gen-frozen': frozen }">
        <PromptEditor
          :ref="(el) => { promptEditorRef = (el as { insertAtCursor: (t: 'positive' | 'negative', text: string) => void } | null) }"
          data-tour="gen-prompt"
          :positive="state.positive"
          :negative="state.negative"
          :show-negative="showNegative"
          :prompt-style="config.promptStyle"
          :model-type="config.runtimeKey ?? modelType"
          :tools="promptTools"
          @update:positive="state.positive = $event"
          @update:negative="state.negative = $event"
          @tool="onPromptTool"
        >
          <template v-if="showModeSwitch" #header-actions>
            <SegmentedControl
              :options="videoModeOptions"
              :model-value="videoMode"
              size="sm"
              :disabled="frozen"
              @update:model-value="onVideoModeChange(String($event))"
            />
          </template>

          <!-- 起始画面 — 与图生图参考图同一组件。
               H3 首尾帧: 首帧 | 提示词 | 尾帧 三栏 (尾帧走 media-right 槽) -->
          <template v-if="showStartFrame" #media>
            <p v-if="showLastFrame" class="model-tab__frame-lbl">{{ t('generate.video.start_frame') }}</p>
            <FileUploadZone
              mode="pick"
              :accept="IMAGE_ACCEPT"
              :preview="startFramePreview"
              :file-name="startFrameName"
              :pick-label="t('generate.i2i.pick_from_input')"
              :upload-label="t('generate.i2i.upload_local')"
              :disabled="frozen"
              @pick="videoPicker.open()"
              @file="onStartFrameUpload"
              @clear="onStartFrameClear"
              @error="toast($event, 'warning')"
            />
          </template>

          <!-- 参考素材 (MiniMax H3 Ref2VA) — 左媒体栏 (既有「左侧媒体」形态;
               面板内部滚动, 不撑高容器), 与起始画面互斥 -->
          <template v-if="showRefPanel" #media>
            <RefMediaPanel
              v-model:refs="videoRefs"
              :types="isVideo ? ['image', 'video', 'audio'] : ['image']"
              :limit="config.referenceLimit ?? 12"
              :h3-help="isVideo"
              :disabled="frozen"
            />
          </template>

          <template v-if="showLastFrame" #media-right>
            <p class="model-tab__frame-lbl">{{ t('generate.video.last_frame') }}</p>
            <FileUploadZone
              mode="pick"
              :accept="IMAGE_ACCEPT"
              :preview="lastFramePreview"
              :file-name="lastFrameName"
              :pick-label="t('generate.i2i.pick_from_input')"
              :upload-label="t('generate.i2i.upload_local')"
              :disabled="frozen"
              @pick="lastFramePicker.open()"
              @file="onLastFrameUpload"
              @clear="onLastFrameClear"
              @error="toast($event, 'warning')"
            />
          </template>
        </PromptEditor>

        <ActionBar
          data-tour="gen-run"
          :exec-state="execState"
          :elapsed="elapsed"
          :submitting="submitting"
          :blocked-reason="runBlockedReason"
          :frozen="frozen"
          @run="emit('run', $event)"
          @blocked="onRunBlocked"
          @stop="emit('stop')"
        />

        <hr class="gen-sep">

        <BasicSettings
          data-tour="gen-basic"
          :model-field="modelField"
          :ref-width="refSize.width"
          :ref-height="refSize.height"
          @open-model="openModelPickerFor"
        />

        <DependencyBar
          v-if="compStatus.has.value"
          :status="compStatus"
          :noun="depNouns.components"
          v-model:expanded="componentPanelExpanded"
        />

        <AdvancedSettings
          data-tour="gen-advanced"
          :show-split-models="selectedPackaging === 'split'"
          :dual-clip="config.dualClip"
          :show-clip-skip-vae="!!config.clipSkipSupport"
          :media-type="config.mediaType"
        />
      </div>

      <div class="gen-preview-col">
        <PreviewArea
          :images="previewImages"
          :loading="previewLoading"
          :current-preview="previewCurrent"
          :media-type="config.mediaType"
          :exec-state="execState"
          @click-image="onPreviewClick"
        />
      </div>
    </div>

    <div class="gen-module-wrap" data-tour="gen-modules" :inert="frozen" :class="{ 'gen-frozen': frozen }">
      <ModuleTabs
        :tabs="moduleTabs"
        :active-tab="state.activeModule"
        :enabled-tabs="enabledModules"
        @update:active-tab="state.activeModule = $event"
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
      <div v-for="type in config.controlNetEnabled ? CN_TYPES : []" :key="type" v-show="state.activeModule === type" class="gen-module-panel">
        <DependencyBar
          v-if="depMap[type].has.value"
          class="gen-module-dep"
          :status="depMap[type]"
          :noun="t(`generate.dep.noun_${type}`)"
          v-model:expanded="depExpanded[type]"
        />
        <ControlNetPanel
          :cn="cnMap[type]"
          @pick="cnMap[type].picker.open()"
          @file="cnMap[type].handleUpload"
          @clear="cnMap[type].clearImage"
          @open-preprocess="showPPModal[type] = true"
        />
      </div>
      <div v-show="state.activeModule === 'upscale'" class="gen-module-panel">
        <DependencyBar
          v-if="depUpscale.has.value"
          class="gen-module-dep"
          :status="depUpscale"
          :noun="depNouns.upscale"
          v-model:expanded="depExpanded.upscale"
        />
        <UpscalePanel :seedvr2-vae-ready="upscaleVaeReady" />
      </div>
      <div v-show="state.activeModule === 'hires'" class="gen-module-panel">
        <HiResPanel />
      </div>
      <div v-show="state.activeModule === 'face'" class="gen-module-panel">
        <DependencyBar
          v-if="depFace.has.value"
          class="gen-module-dep"
          :status="depFace"
          :noun="depNouns.face"
          v-model:expanded="depExpanded.face"
        />
        <FaceDetailerPanel />
      </div>
    </div>

    <ModelPickerModal
      v-model="showModelPicker"
      :title="hasDualPackaging
        ? t('generate.basic.select_model')
        : (isSplit ? t('generate.basic.select_unet') : t('generate.basic.select_checkpoint'))"
      icon="view_in_ar"
      :items="mergedPickerItems"
      :selected="modelSelected"
      :current-arch="config.pickerArch"
      :search-placeholder="hasDualPackaging
        ? t('generate.basic.search_model')
        : (isSplit ? t('generate.basic.search_unet') : t('generate.basic.search_checkpoint'))"
      :show-packaging-filter="hasDualPackaging"
      :components-missing="compStatus.has.value && !compStatus.ready.value"
      @select="onModelSelect"
    />

    <ModelPickerModal
      v-model="showLoraPicker"
      :title="t('generate.lora.select_title')"
      icon="layers"
      :items="loraPickerItems"
      :multi="true"
      :selected="loraModalPending"
      :current-arch="config.pickerArch"
      :search-placeholder="t('generate.lora.search_placeholder')"
      :count-label="loraCountLabel"
      @toggle="onLoraToggle"
      @confirm="onLoraConfirm"
    />

    <LocalModelModal
      v-model="showLoraDetail"
      :model-id="loraDetailModelId"
    />

    <RefImageModal
      v-if="isVideo"
      v-model="videoPicker.visible.value"
      :title="t('generate.video.start_frame')"
      icon="image"
      :images="videoPicker.images.value"
      :loading="videoPicker.loading.value"
      :uploading="videoPicker.uploading.value"
      :preview-url-fn="videoPicker.previewUrl"
      @select="onStartFramePick"
      @upload="onStartFrameUpload"
    />

    <RefImageModal
      v-if="showLastFrame"
      v-model="lastFramePicker.visible.value"
      :title="t('generate.video.last_frame')"
      icon="image"
      :images="lastFramePicker.images.value"
      :loading="lastFramePicker.loading.value"
      :uploading="lastFramePicker.uploading.value"
      :preview-url-fn="lastFramePicker.previewUrl"
      @select="onLastFramePick"
      @upload="onLastFrameUpload"
    />

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

    <template v-if="config.controlNetEnabled">
      <template v-for="type in CN_TYPES" :key="type">
        <RefImageModal
          v-model="cnMap[type].picker.visible.value"
          :title="t('generate.controlnet.select_title', { label: t(isVideo ? `generate.controlnet.video_${type}` : PP_PARAMS_DEF[type].titleKey) })"
          :media-type="isVideo ? 'video' : 'image'"
          :icon="PP_PARAMS_DEF[type].icon"
          :images="cnMap[type].picker.images.value"
          :loading="cnMap[type].picker.loading.value"
          :uploading="cnMap[type].picker.uploading.value"
          :preview-url-fn="cnMap[type].picker.previewUrl"
          @select="cnMap[type].handleSelect"
          @upload="cnMap[type].handleUpload"
        />
        <PreprocessModal
          v-if="type !== 'tile'"
          :model-value="!!showPPModal[type]"
          @update:model-value="showPPModal[type] = $event"
          :type="type"
          :video="isVideo"
          :dep="preprocessDepMap[type]"
          @submit="onPPSubmit(type, $event)"
        />
      </template>
    </template>

    <LlmModal
      v-model="showLlmModal"
      :llm="llm"
      @apply="onLlmApply"
    />

    <PromptEditorModal
      v-model="showPromptEditorModal"
      :positive="state.positive"
      :negative="state.negative"
      :show-negative="showNegative"
      :emb-picker="embPicker"
      :wc-manager="wcManager"
      @update:positive="state.positive = $event"
      @update:negative="state.negative = $event"
    />

    <TaggerModal
      v-model="showTaggerModal"
      :tagger="tagger"
      :dep="depTagger"
      @apply="onTaggerApply"
    />

    <ImagePreview v-model="previewOpen" :images="previewUrls" :initial-index="previewIndex" />
  </div>
</template>

<style scoped>
.model-tab {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  container: gen-model / inline-size;
}

.gen-top-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-4);
  align-items: stretch;
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

/* inert 本身无视觉表现, 冻结区半透明 + 禁止光标 */
.gen-frozen {
  opacity: .45;
  cursor: not-allowed;
}

.gen-sep {
  border: none;
  border-top: 1px solid var(--bd);
  margin: 0;
}

.gen-preview-col {
  position: relative;
  /* 宽度跟随网格列，避免单栏时由最小高度和宽高比反推宽度。 */
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gen-preview-col > :deep(*) {
  position: absolute;
  inset: 0;
}

/* 双栏要求控制区和预览区各自仍有可用宽度。这个判断基于 .model-tab 的实际
   内容区，能覆盖中等窗口下侧栏展开造成的窄内容区。放在基础规则之后，
   确保堆叠时预览列的最小高度不会被基础 min-height: 0 覆盖。 */
@container gen-model (max-width: 860px) {
  .gen-top-row { grid-template-columns: minmax(0, 1fr); }
  .gen-preview-col {
    min-height: 280px;
    max-height: 560px;
    aspect-ratio: 4 / 3;
  }
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
  color: var(--t2);
}

.gen-module-panel {
  padding: var(--sp-4);
  min-height: 120px;
}

/* 模块面板顶部的依赖状态条: 常驻一条, 不挡下面的面板内容。
   宽度与位置跟随下方内容容器 (各面板同为 --gen-module-w 居中), 不占满主容器。 */
.gen-module-dep {
  max-width: var(--gen-module-w);
  margin: 0 auto var(--sp-3);
}

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

/* ── 首/尾帧 (MiniMax H3 首尾帧) 媒体栏小标题: 与 .field-lbl 同款。
      纵向间距由 .prompt-media 的 gap 负责, 自身 margin 归零 ── */
.model-tab__frame-lbl {
  margin: 0;
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
}
</style>
