import { ref, computed } from 'vue'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '@/utils/apiError'
import { errorMessage } from '@/utils/errorMessage'

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

import type { DepGroup } from './modelDepConfigs'

const TAGGER_MODELS = {
  'wd-eva02-large-tagger-v3': {
    id: 'wd-eva02-large-tagger-v3',
    label: 'WD EVA02 Large v3',
    hint: '最高精度',
    sizeText: '~1.2 GB',
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
    label: 'WD ViT v3',
    hint: '轻量快速',
    sizeText: '~361 MB',
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

export const TAGGER_DEP_GROUP: DepGroup = {
  title: 'generate.interrogate.need_model',
  rows: [TAGGER_MODELS['wd-eva02-large-tagger-v3'], TAGGER_MODELS['wd-vit-tagger-v3']],
  minOptional: 1,
}

export function useTagInterrogation() {
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  const visible = ref(false)

  const status = ref<'idle' | 'running' | 'done'>('idle')
  const running = computed(() => status.value === 'running')

  const sourceFile = ref<File | null>(null)
  const sourceInputName = ref('')
  const hasSource = computed(() => !!sourceFile.value || !!sourceInputName.value)

  const models = ref<string[]>([])

  const paramValues = ref<Record<string, unknown>>({})

  const resultText = ref('')
  const promptId = ref('')

  const startTime = ref(0)

  async function loadModels() {
    try {
      const res = await fetch('/api/generate/tagger_models')
      if (res.ok) {
        const data = await res.json()
        models.value = data.models || []
        if (models.value.length > 0 && !models.value.includes(paramValues.value.model as string)) {
          paramValues.value = { ...paramValues.value, model: models.value[0] }
        }
      }
    } catch { }
  }

  function open() {
    sourceFile.value = null
    sourceInputName.value = ''
    resultText.value = ''
    promptId.value = ''
    status.value = 'idle'
    startTime.value = 0

    const defaults: Record<string, unknown> = {}
    for (const p of TAG_PARAMS_DEF) defaults[p.key] = p.default
    paramValues.value = defaults

    visible.value = true
    loadModels()
  }

  function close() {
    visible.value = false
  }

  function setLocalFile(file: File) {
    sourceFile.value = file
    sourceInputName.value = ''
  }

  function setInputImage(name: string) {
    sourceFile.value = null
    sourceInputName.value = name
  }

  function clearSource() {
    sourceFile.value = null
    sourceInputName.value = ''
  }

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
        throw new Error(apiErrorText(body, `HTTP ${res.status}`))
      }
      const data = await res.json()
      promptId.value = data.prompt_id || ''
      if (!promptId.value) throw new Error('No prompt_id returned')
    } catch (e: unknown) {
      status.value = 'idle'
      startTime.value = 0
      toast(t('generate.msg.interrogate_submit_failed') + ': ' + errorMessage(e), 'error')
    }
  }

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
        toast(t('generate.msg.interrogate_result_failed'), 'error')
      }
    } else if (!success) {
      toast(t('generate.interrogate.failed'), 'error')
    }

    promptId.value = ''

    if (!visible.value && resultText.value) {
      visible.value = true
    }
  }

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
