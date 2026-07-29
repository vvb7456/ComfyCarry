import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { useImageToImage } from '@/composables/generate/useImageToImage'
import { useControlNet } from '@/composables/generate/useControlNet'
import { useDependencyStatus, type UseDependencyStatusReturn } from '@/composables/generate/useDependencyStatus'
import { useTagInterrogation, TAGGER_DEP_GROUP } from '@/composables/generate/useTagInterrogation'
import { UPSCALE_DEP_GROUP, FACE_DEP_GROUP, getCnDepGroup, type CnBranch } from '@/composables/generate/modelDepConfigs'
import { MODEL_TYPES } from '@/config/model-types'
import type { ExecState } from '@/composables/useExecTracker'
import type { GenerateOptionsReturn } from '@/composables/generate/useGenerateOptions'
import { useToast } from '@/composables/useToast'

type ControlNetType = 'pose' | 'canny' | 'depth'
type RegisterTask = (promptId: string, type: 'preprocess' | 'tag', subtype: string) => void

interface UseControlNetOrchestrationOptions {
  options: GenerateOptionsReturn
  execState: Ref<ExecState | null>
  onRegisterTask: RegisterTask
  /** 本 ModelTab 实例对应的模型 type key (静态, 用于推导 cnBranch) */
  modelType: string
}

export function useControlNetOrchestration({
  options,
  execState,
  onRegisterTask,
  modelType,
}: UseControlNetOrchestrationOptions) {
  const { t } = useI18n({ useScope: 'global' })
  const { toast } = useToast()
  const store = useGenerateStore()
  // 本实例所属架构的 state (ModelTab 全量挂载, 不能用 currentState)
  const state = computed(() => store.stateFor(modelType))

  const i2i = useImageToImage()

  // 本 tab 的 CN branch: 由 modelType → MODEL_TYPES[key].cnBranch 推导 (静态)。
  // pony/sdxl → 'sdxl'; illustrious/noobai → 'ilnoob'; 其余 (无 cnBranch) → undefined (不过滤)。
  const cnBranch = computed<CnBranch | undefined>(
    () => (MODEL_TYPES[modelType]?.cnBranch as CnBranch | undefined),
  )

  const cnPose = useControlNet('pose', options.controlnetModels, cnBranch, modelType)
  const cnCanny = useControlNet('canny', options.controlnetModels, cnBranch, modelType)
  const cnDepth = useControlNet('depth', options.controlnetModels, cnBranch, modelType)
  const cnMap = { pose: cnPose, canny: cnCanny, depth: cnDepth } as const

  // ── 依赖状态机 (与运行组件同一套) ──────────────────────────────────────────
  // 依赖清单按 branch 取 (sdxl → union; ilnoob → 专用), 与面板下拉过滤同源。
  // 状态只来自磁盘, 没有 dismiss 记忆位: 换架构/删模型/别处下完都会自然收敛。

  const comfyuiDir = () => options.comfyuiDir.value
  // 模块依赖只在本 tab 激活时体检 (全量挂载下否则是 17×6 次 check)
  const tabActive = () => store.activeModelType === modelType

  function cnDep(type: ControlNetType): UseDependencyStatusReturn {
    return useDependencyStatus(
      () => getCnDepGroup(type, cnBranch.value).rows,
      {
        minOptional: () => getCnDepGroup(type, cnBranch.value).minOptional ?? 0,
        comfyuiDir,
        enabled: tabActive,
        source: 'controlnet-dep',
      },
    )
  }

  const depPose = cnDep('pose')
  const depCanny = cnDep('canny')
  const depDepth = cnDep('depth')
  const depMap = { pose: depPose, canny: depCanny, depth: depDepth } as const

  const depUpscale = useDependencyStatus(() => UPSCALE_DEP_GROUP.rows, {
    minOptional: UPSCALE_DEP_GROUP.minOptional ?? 0,
    comfyuiDir,
    enabled: tabActive,
    source: 'upscale-dep',
  })
  const depTagger = useDependencyStatus(() => TAGGER_DEP_GROUP.rows, {
    minOptional: TAGGER_DEP_GROUP.minOptional ?? 0,
    comfyuiDir,
    enabled: tabActive,
    source: 'tagger-dep',
  })
  const depFace = useDependencyStatus(() => FACE_DEP_GROUP.rows, {
    minOptional: FACE_DEP_GROUP.minOptional ?? 0,
    comfyuiDir,
    enabled: tabActive,
    source: 'face-dep',
  })

  // 依赖由缺失变就绪 = 刚下完 → 刷新 options, 让新模型立刻出现在下拉里
  for (const dep of [depPose, depCanny, depDepth, depUpscale, depFace]) {
    watch(() => dep.ready.value, (ready, prev) => {
      if (ready && prev === false) void options.refresh()
    })
  }

  const tagger = useTagInterrogation()
  const showPPModal = ref({ pose: false, canny: false, depth: false })

  async function onPPSubmit(
    cnType: ControlNetType,
    payload: { file: File | string; params: Record<string, unknown> },
  ) {
    if (execState.value) {
      toast(t('generate.controlnet.preprocess_blocked'), 'warning')
      return
    }

    if (cnMap[cnType].preprocessStatus.value === 'running') {
      toast(t('generate.controlnet.preprocess_blocked'), 'warning')
      return
    }

    const promptId = await cnMap[cnType].submitPreprocess(payload.file, payload.params)
    if (promptId) {
      onRegisterTask(promptId, 'preprocess', cnType)
    }
  }

  function handlePreprocessDone(cnType: string, success: boolean) {
    const cn = cnMap[cnType as keyof typeof cnMap]
    if (!cn) return
    cn.onPreprocessDone(success)
  }

  function prepareTagger() {
    // 缺件也照开: 弹窗顶部的状态条会说清缺什么并就地下载
    tagger.open()
  }

  watch(() => tagger.promptId.value, (promptId) => {
    if (promptId) {
      onRegisterTask(promptId, 'tag', 'interrogate')
    }
  })

  function handleTagDone(success: boolean) {
    tagger.onDone(success)
  }

  // face 模块按架构可用 (FR-1): MODEL_TYPES[type].modules 声明 — flux2 系不含
  const faceModuleAvailable = (MODEL_TYPES[modelType]?.modules ?? []).includes('face')

  const moduleTabs = computed(() => [
    { key: 'lora', label: t('generate.modules.lora'), icon: 'extension' },
    { key: 'i2i', label: t('generate.modules.i2i'), icon: 'image' },
    { key: 'pose', label: t('generate.modules.pose'), icon: 'accessibility_new' },
    { key: 'canny', label: t('generate.modules.canny'), icon: 'border_style' },
    { key: 'depth', label: t('generate.modules.depth'), icon: 'layers' },
    { key: 'upscale', label: t('generate.modules.upscale'), icon: 'hd' },
    { key: 'hires', label: t('generate.modules.hires'), icon: 'auto_fix_high' },
    ...(faceModuleAvailable
      ? [{ key: 'face', label: t('generate.modules.face'), icon: 'face_retouching_natural' }]
      : []),
  ])

  const enabledModules = computed(() => {
    const currentState = state.value
    const enabled = new Set<string>()

    if (currentState.loras.some((lora) => lora.enabled)) enabled.add('lora')
    if (currentState.i2i.enabled) enabled.add('i2i')
    if (currentState.controlNets.pose?.enabled) enabled.add('pose')
    if (currentState.controlNets.canny?.enabled) enabled.add('canny')
    if (currentState.controlNets.depth?.enabled) enabled.add('depth')
    if (currentState.upscale.enabled) enabled.add('upscale')
    if (currentState.hires.enabled) enabled.add('hires')
    if (currentState.faceDetailer.enabled) enabled.add('face')

    return enabled
  })

  /**
   * 依赖未就绪时拒绝开启: 提示 + 跳到该模块。
   * 模块面板顶部常驻状态条, 用户落地即能看到缺什么、就地下载 —— 不再有"提示了
   * 却无处可去"的死路 (旧 welcome gate dismiss 后就是这个状态)。
   */
  function blockOnMissingDep(key: string, dep: UseDependencyStatusReturn, msgKey: string): boolean {
    if (dep.ready.value) return false
    toast(t(msgKey), 'warning')
    state.value.activeModule = key
    return true
  }

  function onModuleToggle(key: string, enabled: boolean) {
    const currentState = state.value

    switch (key) {
      case 'lora':
        if (enabled && currentState.loras.length === 0) {
          toast(t('generate.lora.empty_warn'), 'warning')
          return
        }
        currentState.loras.forEach((lora) => {
          lora.enabled = enabled
        })
        break

      case 'i2i':
        if (enabled && !currentState.i2i.image) {
          toast(t('generate.i2i.select_ref'), 'warning')
          return
        }
        currentState.i2i.enabled = enabled
        break

      case 'pose':
      case 'canny':
      case 'depth': {
        const cnKey = key as ControlNetType
        const cn = cnMap[cnKey]
        if (enabled && blockOnMissingDep(cnKey, depMap[cnKey], `generate.controlnet.need_download_${cnKey}`)) return
        if (enabled && !cn.validateEnable(cn.models.value)) return
        if (currentState.controlNets[key]) currentState.controlNets[key].enabled = enabled
        break
      }

      case 'upscale':
        if (enabled && blockOnMissingDep('upscale', depUpscale, 'generate.upscale.need_model')) return
        currentState.upscale.enabled = enabled
        break

      case 'hires':
        currentState.hires.enabled = enabled
        break

      case 'face':
        if (enabled && blockOnMissingDep('face', depFace, 'generate.face.need_model')) return
        currentState.faceDetailer.enabled = enabled
        break
    }
  }

  return {
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
    onModuleToggle,
    onPPSubmit,
    handlePreprocessDone,
    prepareTagger,
    handleTagDone,
  }
}
