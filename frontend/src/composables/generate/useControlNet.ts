import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore, type ControlNetState } from '@/stores/generate'
import { useRefImagePicker } from './useRefImagePicker'
import { useToast } from '@/composables/useToast'

// ── Constants ────────────────────────────────────────────────────────────────

/** Default input/ subfolder for each CN type (legacy: _CN_SUBFOLDER) */
const CN_SUBFOLDERS: Record<string, string> = {
  pose: 'openpose',
  canny: 'canny',
  depth: 'depth',
}

/** Map CN type → i18n ref label key */
const CN_REF_KEYS: Record<string, string> = {
  pose: 'generate.controlnet.ref_pose',
  canny: 'generate.controlnet.ref_canny',
  depth: 'generate.controlnet.ref_depth',
}

/** Map CN type → i18n strength help key */
const CN_STRENGTH_HELP_KEYS: Record<string, string> = {
  pose: 'generate.controlnet.strength_help_pose',
  canny: 'generate.controlnet.strength_help_canny',
  depth: 'generate.controlnet.strength_help_depth',
}

/** i18n key for the CN type display name (骨骼图 / 边缘图 / 深度图) */
export const CN_LABEL_KEYS: Record<string, string> = {
  pose: 'generate.controlnet.bone_map',
  canny: 'generate.controlnet.edge_map',
  depth: 'generate.controlnet.depth_map',
}

// ── Preprocess param definitions (legacy: _PP_PARAMS_DEF) ───────────────────

export interface PPParamDef {
  key: string
  labelKey: string
  type: 'toggle' | 'slider' | 'select'
  default: number | boolean
  helpKey?: string
  min?: number
  max?: number
  step?: number
  options?: { value: number; label: string }[]
}

export interface PPTypeDef {
  titleKey: string
  icon: string
  params: PPParamDef[]
}

export const PP_PARAMS_DEF: Record<CnType, PPTypeDef> = {
  pose: {
    titleKey: 'generate.controlnet.bone_map',
    icon: 'accessibility_new',
    params: [
      { key: 'detect_body', labelKey: 'generate.controlnet.detect_body', type: 'toggle', default: true },
      { key: 'detect_hand', labelKey: 'generate.controlnet.detect_fingers', type: 'toggle', default: true },
      { key: 'detect_face', labelKey: 'generate.controlnet.detect_face', type: 'toggle', default: true },
      {
        key: 'resolution', labelKey: 'generate.controlnet.detect_resolution', type: 'select', default: 1024,
        options: [{ value: 512, label: '512' }, { value: 768, label: '768' }, { value: 1024, label: '1024' }, { value: 1536, label: '1536' }],
      },
    ],
  },
  canny: {
    titleKey: 'generate.controlnet.edge_map',
    icon: 'border_style',
    params: [
      { key: 'low_threshold', labelKey: 'generate.controlnet.low_threshold', helpKey: 'generate.controlnet.low_threshold_help', type: 'slider', min: 0, max: 255, step: 1, default: 100 },
      { key: 'high_threshold', labelKey: 'generate.controlnet.high_threshold', helpKey: 'generate.controlnet.high_threshold_help', type: 'slider', min: 0, max: 255, step: 1, default: 200 },
      {
        key: 'resolution', labelKey: 'generate.controlnet.detect_resolution', helpKey: 'generate.controlnet.detect_resolution_help', type: 'select', default: 1024,
        options: [{ value: 512, label: '512' }, { value: 768, label: '768' }, { value: 1024, label: '1024' }, { value: 1536, label: '1536' }],
      },
    ],
  },
  depth: {
    titleKey: 'generate.controlnet.depth_map',
    icon: 'layers',
    params: [
      {
        key: 'resolution', labelKey: 'generate.controlnet.detect_resolution', type: 'select', default: 1024,
        options: [{ value: 512, label: '512' }, { value: 768, label: '768' }, { value: 1024, label: '1024' }, { value: 1536, label: '1536' }],
      },
    ],
  },
}

// ── Types ────────────────────────────────────────────────────────────────────

export type CnType = 'pose' | 'canny' | 'depth'

export interface UseControlNetReturn {
  /** CN type identifier */
  type: CnType
  /** Default subfolder in input/ for this CN type */
  subfolder: string
  /** Reactive CN config from store */
  config: ComputedRef<ControlNetState>
  /** i18n key for the reference image label */
  refLabelKey: string
  /** i18n key for the strength help tooltip */
  strengthHelpKey: string

  /** Welcome/ready state — whether user has dismissed the model setup gate */
  ready: Ref<boolean>
  /** Whether welcome state is being loaded */
  readyLoading: Ref<boolean>

  /** Available CN models for this type (from options) */
  models: ComputedRef<string[]>
  /** Whether any models are available */
  hasModels: ComputedRef<boolean>

  /** Ref image picker (shared composable) */
  picker: ReturnType<typeof useRefImagePicker>

  /** Preprocess status */
  preprocessStatus: Ref<'idle' | 'running' | 'done' | 'error'>
  /** Preprocess prompt ID (for task registry matching) */
  preprocessPromptId: Ref<string>
  /** Preprocess timer elapsed (seconds) */
  preprocessElapsed: Ref<number>

  /** Check welcome/ready state from backend */
  checkReady: () => Promise<void>
  /** Dismiss welcome gate and mark as ready */
  dismissWelcome: () => Promise<void>
  /** Set the CN reference image */
  setImage: (filename: string) => void
  /** Clear the CN reference image */
  clearImage: () => void
  /** Handle file upload for reference image */
  handleUpload: (file: File) => Promise<void>
  /** Handle select from ref image picker */
  handleSelect: (name: string) => void
  /** Submit preprocessing workflow */
  submitPreprocess: (file: File | string, params?: Record<string, unknown>) => Promise<string | null>
  /** Handle preprocess completion (called from SSE event routing) */
  onPreprocessDone: (success: boolean, outputFile?: string) => void
  /** Validate enable toggle — returns true if allowed, false if blocked (with toast) */
  validateEnable: (modelList: string[]) => boolean
}

// ── Composable ───────────────────────────────────────────────────────────────

/**
 * ControlNet composable — encapsulates all logic for a single CN type.
 *
 * @param type — 'pose' | 'canny' | 'depth'
 * @param controlnetModels — reactive ref to the full controlnet models map from options
 */
export function useControlNet(
  type: CnType,
  controlnetModels: Ref<Record<string, string[]>>,
): UseControlNetReturn {
  const store = useGenerateStore()
  const state = computed(() => store.currentState)
  const { t } = useI18n({ useScope: 'global' })
  const { toast } = useToast()

  const subfolder = CN_SUBFOLDERS[type] || type
  const refLabelKey = CN_REF_KEYS[type] || 'generate.controlnet.ref_image'
  const strengthHelpKey = CN_STRENGTH_HELP_KEYS[type] || ''

  // ── Store config ─────────────────────────────────────────────────────────

  const config = computed<ControlNetState>(() => state.value.controlNets[type])

  // ── Welcome / ready state ────────────────────────────────────────────────

  const ready = ref(false)
  const readyLoading = ref(false)

  async function checkReady() {
    readyLoading.value = true
    try {
      const res = await fetch('/api/generate/welcome_state')
      if (res.ok) {
        const data = await res.json()
        ready.value = !!data[type]
      }
    } catch {
      // Fail open — assume not ready
    } finally {
      readyLoading.value = false
    }
  }

  async function dismissWelcome() {
    try {
      const res = await fetch('/api/generate/welcome_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: type }),
      })
      if (res.ok) {
        ready.value = true
      }
    } catch {
      // Silent fail
    }
  }

  // ── Models ───────────────────────────────────────────────────────────────

  const models = computed<string[]>(() => controlnetModels.value[type] || [])
  const hasModels = computed(() => models.value.length > 0)

  // Auto-select first model when list populates and none selected
  watch(models, (list) => {
    if (list.length > 0 && !config.value.model) {
      config.value.model = list[0]
    }
  }, { immediate: true })

  // ── Ref image picker ─────────────────────────────────────────────────────

  const picker = useRefImagePicker(type, subfolder)

  function setImage(filename: string) {
    config.value.image = filename
  }

  function clearImage() {
    config.value.image = null
    // Note: CN does NOT auto-disable when image is cleared (legacy asymmetry with I2I)
  }

  async function handleUpload(file: File) {
    const result = await picker.uploadFile(file)
    if (result) {
      setImage(result.filename)
      toast(t('generate.i2i.uploaded'), 'success')
    }
  }

  function handleSelect(name: string) {
    setImage(name)
    picker.close()
  }

  // ── Preprocessing ────────────────────────────────────────────────────────

  const preprocessStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
  const preprocessPromptId = ref('')
  const preprocessOutputFile = ref('')
  const preprocessElapsed = ref(0)
  let ppTimer: ReturnType<typeof setInterval> | null = null

  function startPPTimer() {
    stopPPTimer()
    preprocessElapsed.value = 0
    const started = Date.now()
    ppTimer = setInterval(() => {
      preprocessElapsed.value = Math.floor((Date.now() - started) / 1000)
    }, 1000)
  }

  function stopPPTimer() {
    if (ppTimer) {
      clearInterval(ppTimer)
      ppTimer = null
    }
  }

  async function submitPreprocess(
    file: File | string,
    params: Record<string, unknown> = {},
  ): Promise<string | null> {
    preprocessStatus.value = 'running'
    startPPTimer()

    const labelMap: Record<string, string> = {
      pose: t('generate.controlnet.bone_map'),
      canny: t('generate.controlnet.edge_map'),
      depth: t('generate.controlnet.depth_map'),
    }

    try {
      const form = new FormData()
      if (file instanceof File) {
        form.append('file', file)
      } else {
        form.append('input_name', file)
      }
      form.append('type', type)
      if (Object.keys(params).length) {
        form.append('params', JSON.stringify(params))
      }

      const res = await fetch('/api/generate/preprocess', {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast((body as Record<string, string>).error || `Preprocess failed (${res.status})`, 'error')
        preprocessStatus.value = 'error'
        stopPPTimer()
        return null
      }

      const data = await res.json()
      preprocessPromptId.value = data.prompt_id || ''
      preprocessOutputFile.value = data.output_filename || ''
      toast(t('generate.controlnet.generating', { label: labelMap[type] || type }), 'info')
      return data.prompt_id || null
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Preprocess failed'
      toast(msg, 'error')
      preprocessStatus.value = 'error'
      stopPPTimer()
      return null
    }
  }

  function onPreprocessDone(success: boolean, outputFile?: string) {
    stopPPTimer()
    const output = outputFile || preprocessOutputFile.value
    if (success && output) {
      preprocessStatus.value = 'done'
      // Auto-fill the reference image from preprocess output
      setImage(output)
      const labelMap: Record<string, string> = {
        pose: t('generate.controlnet.bone_map'),
        canny: t('generate.controlnet.edge_map'),
        depth: t('generate.controlnet.depth_map'),
      }
      toast(t('generate.controlnet.generating', { label: labelMap[type] || type }) + ' ✓', 'success')
    } else {
      preprocessStatus.value = success ? 'done' : 'error'
    }
    preprocessPromptId.value = ''
    preprocessOutputFile.value = ''
  }

  // ── Validation for enable toggle ─────────────────────────────────────────

  function validateEnable(modelList: string[]): boolean {
    if (!ready.value) {
      toast(t(`generate.controlnet.need_download_${type}`), 'warning')
      return false
    }
    if (modelList.length === 0) {
      toast(t('generate.controlnet.need_model'), 'warning')
      return false
    }
    if (!config.value.image) {
      toast(t('generate.controlnet.need_ref'), 'warning')
      return false
    }
    return true
  }

  return {
    type,
    subfolder,
    config,
    refLabelKey,
    strengthHelpKey,
    ready,
    readyLoading,
    models,
    hasModels,
    picker,
    preprocessStatus,
    preprocessPromptId,
    preprocessElapsed,
    checkReady,
    dismissWelcome,
    setImage,
    clearImage,
    handleUpload,
    handleSelect,
    submitPreprocess,
    onPreprocessDone,
    validateEnable,
  }
}
