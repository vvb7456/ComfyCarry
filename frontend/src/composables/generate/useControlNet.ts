import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore, type ControlNetState } from '@/stores/generate'
import { useRefImagePicker } from './useRefImagePicker'
import { useToast } from '@/composables/useToast'
import { cnBranchForFile, type CnBranch } from '@/composables/generate/modelDepConfigs'

// ── Constants ────────────────────────────────────────────────────────────────

/** Default input/ subfolder for each CN type */
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

// ── Preprocess param definitions ───────────────────

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
 * @param branchRef — current tab 的 CN branch ('sdxl' | 'ilnoob' | undefined);
 *                    用于面板下拉过滤 (三规则: 兼容排前/不兼容隐藏/未知列后)
 * @param modelType — 本实例所属架构 key。ModelTab 是全量 v-show 挂载的, 每个架构
 *                    都有一个活着的实例; 必须写自己架构的 state —— 写 currentState
 *                    会让非激活实例的自动选中串写到当前架构上。
 */
export function useControlNet(
  type: CnType,
  controlnetModels: Ref<Record<string, string[]>>,
  branchRef: ComputedRef<CnBranch | undefined> | undefined,
  modelType: string,
): UseControlNetReturn {
  const store = useGenerateStore()
  const state = computed(() => store.stateFor(modelType))
  const { t } = useI18n({ useScope: 'global' })
  const { toast } = useToast()

  const subfolder = CN_SUBFOLDERS[type] || type
  const refLabelKey = CN_REF_KEYS[type] || 'generate.controlnet.ref_image'
  const strengthHelpKey = CN_STRENGTH_HELP_KEYS[type] || ''

  // ── Store config ─────────────────────────────────────────────────────────

  const config = computed<ControlNetState>(() => state.value.controlNets[type])

  // ── Models ───────────────────────────────────────────────────────────────
  // 三规则过滤 (branch = 当前 tab 的 cnBranch):
  //   1. 已知且属于当前 branch → 列出且排前, 无选中时自动默认第一个;
  //   2. 已知但属于另一 branch → 隐藏;
  //   3. 未知文件 (用户手动安装, 不在 CN_FILE_BRANCH) → 列出, 排在已知兼容项之后。
  // 无 cnBranch (split 系未启用 CN, 或 config.cnBranch 缺省) → 不过滤, 原样返回 (兼容旧行为)。

  /** 原始 (未过滤) 模型列表, 来自后端 options */
  const rawModels = computed<string[]>(() => controlnetModels.value[type] || [])

  /** 按三规则过滤 + 排序后的模型列表 */
  const models = computed<string[]>(() => {
    const branch = branchRef?.value
    if (!branch) return rawModels.value
    const compat: string[] = []      // 规则 1: 已知 + 兼容 → 排前
    const unknown: string[] = []     // 规则 3: 未知 → 排后
    for (const name of rawModels.value) {
      const fileBranch = cnBranchForFile(name)
      if (fileBranch === null) {
        unknown.push(name)            // 规则 3
      } else if (fileBranch === branch) {
        compat.push(name)             // 规则 1
      }
      // 规则 2: fileBranch !== branch → 隐藏 (跳过)
    }
    return [...compat, ...unknown]
  })
  const hasModels = computed(() => models.value.length > 0)

  // 选中项收敛 (规则 1 的"自动默认第一个"):
  //   列表非空 且 (未选 或 选中项已不在列表里) → 取首项。
  // "已不在列表里" 覆盖两种情况: 被规则 2 按 branch 隐藏, 或模型已被删除 —— 二者
  // 都会让 BaseSelect 找不到值而显示空占位。
  // 列表为空时不清值: options 尚未加载完时列表也是空的, 清了会误伤持久化的选择。
  watch(models, (list) => {
    if (!list.length) return
    const cur = config.value.model
    if (!cur || !list.includes(cur)) {
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
    // Note: CN does NOT auto-disable when image is cleared (asymmetry with I2I, which does)
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
    models,
    hasModels,
    picker,
    preprocessStatus,
    preprocessPromptId,
    preprocessElapsed,
    setImage,
    clearImage,
    handleUpload,
    handleSelect,
    submitPreprocess,
    onPreprocessDone,
    validateEnable,
  }
}
