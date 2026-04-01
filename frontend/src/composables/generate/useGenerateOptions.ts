import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CheckpointItem {
  name: string
  preview: string | null
  arch: string
  info: Record<string, unknown> | null
}

export interface LoraItem {
  name: string
  preview: string | null
  arch: string
  triggers: string | null
  info: Record<string, unknown> | null
}

export interface GenerateOptionsReturn {
  loaded: Ref<boolean>
  loading: Ref<boolean>
  samplers: Ref<string[]>
  schedulers: Ref<string[]>
  checkpoints: ComputedRef<CheckpointItem[]>
  loras: ComputedRef<LoraItem[]>
  controlnetModels: Ref<Record<string, string[]>>
  comfyuiDir: Ref<string>
  load: () => Promise<void>
  refresh: () => Promise<void>
}

// ── Raw API response shape ───────────────────────────────────────────────────

interface OptionsResponse {
  samplers: string[]
  schedulers: string[]
  checkpoints: string[]
  loras: string[]
  checkpoint_previews: Record<string, string | null>
  lora_previews: Record<string, string | null>
  checkpoint_archs: Record<string, string>
  lora_archs: Record<string, string>
  lora_triggers: Record<string, string>
  checkpoint_info: Record<string, Record<string, unknown>>
  lora_info: Record<string, Record<string, unknown>>
  controlnet_models: Record<string, string[]>
  comfyui_dir: string
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useGenerateOptions(): GenerateOptionsReturn {
  const { get } = useApiFetch()

  const loaded = ref(false)
  const loading = ref(false)
  const samplers = ref<string[]>([])
  const schedulers = ref<string[]>([])
  const comfyuiDir = ref('')
  const controlnetModels = ref<Record<string, string[]>>({})

  // Raw data from API
  const rawCheckpoints = ref<string[]>([])
  const rawLoras = ref<string[]>([])
  const checkpointPreviews = ref<Record<string, string | null>>({})
  const loraPreviews = ref<Record<string, string | null>>({})
  const checkpointArchs = ref<Record<string, string>>({})
  const loraArchs = ref<Record<string, string>>({})
  const loraTriggers = ref<Record<string, string>>({})
  const checkpointInfo = ref<Record<string, Record<string, unknown>>>({})
  const loraInfo = ref<Record<string, Record<string, unknown>>>({})

  // Structured computed
  const checkpoints = computed<CheckpointItem[]>(() =>
    rawCheckpoints.value.map(name => ({
      name,
      preview: checkpointPreviews.value[name] ?? null,
      arch: checkpointArchs.value[name] ?? 'unknown',
      info: checkpointInfo.value[name] ?? null,
    })),
  )

  const loras = computed<LoraItem[]>(() =>
    rawLoras.value.map(name => ({
      name,
      preview: loraPreviews.value[name] ?? null,
      arch: loraArchs.value[name] ?? 'unknown',
      triggers: loraTriggers.value[name] ?? null,
      info: loraInfo.value[name] ?? null,
    })),
  )

  async function fetchOptions(forceRefresh = false) {
    if (loading.value) return
    loading.value = true
    try {
      const url = forceRefresh ? '/api/generate/options?refresh=1' : '/api/generate/options'
      const data = await get<OptionsResponse>(url)
      if (!data) return

      samplers.value = data.samplers || []
      schedulers.value = data.schedulers || []
      rawCheckpoints.value = data.checkpoints || []
      rawLoras.value = data.loras || []
      checkpointPreviews.value = data.checkpoint_previews || {}
      loraPreviews.value = data.lora_previews || {}
      checkpointArchs.value = data.checkpoint_archs || {}
      loraArchs.value = data.lora_archs || {}
      loraTriggers.value = data.lora_triggers || {}
      checkpointInfo.value = data.checkpoint_info || {}
      loraInfo.value = data.lora_info || {}
      controlnetModels.value = data.controlnet_models || {}
      comfyuiDir.value = data.comfyui_dir || ''

      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  async function load() {
    if (loaded.value) return
    await fetchOptions(false)
  }

  async function refresh() {
    await fetchOptions(true)
  }

  return {
    loaded, loading,
    samplers, schedulers,
    checkpoints, loras,
    controlnetModels, comfyuiDir,
    load, refresh,
  }
}
