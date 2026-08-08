<script setup lang="ts">
import { computed, inject, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import { packagingOf } from '@/composables/generate/useGenerateOptions'
import { useControlNetOrchestration } from '@/composables/generate/useControlNetOrchestration'
import { useModelModalManager } from '@/composables/generate/useModelModalManager'
import { useDependencyStatus } from '@/composables/generate/useDependencyStatus'
import { componentDepRows } from '@/composables/generate/depRows'
import { MODEL_TYPES } from '@/config/model-types'
import { UPSCALE_DEP_GROUP, FACE_DEP_GROUP, getCnDepGroup, type CnBranch } from '@/composables/generate/modelDepConfigs'
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
import { TAGGER_DEP_GROUP } from '@/composables/generate/useTagInterrogation'
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
const state = computed(() => store.currentState)
const options = inject(GenerateOptionsKey)!

const config = computed(() => MODEL_TYPES[props.modelType]!)
const isSplit = computed(() => config.value.loader === 'split')
const modelField = computed<'checkpoint' | 'unet'>(() => isSplit.value ? 'unet' : 'checkpoint')

// ── 视频架构派生 ────────────────────────────────────────────────────
// mediaType==='video' 为视频架构 (Wan 2.2 三条目); 图像架构 (媒体=image) 一字不变。
const isVideo = computed(() => config.value.mediaType === 'video')

// 起始画面原始尺寸 (派生展示数据, 不进 store): 由本文件的 loadRefSize 探测,
// 转手喂给 BasicSettings.refWidth/refHeight → VideoSettings「贴合起始画面」推导用。
const refSize = ref<{ width: number; height: number }>({ width: 0, height: 0 })

// 负面提示词框可见性: 视频快速档 cfg=1.0 时负面无效, 隐藏输入框 (沿用 Krea2 Turbo 先例)。
// 图像架构恒走 config.hasNegativePrompt (回归保护)。
const showNegative = computed(() =>
  config.value.hasNegativePrompt && !(isVideo.value && state.value.fast),
)

// 当前视频模式 (仅 5B 有意义; 14B 恒 i2v)。
const videoMode = computed<'t2v' | 'i2v'>(() => {
  if (config.value.videoModes?.length) {
    return state.value.video?.mode ?? config.value.videoModes[0]
  }
  return 'i2v'
})

// 5B 的文生/图生开关 — 挂在提示词区块标题行右端 (PromptEditor 的 #header-actions 槽)。
// 选那个位置是因为切到文生时左侧媒体栏整块消失, 开关必须待在不随之移动的地方。
const showModeSwitch = computed(() => isVideo.value && (config.value.videoModes?.length ?? 0) > 0)
const videoModeOptions = computed(() =>
  (config.value.videoModes ?? []).map(m => ({
    value: m,
    label: m === 't2v' ? t('generate.video.mode_t2v') : t('generate.video.mode_i2v'),
  })),
)
function onVideoModeChange(v: string) {
  if (state.value.video) state.value.video.mode = v as 't2v' | 'i2v'
}

// 起始画面挂载判定 — 挂在提示词容器左栏 (PromptEditor 的 #media 槽):
//  - 条目内双模式 (wan22_5b/minimax_h3): 仅 i2v 模式渲染 (文生模式下左栏整块消失)
//  - 无 videoModes 的条目: 按 modelType 的 t2v 语义判断 (wan22_t2v = 纯文生不渲染,
//    wan22_i2v 等其余视频条目恒渲染)。原硬编码 'wan22_t2v' 判据由该语义泛化覆盖。
const showStartFrame = computed(() => {
  if (!isVideo.value) return false
  // Ref2VA 参考生成条目无起始画面 (左媒体栏让位给 RefMediaPanel)
  if (props.modelType === 'minimax_h3_ref') return false
  if (config.value.videoModes?.length) return videoMode.value === 'i2v'
  return !props.modelType.includes('t2v')
})

// 末帧挂载判定 (MiniMax H3 首尾帧): 仅 minimax_h3 且 i2v 模式时渲染。
// 其余架构恒 false (不渲染), 末帧是可选项, 不阻断生成。
const showLastFrame = computed(() => props.modelType === 'minimax_h3' && videoMode.value === 'i2v')

// 参考素材面板挂载判定 (MiniMax H3 Ref2VA): 左媒体栏渲染 RefMediaPanel,
// 与 showStartFrame 分支互斥 (两者不会同时渲染)。
const showRefPanel = computed(() => props.modelType === 'minimax_h3_ref')

// state.video 可能为 undefined (图像架构); 参考素材面板仅视频架构渲染,
// 这里用 computed getter/setter 包裹 v-model, 避免模板里直接解包 undefined。
const videoRefs = computed<RefItem[]>({
  get: () => state.value.video?.refs ?? [],
  set: (v) => {
    if (state.value.video) state.value.video.refs = v
  },
})

// ── 起始画面上传/选择 (复用 FileUploadZone + useRefImagePicker, 与图生图同一套) ──
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
  img.onload = () => { refSize.value = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 } }
  img.onerror = () => { refSize.value = { width: 0, height: 0 } }
  img.src = `/api/generate/input_image_preview?name=${encodeURIComponent(name)}`
}

// refImage 任何来源的变化 (手动上传 / picker 选择 / 「生成视频」带入 / t2v 切回) 都要刷新尺寸
watch(() => state.value.video?.refImage ?? '', (name) => loadRefSize(name), { immediate: true })

function onStartFramePick(name: string) {
  if (state.value.video) state.value.video.refImage = name
  videoPicker.close()
}
async function onStartFrameUpload(file: File) {
  const result = await videoPicker.uploadFile(file)
  if (!result) return
  if (state.value.video) state.value.video.refImage = result.filename
  if (result.width && result.height) {
    refSize.value = { width: result.width, height: result.height }
  }
  toast(t('generate.i2i.uploaded'), 'success')
}
function onStartFrameClear() {
  if (state.value.video) state.value.video.refImage = ''
}

// ── 末画面上传/选择 (MiniMax H3 首尾帧; 复用同一套 FileUploadZone + picker) ──
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

// 包装形态: 该 tab 支持的形态列表 (supportedPackaging) + 当前选中项的实际形态
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
  cnPose,
  cnCanny,
  cnDepth,
  depPose,
  depCanny,
  depDepth,
  depUpscale,
  depTagger,
  depFace,
  showPPModal,
  moduleTabs,
  enabledModules,
  onModuleToggle: cnModuleToggle,
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
  ...(config.value.modules.includes('face')
    ? [{ key: 'face', label: t('generate.modules.face'), icon: 'face_retouching_natural' }]
    : []),
])

const localEnabledModules = computed(() => {
  const currentState = state.value
  const enabled = new Set<string>()
  if (currentState.loras.some((lora) => lora.enabled)) enabled.add('lora')
  if (currentState.i2i.enabled) enabled.add('i2i')
  if (currentState.upscale.enabled) enabled.add('upscale')
  if (currentState.hires.enabled) enabled.add('hires')
  if (currentState.faceDetailer.enabled) enabled.add('face')
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

const effectiveModuleTabs = computed(() => {
  // 视频条目 config.modules === ['lora']: 模块区仅 LoRA, i2i/CN/upscale/hires/face 不出现。
  if (isVideo.value) {
    return [{ key: 'lora', label: t('generate.modules.lora'), icon: 'extension' }]
  }
  return config.value.controlNetEnabled ? moduleTabs.value : localModuleTabs.value
})
const effectiveEnabledModules = computed(() => {
  // 视频架构: 仅 lora 可启用 (其余模块不渲染也不计启用)
  if (isVideo.value) {
    const enabled = new Set<string>()
    if (state.value.loras.some((lora) => lora.enabled)) enabled.add('lora')
    return enabled
  }
  return config.value.controlNetEnabled ? enabledModules.value : localEnabledModules.value
})
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
    // 主字段同步为高噪件: runBlockedReason / selectedPackaging / 提交链都读 state.unet
    state.value.unet = state.value.unetHigh || name
    showModelPicker.value = false
    pickerSlot.value = null
    toast(t('generate.toast.selected', { name: name.split('/').pop()!.replace(/\.[^.]+$/, '') }), 'success')
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
  toast(t('generate.toast.selected', { name: name.split('/').pop()!.replace(/\.[^.]+$/, '') }), 'success')
}

// 运行组件: 与 ControlNet/放大/面部/反推 用同一个依赖状态机, 唯一真相是磁盘。
// 清单随 fast 档位变化 (视频快速档要把 lightning 加速件计入必需集, 否则缺件会
// 误判为就绪), 引擎 watch 清单变化自动重判, 无需手动调首次 refresh。
const compStatus = useDependencyStatus(
  () => componentDepRows(props.modelType, { fast: state.value.fast }, t),
  {
    comfyuiDir: () => options.comfyuiDir.value,
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
  if (!isVideo.value) return options.loras.value
  return options.loras.value.filter(l => {
    const bname = l.name.includes('/') ? l.name.slice(l.name.lastIndexOf('/') + 1) : l.name
    return !COMPONENT_FILENAMES.has(bname)
  })
})

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
  if (v && v.mode !== 't2v' && v.mode !== 'i2v') {
    v.mode = modes[0]
  }
}, { immediate: true })

// 视频架构模块区仅 LoRA: 若 activeModule 残留图像架构旧值 (如 'i2i'/'upscale'),
// 强制校正回 'lora', 保证视频任务模块区只渲染 LoRA 面板。仅当前激活 tab + 视频架构生效。
watch(() => [store.activeModelType, isVideo.value] as const, () => {
  if (store.activeModelType !== props.modelType) return
  if (!isVideo.value) return
  if (state.value.activeModule !== 'lora') {
    state.value.activeModule = 'lora'
  }
}, { immediate: true })

// CN 依赖清单按本 tab 的 cnBranch 取 (sdxl → union; ilnoob → 专用); 这里只用它的标题
const _cnBranch = (MODEL_TYPES[props.modelType]?.cnBranch as CnBranch | undefined)
const cnDepPose = getCnDepGroup('pose', _cnBranch)
const cnDepCanny = getCnDepGroup('canny', _cnBranch)
const cnDepDepth = getCnDepGroup('depth', _cnBranch)

/** CN 三个模块的依赖句柄, 供生成前置校验按 key 取 */
const cnDepMap = { pose: depPose, canny: depCanny, depth: depDepth } as const

/** 各依赖状态条的称呼 (进"XX 已就绪 / 缺少 N 项 XX"文案) */
const depNouns = computed(() => ({
  pose: t('generate.dep.noun_pose'),
  canny: t('generate.dep.noun_canny'),
  depth: t('generate.dep.noun_depth'),
  upscale: t('generate.dep.noun_upscale'),
  face: t('generate.dep.noun_face'),
  components: t('generate.components.title'),
}))

/** 模块面板顶部状态条的展开态 (每模块各自记) */
const depExpanded = ref<Record<string, boolean>>({
  pose: false, canny: false, depth: false, upscale: false, face: false,
})

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
  // 音频 VAE (MiniMax H3; 与 vae 同池匹配)
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

  // 1. 主模型未选择 (整合包看 checkpoint, 拆分看 unet)
  // 双 UNet: 两个槽独立选择, 必须都填且互异 —— 只填一个是常见中间态, 要能说清缺什么
  if (config.value.dualUnet) {
    if (!st.unetHigh || !st.unetLow) return t('generate.error.no_unet_pair')
    if (st.unetHigh === st.unetLow) return t('generate.error.video_same_unet')
  } else {
    const modelPicked = pkg === 'split' ? !!st.unet : !!st.checkpoint
    if (!modelPicked) return t('generate.error.no_checkpoint')
  }

  // 1b. 视频 i2v 未选起始画面 → 软禁用 + 点击 toast。
  if (showStartFrame.value && !st.video?.refImage) return t('generate.error.no_start_frame')

  // 1b'. Ref2VA 参考生成: 至少一个参考素材 (图/视频/音频均可) → 软禁用 + 点击 toast。
  //      音频不能作为唯一参考 (官方约束) → 同样软禁用。
  if (showRefPanel.value) {
    const refs = st.video?.refs ?? []
    if (!refs.length) return t('generate.error.minimax_h3_refs_required')
    if (refs.every(r => r.type === 'audio')) return t('generate.error.minimax_h3_refs_audio_requires_visual')
  }

  // 1c. 模块已启用但依赖缺件。开关本身会拦, 但 enabled 是持久化的 —— 上次开着、
  // 这次模型被删/换了架构 (专用 CN 模型按 branch 分家) 都会留下开着却跑不了的状态。
  for (const cnKey of ['pose', 'canny', 'depth'] as const) {
    if (st.controlNets[cnKey]?.enabled && !cnDepMap[cnKey].ready.value) {
      return t(`generate.controlnet.need_download_${cnKey}`)
    }
  }
  if (st.upscale.enabled && !depUpscale.ready.value) return t('generate.upscale.need_model')
  if (st.faceDetailer.enabled && !depFace.ready.value) return t('generate.face.need_model')

  // 整合包自带全部组件, 到此即可
  if (pkg !== 'split') return ''

  // 2. 运行组件未下载 / 下载中 (ready 为假即涵盖两种)
  if (compStatus.has.value && !compStatus.ready.value) {
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
      <!-- 左列: 控制区 (冻结时 inert) -->
      <div class="gen-ctrl-col" :inert="frozen" :class="{ 'gen-frozen': frozen }">
        <!-- 提示词 (视频的起始画面并入本区块左栏, 5B 模式开关并入标题行右端) -->
        <PromptEditor
          ref="promptEditorRef"
          :positive="state.positive"
          :negative="state.negative"
          :show-negative="showNegative"
          :prompt-style="config.promptStyle"
          :model-type="modelType"
          :tools="promptTools"
          @update:positive="state.positive = $event"
          @update:negative="state.negative = $event"
          @tool="onPromptTool"
        >
          <!-- 5B 条目内的文生/图生开关 -->
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
              pick-icon="image"
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
            <RefMediaPanel v-model:refs="videoRefs" :disabled="frozen" />
          </template>

          <!-- 结束画面 (MiniMax H3 i2v 首尾帧; 可选) — 右媒体栏 -->
          <template v-if="showLastFrame" #media-right>
            <p class="model-tab__frame-lbl">{{ t('generate.video.last_frame') }}</p>
            <FileUploadZone
              mode="pick"
              :accept="IMAGE_ACCEPT"
              :preview="lastFramePreview"
              :file-name="lastFrameName"
              :pick-label="t('generate.i2i.pick_from_input')"
              :upload-label="t('generate.i2i.upload_local')"
              pick-icon="image"
              :disabled="frozen"
              @pick="lastFramePicker.open()"
              @file="onLastFrameUpload"
              @clear="onLastFrameClear"
              @error="toast($event, 'warning')"
            />
          </template>
        </PromptEditor>

        <!-- 操作栏 -->
        <ActionBar
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

        <!-- 基础设置 -->
        <BasicSettings
          :model-field="modelField"
          :ref-width="refSize.width"
          :ref-height="refSize.height"
          @open-model="openModelPickerFor"
        />

        <!-- 运行组件状态条 (三态: 就绪/缺失/下载中)。整合包或无组件需求时不渲染 -->
        <DependencyBar
          v-if="selectedPackaging === 'split' && compStatus.has.value"
          :status="compStatus"
          :noun="depNouns.components"
          v-model:expanded="componentPanelExpanded"
        />

        <!-- 高级设置 -->
        <AdvancedSettings
          :show-split-models="selectedPackaging === 'split'"
          :dual-clip="config.dualClip"
          :show-clip-skip-vae="!!config.clipSkipSupport"
          :model-type="modelType"
          :media-type="config.mediaType"
        />
      </div>

      <!-- 右列: 预览区 -->
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

    <!-- ═══ 下部: 功能模块 (Tab + Panel 融合卡片) ═══ -->
    <div class="gen-module-wrap" :inert="frozen" :class="{ 'gen-frozen': frozen }">
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
        <DependencyBar
          v-if="depPose.has.value"
          class="gen-module-dep"
          :status="depPose"
          :noun="depNouns.pose"
          v-model:expanded="depExpanded.pose"
        />
        <ControlNetPanel
          :cn="cnPose"
          @pick="cnPose.picker.open()"
          @file="cnPose.handleUpload"
          @clear="cnPose.clearImage"
          @open-preprocess="showPPModal.pose = true"
        />
      </div>
      <div v-show="state.activeModule === 'canny'" class="gen-module-panel">
        <DependencyBar
          v-if="depCanny.has.value"
          class="gen-module-dep"
          :status="depCanny"
          :noun="depNouns.canny"
          v-model:expanded="depExpanded.canny"
        />
        <ControlNetPanel
          :cn="cnCanny"
          @pick="cnCanny.picker.open()"
          @file="cnCanny.handleUpload"
          @clear="cnCanny.clearImage"
          @open-preprocess="showPPModal.canny = true"
        />
      </div>
      <div v-show="state.activeModule === 'depth'" class="gen-module-panel">
        <DependencyBar
          v-if="depDepth.has.value"
          class="gen-module-dep"
          :status="depDepth"
          :noun="depNouns.depth"
          v-model:expanded="depExpanded.depth"
        />
        <ControlNetPanel
          :cn="cnDepth"
          @pick="cnDepth.picker.open()"
          @file="cnDepth.handleUpload"
          @clear="cnDepth.clearImage"
          @open-preprocess="showPPModal.depth = true"
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
        <UpscalePanel />
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
      :components-missing="compStatus.has.value && !compStatus.ready.value"
      @select="onModelSelect"
    />

    <ModelPickerModal
      v-model="showLoraPicker"
      :title="t('generate.lora.select_title')"
      icon="extension"
      :items="loraPickerItems"
      :multi="true"
      :selected="loraModalPending"
      :current-arch="config.pickerArch"
      :search-placeholder="t('generate.lora.search_placeholder')"
      :count-label="loraCountLabel"
      @toggle="onLoraToggle"
      @confirm="onLoraConfirm"
    />

    <!-- LoRA Detail Modal (local model, details loaded by numeric ID) -->
    <LocalModelModal
      v-model="showLoraDetail"
      :model-id="loraDetailModelId"
    />

    <!-- 起始画面 Picker Modal (视频, usage='video_ref') -->
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

    <!-- 结束画面 Picker Modal (MiniMax H3, usage='video_last_frame') -->
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
      :show-negative="showNegative"
      :emb-picker="embPicker"
      :wc-manager="wcManager"
      @update:positive="state.positive = $event"
      @update:negative="state.negative = $event"
    />

    <!-- Tagger Modal (handles gate internally when not ready) -->
    <TaggerModal
      v-model="showTaggerModal"
      :tagger="tagger"
      :dep="depTagger"
      @apply="onTaggerApply"
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

/* 模块面板顶部的依赖状态条: 常驻一条, 不挡下面的面板内容。
   宽度与位置跟随下方内容容器 (各面板同为 --gen-module-w 居中), 不占满主容器。 */
.gen-module-dep {
  max-width: var(--gen-module-w);
  margin: 0 auto var(--sp-3);
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

/* ── 首/尾帧 (MiniMax H3 首尾帧) 媒体栏小标题: 与 .field-lbl 同款。
      纵向间距由 .prompt-media 的 gap 负责, 自身 margin 归零 ── */
.model-tab__frame-lbl {
  margin: 0;
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
}
</style>
