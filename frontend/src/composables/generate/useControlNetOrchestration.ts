import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { useImageToImage } from '@/composables/generate/useImageToImage'
import { useControlNet } from '@/composables/generate/useControlNet'
import { useModelDependency } from '@/composables/generate/useModelDependency'
import { useTagInterrogation, TAGGER_MODEL_CONFIG } from '@/composables/generate/useTagInterrogation'
import { CN_MODEL_CONFIGS, UPSCALE_MODEL_CONFIG } from '@/composables/generate/modelDepConfigs'
import type { ExecState } from '@/composables/useExecTracker'
import type { GenerateOptionsReturn } from '@/composables/generate/useGenerateOptions'
import { useToast } from '@/composables/useToast'

type ControlNetType = 'pose' | 'canny' | 'depth'
type RegisterTask = (promptId: string, type: 'preprocess' | 'tag', subtype: string) => void

interface UseControlNetOrchestrationOptions {
  options: GenerateOptionsReturn
  execState: Ref<ExecState | null>
  onRegisterTask: RegisterTask
}

export function useControlNetOrchestration({
  options,
  execState,
  onRegisterTask,
}: UseControlNetOrchestrationOptions) {
  const { t } = useI18n({ useScope: 'global' })
  const { toast } = useToast()
  const store = useGenerateStore()
  const state = computed(() => store.currentState)

  const i2i = useImageToImage()

  const cnPose = useControlNet('pose', options.controlnetModels)
  const cnCanny = useControlNet('canny', options.controlnetModels)
  const cnDepth = useControlNet('depth', options.controlnetModels)
  const cnMap = { pose: cnPose, canny: cnCanny, depth: cnDepth } as const

  const depPose = useModelDependency(CN_MODEL_CONFIGS.pose)
  const depCanny = useModelDependency(CN_MODEL_CONFIGS.canny)
  const depDepth = useModelDependency(CN_MODEL_CONFIGS.depth)
  const depMap = { pose: depPose, canny: depCanny, depth: depDepth } as const

  const depUpscale = useModelDependency(UPSCALE_MODEL_CONFIG)
  const depTagger = useModelDependency(TAGGER_MODEL_CONFIG)

  const upscaleReady = ref(false)
  const _taggerReady = ref(false)
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

  let depChecked = false
  watch(() => options.comfyuiDir.value, (dir) => {
    if (!dir && depChecked) return
    depChecked = true

    for (const type of ['pose', 'canny', 'depth'] as const) {
      depMap[type].check(dir).then(() => {
        if (!depMap[type].show.value) {
          cnMap[type].ready.value = true
        }
      })
    }

    depUpscale.check(dir).then(() => {
      if (!depUpscale.show.value) {
        upscaleReady.value = true
      }
    })

    depTagger.check(dir).then(() => {
      if (!depTagger.show.value) {
        _taggerReady.value = true
      }
    })
  }, { immediate: true })

  function onDepEnter(type: ControlNetType) {
    cnMap[type].ready.value = true
    options.refresh()
  }

  function onUpscaleDepEnter() {
    upscaleReady.value = true
    options.refresh()
  }

  function onDepDownload(type: ControlNetType) {
    const dir = options.comfyuiDir.value
    if (dir) depMap[type].startDownload(dir)
  }

  function onUpscaleDepDownload() {
    const dir = options.comfyuiDir.value
    if (dir) depUpscale.startDownload(dir)
  }

  function onTaggerDepEnter() {
    _taggerReady.value = true
    tagger.open()
  }

  function onTaggerDepDownload() {
    const dir = options.comfyuiDir.value
    if (dir) depTagger.startDownload(dir)
  }

  function prepareTagger() {
    if (_taggerReady.value) {
      tagger.open()
    }
  }

  watch(() => tagger.promptId.value, (promptId) => {
    if (promptId) {
      onRegisterTask(promptId, 'tag', 'interrogate')
    }
  })

  function handleTagDone(success: boolean) {
    tagger.onDone(success)
  }

  const moduleTabs = computed(() => [
    { key: 'lora', label: t('generate.modules.lora'), icon: 'extension' },
    { key: 'i2i', label: t('generate.modules.i2i'), icon: 'image' },
    { key: 'pose', label: t('generate.modules.pose'), icon: 'accessibility_new' },
    { key: 'canny', label: t('generate.modules.canny'), icon: 'border_style' },
    { key: 'depth', label: t('generate.modules.depth'), icon: 'layers' },
    { key: 'upscale', label: t('generate.modules.upscale'), icon: 'hd' },
    { key: 'hires', label: t('generate.modules.hires'), icon: 'auto_fix_high' },
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

    return enabled
  })

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
        if (enabled && !cn.validateEnable(cn.models.value)) {
          if (!cn.ready.value) currentState.activeModule = cnKey
          return
        }
        if (currentState.controlNets[key]) currentState.controlNets[key].enabled = enabled
        break
      }

      case 'upscale':
        if (enabled && !upscaleReady.value) {
          toast(t('generate.upscale.need_model'), 'warning')
          currentState.activeModule = 'upscale'
          return
        }
        currentState.upscale.enabled = enabled
        break

      case 'hires':
        currentState.hires.enabled = enabled
        break
    }
  }

  onUnmounted(() => {
    depPose.destroy()
    depCanny.destroy()
    depDepth.destroy()
    depUpscale.destroy()
    depTagger.destroy()
  })

  return {
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
  }
}
