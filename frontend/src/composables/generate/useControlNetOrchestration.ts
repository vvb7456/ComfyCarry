import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { useImageToImage } from '@/composables/generate/useImageToImage'
import { useControlNet, CN_TYPES, PP_PARAMS_DEF, type CnType } from '@/composables/generate/useControlNet'
import { useDependencyStatus, type UseDependencyStatusReturn } from '@/composables/generate/useDependencyStatus'
import { useTagInterrogation, TAGGER_DEP_GROUP } from '@/composables/generate/useTagInterrogation'
import { UPSCALE_DEP_GROUP, FACE_DEP_GROUP, SEEDVR2_VAE_ROW_ID, getCnDepGroup, cnPreprocessor, isPreprocessorRow, type CnBranch } from '@/composables/generate/modelDepConfigs'
import type { ExecState } from '@/composables/useExecTracker'
import type { SwitchTabItem } from '@/components/generate/ModuleTabs.vue'
import type { GenerateOptionsReturn } from '@/composables/generate/useGenerateOptions'
import { useToast } from '@/composables/useToast'

type ControlNetType = CnType
type RegisterTask = (promptId: string, type: 'preprocess' | 'tag', subtype: string) => void

interface UseControlNetOrchestrationOptions {
  options: GenerateOptionsReturn
  execState: Ref<ExecState | null>
  onRegisterTask: RegisterTask
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
  const state = computed(() => store.stateFor(modelType))

  const i2i = useImageToImage(modelType)

  // pony/sdxl → 'sdxl'; illustrious/noobai → 'ilnoob'; 其余 (无 cnBranch) → undefined (不过滤)。
  const cnBranch = computed<CnBranch | undefined>(
    () => store.configFor(modelType).cnBranch,
  )

  const cnMap = Object.fromEntries(CN_TYPES.map(type => [
    type, useControlNet(type, options.controlnetModels, cnBranch, modelType),
  ])) as Record<CnType, ReturnType<typeof useControlNet>>

  // 依赖清单按 branch 取 (sdxl → union; ilnoob → 专用), 与面板下拉过滤同源。
  // 状态只来自磁盘, 没有 dismiss 记忆位: 换架构/删模型/别处下完都会自然收敛。

  const tabActive = () => store.activeModelType === modelType

  function cnDep(type: ControlNetType): UseDependencyStatusReturn {
    return useDependencyStatus(
      () => store.configFor(modelType).controlNetEnabled ? getCnDepGroup(type, cnBranch.value, cnMap[type].config.value.model).rows : [],
      {
        minOptional: () => getCnDepGroup(type, cnBranch.value).minOptional ?? 0,
        enabled: tabActive,
        source: 'controlnet-dep',
      },
    )
  }

  const depMap = Object.fromEntries(CN_TYPES.map(type => [type, cnDep(type)])) as Record<CnType, UseDependencyStatusReturn>
  const preprocessDepMap = Object.fromEntries(CN_TYPES.map(type => [type,
    useDependencyStatus(() => store.configFor(modelType).controlNetEnabled
      ? cnPreprocessor(type, cnBranch.value, cnMap[type].config.value.model).rows : [], {
      enabled: tabActive, source: 'controlnet-preprocess',
    }),
  ])) as Record<CnType, UseDependencyStatusReturn>

  function cnModelsReady(type: CnType): boolean {
    return depMap[type].missingRequired.value.every(row => isPreprocessorRow(row.row))
  }

  const depUpscale = useDependencyStatus(() => UPSCALE_DEP_GROUP.rows, {
    minOptional: UPSCALE_DEP_GROUP.minOptional ?? 0,
    readyWhen: UPSCALE_DEP_GROUP.readyWhen,
    enabled: tabActive,
    source: 'upscale-dep',
  })
  /** SeedVR2 共用 VAE 是否在位 (与依赖条同一磁盘真相), 放大面板据此启停 SeedVR2 引擎 */
  const upscaleVaeReady = computed(
    () => depUpscale.rows.value.some(row => row.row.id === SEEDVR2_VAE_ROW_ID && row.installed),
  )
  const depTagger = useDependencyStatus(() => TAGGER_DEP_GROUP.rows, {
    minOptional: TAGGER_DEP_GROUP.minOptional ?? 0,
    enabled: tabActive,
    source: 'tagger-dep',
  })
  const depFace = useDependencyStatus(() => FACE_DEP_GROUP.rows, {
    minOptional: FACE_DEP_GROUP.minOptional ?? 0,
    enabled: tabActive,
    source: 'face-dep',
  })

  const tagger = useTagInterrogation()
  const showPPModal = ref<Record<string, boolean>>({})

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
    if (!preprocessDepMap[cnType].ready.value) {
      toast(t('generate.controlnet.need_preprocess_models'), 'warning')
      return
    }

    const promptId = await cnMap[cnType].submitPreprocess(payload.file, {
      ...payload.params, ...cnPreprocessor(cnType, cnBranch.value, cnMap[cnType].config.value.model).params,
    })
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

  const moduleTabs = computed<SwitchTabItem[]>(() => {
    const config = store.configFor(modelType)
    const isImage = config.mediaType === 'image'
    const controlTypes: readonly string[] = config.controlTypes ?? CN_TYPES
    const tabs: SwitchTabItem[] = [
      { key: 'lora', label: t('generate.modules.lora'), icon: 'layers', disabled: !config.modules.includes('lora') },
    ]
    if (isImage || config.modules.includes('i2i')) {
      tabs.push({ key: 'i2i', label: t('generate.modules.i2i'), icon: 'image', disabled: !config.modules.includes('i2i') })
    }
    if (isImage || config.modules.includes('controlnet')) {
      for (const key of isImage ? CN_TYPES : controlTypes) {
        tabs.push({
          key, label: t(`generate.modules.${key}`), icon: PP_PARAMS_DEF[key as CnType].icon,
          disabled: !config.modules.includes('controlnet') || !config.controlNetEnabled
            || !controlTypes.includes(key),
        })
      }
    }
    if (isImage || config.modules.includes('hires')) {
      tabs.push({ key: 'hires', label: t('generate.modules.hires'), icon: 'auto_fix_high', disabled: !config.modules.includes('hires') })
    }
    if (isImage || config.modules.includes('face')) {
      tabs.push({ key: 'face', label: t('generate.modules.face'), icon: 'face_retouching_natural', disabled: !config.modules.includes('face') })
    }
    if (isImage || config.modules.includes('upscale')) {
      tabs.push({ key: 'upscale', label: t('generate.modules.upscale'), icon: 'hd', disabled: !config.modules.includes('upscale') })
    }
    return tabs
  })

  const enabledModules = computed(() => {
    const currentState = state.value
    const enabled = new Set<string>()

    if (currentState.loras.some((lora) => lora.enabled)) enabled.add('lora')
    if (currentState.i2i.enabled) enabled.add('i2i')
    for (const key of CN_TYPES) if (currentState.controlNets[key]?.enabled) enabled.add(key)
    if (currentState.upscale.enabled) enabled.add('upscale')
    if (currentState.hires.enabled) enabled.add('hires')
    if (currentState.faceDetailer.enabled) enabled.add('face')

    return enabled
  })

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
      case 'lineart':
      case 'tile':
      case 'depth': {
        if (moduleTabs.value.find(tab => tab.key === key)?.disabled) {
          toast(t('generate.error.cn_disabled'), 'warning')
          return
        }
        const cnKey = key as ControlNetType
        const cn = cnMap[cnKey]
        if (enabled && !cnModelsReady(cnKey)) {
          toast(t(`generate.controlnet.need_download_${cnKey}`), 'warning')
          currentState.activeModule = cnKey
          return
        }
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
  }
}
