import { ref, computed, markRaw } from 'vue'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TagParamDef {
  key: string
  type: 'select' | 'slider' | 'toggle' | 'text'
  labelKey: string
  helpKey?: string
  default: unknown
  min?: number
  max?: number
  step?: number
  placeholder?: string
  options?: { value: string; label: string }[]
}

// ── Param definitions ────────────────────────────────────────────────────────

export const TAG_PARAMS_DEF: TagParamDef[] = [
  {
    key: 'model',
    type: 'select',
    labelKey: 'generate.interrogate.model_select',
    default: 'wd-eva02-large-tagger-v3',
    options: [],
  },
  {
    key: 'threshold',
    type: 'slider',
    labelKey: 'generate.interrogate.general_threshold',
    helpKey: 'generate.interrogate.general_threshold_help',
    min: 0.1,
    max: 0.9,
    step: 0.05,
    default: 0.35,
  },
  {
    key: 'character_threshold',
    type: 'slider',
    labelKey: 'generate.interrogate.character_threshold',
    helpKey: 'generate.interrogate.character_threshold_help',
    min: 0.1,
    max: 0.9,
    step: 0.05,
    default: 0.85,
  },
  {
    key: 'replace_underscore',
    type: 'toggle',
    labelKey: 'generate.interrogate.replace_underscore',
    helpKey: 'generate.interrogate.replace_underscore_help',
    default: true,
  },
  {
    key: 'exclude_tags',
    type: 'text',
    labelKey: 'generate.interrogate.exclude_tags',
    helpKey: 'generate.interrogate.exclude_tags_help',
    placeholder: 'generate.interrogate.exclude_placeholder',
    default: '',
  },
]

// ── Built-in models (for welcome gate download) ──────────────────────────────

import type { ModelDep, ModelDepConfig } from './useModelDependency'

const TAGGER_MODELS: Record<string, ModelDep> = {
  'wd-eva02-large-tagger-v3': {
    id: 'wd-eva02-large-tagger-v3',
    name: 'WD EVA02 Large v3',
    description: '最高精度',
    size: '~1.2 GB',
    files: [
      {
        filename: 'wd-eva02-large-tagger-v3.onnx',
        url: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main/model.onnx',
        subdir: 'custom_nodes/ComfyUI-WD14-Tagger/models',
      },
      {
        filename: 'wd-eva02-large-tagger-v3.csv',
        url: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main/selected_tags.csv',
        subdir: 'custom_nodes/ComfyUI-WD14-Tagger/models',
      },
    ],
  },
  'wd-vit-tagger-v3': {
    id: 'wd-vit-tagger-v3',
    name: 'WD ViT v3',
    description: '轻量快速',
    size: '~361 MB',
    files: [
      {
        filename: 'wd-vit-tagger-v3.onnx',
        url: 'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx',
        subdir: 'custom_nodes/ComfyUI-WD14-Tagger/models',
      },
      {
        filename: 'wd-vit-tagger-v3.csv',
        url: 'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv',
        subdir: 'custom_nodes/ComfyUI-WD14-Tagger/models',
      },
    ],
  },
}

export const TAGGER_MODEL_CONFIG: ModelDepConfig = {
  tab: 'tagger',
  title: 'generate.interrogate.need_model',
  models: [TAGGER_MODELS['wd-eva02-large-tagger-v3'], TAGGER_MODELS['wd-vit-tagger-v3']],
  minOptional: 1,
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useTagInterrogation() {
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  // Modal visibility
  const visible = ref(false)

  // Status: idle → running → done/error
  const status = ref<'idle' | 'running' | 'done'>('idle')
  const running = computed(() => status.value === 'running')

  // Image source
  const sourceFile = ref<File | null>(null)
  const sourceInputName = ref('')
  const hasSource = computed(() => !!sourceFile.value || !!sourceInputName.value)

  // Dynamic model list (fetched from backend)
  const models = ref<string[]>([])

  // Parameter values (reset each open)
  const paramValues = ref<Record<string, unknown>>({})

  // Result
  const resultText = ref('')
  const promptId = ref('')

  // Timer for elapsed display
  const startTime = ref(0)

  /** Fetch installed tagger model list from backend */
  async function loadModels() {
    try {
      const res = await fetch('/api/generate/tagger_models')
      if (res.ok) {
        const data = await res.json()
        models.value = data.models || []
        // Auto-select first model if current selection is not in the list
        if (models.value.length > 0 && !models.value.includes(paramValues.value.model as string)) {
          paramValues.value = { ...paramValues.value, model: models.value[0] }
        }
      }
    } catch { /* ignore */ }
  }

  /** Open modal — resets state and loads models */
  function open() {
    sourceFile.value = null
    sourceInputName.value = ''
    resultText.value = ''
    promptId.value = ''
    status.value = 'idle'
    startTime.value = 0

    // Reset params to defaults
    const defaults: Record<string, unknown> = {}
    for (const p of TAG_PARAMS_DEF) defaults[p.key] = p.default
    paramValues.value = defaults

    visible.value = true
    loadModels()
  }

  /** Close modal (result preserved for auto-reopen) */
  function close() {
    visible.value = false
  }

  /** Set image from local file upload / drag */
  function setLocalFile(file: File) {
    sourceFile.value = file
    sourceInputName.value = ''
  }

  /** Set image from ComfyUI input/ picker */
  function setInputImage(name: string) {
    sourceFile.value = null
    sourceInputName.value = name
  }

  /** Clear image source */
  function clearSource() {
    sourceFile.value = null
    sourceInputName.value = ''
  }

  /** Submit interrogation request to backend */
  async function interrogate() {
    if (!hasSource.value || running.value) return

    status.value = 'running'
    resultText.value = ''
    startTime.value = Date.now()

    const form = new FormData()
    if (sourceFile.value) {
      form.append('file', sourceFile.value)
    } else {
      form.append('input_name', sourceInputName.value)
    }
    form.append('params', JSON.stringify(paramValues.value))

    try {
      const res = await fetch('/api/generate/interrogate', { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as Record<string, string>).error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      promptId.value = data.prompt_id || ''
      if (!promptId.value) throw new Error('No prompt_id returned')
    } catch (e: any) {
      status.value = 'idle'
      startTime.value = 0
      toast(t('generate.toast.interrogate_submit_failed') + ': ' + (e?.message || e), 'error')
    }
  }

  /** Called by SSE router when interrogation task completes */
  async function onDone(success: boolean) {
    status.value = 'idle'
    startTime.value = 0

    if (success && promptId.value) {
      try {
        const res = await fetch(`/api/generate/interrogate_result?prompt_id=${encodeURIComponent(promptId.value)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        resultText.value = data.tags || ''
        if (resultText.value) {
          status.value = 'done'
          toast(t('generate.interrogate.complete'), 'success')
        } else {
          toast(t('generate.interrogate.empty_result'), 'warning')
        }
      } catch {
        toast(t('generate.toast.interrogate_result_failed'), 'error')
      }
    } else if (!success) {
      toast(t('generate.interrogate.failed'), 'error')
    }

    promptId.value = ''

    // ★ Auto-reopen modal if user closed it during interrogation and result arrived
    if (!visible.value && resultText.value) {
      visible.value = true
    }
  }

  /** Apply result to positive prompt (overwrite) */
  function applyToPrompt(): string {
    const text = resultText.value
    if (text) {
      toast(t('generate.interrogate.use_prompt'), 'success')
    }
    return text
  }

  return {
    visible,
    status,
    running,
    sourceFile,
    sourceInputName,
    hasSource,
    models,
    paramValues,
    resultText,
    promptId,
    startTime,

    open,
    close,
    setLocalFile,
    setInputImage,
    clearSource,
    interrogate,
    onDone,
    applyToPrompt,
    loadModels,
  }
}
