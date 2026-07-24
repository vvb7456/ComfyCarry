import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CheckpointItem {
  name: string
  preview: string | null
  arch: string
  info: Record<string, unknown> | null
  packaging: 'checkpoint' | 'split'
}

export interface LoraItem {
  name: string
  preview: string | null
  arch: string
  triggers: string | null
  info: Record<string, unknown> | null
}

/** UNet / CLIP / VAE 单文件项 (Anima 等分离式架构使用) */
export interface ModelFileItem {
  name: string
  preview: string | null
  arch: string
  info?: Record<string, unknown> | null
  packaging?: 'checkpoint' | 'split'
}

export interface GenerateOptionsReturn {
  loaded: Ref<boolean>
  loading: Ref<boolean>
  samplers: Ref<string[]>
  schedulers: Ref<string[]>
  checkpoints: ComputedRef<CheckpointItem[]>
  loras: ComputedRef<LoraItem[]>
  unets: ComputedRef<ModelFileItem[]>
  clips: ComputedRef<ModelFileItem[]>
  vaes: ComputedRef<ModelFileItem[]>
  controlnetModels: Ref<Record<string, string[]>>
  seedvr2Models: Ref<string[]>
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
  unets: string[]
  clips: string[]
  vaes: string[]
  checkpoint_previews: Record<string, string | null>
  lora_previews: Record<string, string | null>
  unet_previews: Record<string, string | null>
  clip_previews: Record<string, string | null>
  vae_previews: Record<string, string | null>
  checkpoint_archs: Record<string, string>
  lora_archs: Record<string, string>
  unet_archs: Record<string, string>
  checkpoint_packagings: Record<string, string>
  unet_packagings: Record<string, string>
  lora_triggers: Record<string, string>
  checkpoint_info: Record<string, Record<string, unknown>>
  lora_info: Record<string, Record<string, unknown>>
  unet_info: Record<string, Record<string, unknown>>
  controlnet_models: Record<string, string[]>
  seedvr2_models: string[]
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
  const seedvr2Models = ref<string[]>([])

  // Raw data from API
  const rawCheckpoints = ref<string[]>([])
  const rawLoras = ref<string[]>([])
  const rawUnets = ref<string[]>([])
  const rawClips = ref<string[]>([])
  const rawVaes = ref<string[]>([])
  const checkpointPreviews = ref<Record<string, string | null>>({})
  const loraPreviews = ref<Record<string, string | null>>({})
  const unetPreviews = ref<Record<string, string | null>>({})
  const clipPreviews = ref<Record<string, string | null>>({})
  const vaePreviews = ref<Record<string, string | null>>({})
  const checkpointArchs = ref<Record<string, string>>({})
  const loraArchs = ref<Record<string, string>>({})
  const unetArchs = ref<Record<string, string>>({})
  const checkpointPackagings = ref<Record<string, string>>({})
  const unetPackagings = ref<Record<string, string>>({})
  const loraTriggers = ref<Record<string, string>>({})
  const checkpointInfo = ref<Record<string, Record<string, unknown>>>({})
  const loraInfo = ref<Record<string, Record<string, unknown>>>({})
  const unetInfo = ref<Record<string, Record<string, unknown>>>({})

  // Structured computed
  const checkpoints = computed<CheckpointItem[]>(() =>
    rawCheckpoints.value.map(name => ({
      name,
      preview: checkpointPreviews.value[name] ?? null,
      arch: checkpointArchs.value[name] ?? 'unknown',
      info: checkpointInfo.value[name] ?? null,
      packaging: (checkpointPackagings.value[name] as 'checkpoint' | 'split') ?? 'checkpoint',
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

  const unets = computed<ModelFileItem[]>(() =>
    rawUnets.value.map(name => ({
      name,
      preview: unetPreviews.value[name] ?? null,
      arch: unetArchs.value[name] ?? 'unknown',
      info: unetInfo.value[name] ?? null,
      packaging: (unetPackagings.value[name] as 'checkpoint' | 'split') ?? 'split',
    })),
  )

  // CLIP / VAE 不检测架构 (仅 UNet 过滤)
  const clips = computed<ModelFileItem[]>(() =>
    rawClips.value.map(name => ({
      name,
      preview: clipPreviews.value[name] ?? null,
      arch: 'unknown',
    })),
  )

  const vaes = computed<ModelFileItem[]>(() =>
    rawVaes.value.map(name => ({
      name,
      preview: vaePreviews.value[name] ?? null,
      arch: 'unknown',
    })),
  )

  // 进行中的请求句柄。旧实现是 `if (loading.value) return` —— 并发时会把请求**静默丢弃**,
  // 组件下载完成触发的强制刷新一旦撞上其它加载 (如 onActivated 的 refresh) 就被吞掉,
  // 表现为"组件下完了但 CLIP/VAE 下拉没更新"。改为: 非强制刷新复用在飞的请求,
  // 强制刷新排队到其后重跑, 绝不丢弃。
  let inflight: Promise<void> | null = null

  async function _doFetch(forceRefresh: boolean): Promise<void> {
    loading.value = true
    try {
      const url = forceRefresh ? '/api/generate/options?refresh=1' : '/api/generate/options'
      const data = await get<OptionsResponse>(url)
      if (!data) return

      samplers.value = data.samplers || []
      schedulers.value = data.schedulers || []
      rawCheckpoints.value = data.checkpoints || []
      rawLoras.value = data.loras || []
      rawUnets.value = data.unets || []
      rawClips.value = data.clips || []
      rawVaes.value = data.vaes || []
      checkpointPreviews.value = data.checkpoint_previews || {}
      loraPreviews.value = data.lora_previews || {}
      unetPreviews.value = data.unet_previews || {}
      clipPreviews.value = data.clip_previews || {}
      vaePreviews.value = data.vae_previews || {}
      checkpointArchs.value = data.checkpoint_archs || {}
      loraArchs.value = data.lora_archs || {}
      unetArchs.value = data.unet_archs || {}
      checkpointPackagings.value = data.checkpoint_packagings || {}
      unetPackagings.value = data.unet_packagings || {}
      loraTriggers.value = data.lora_triggers || {}
      checkpointInfo.value = data.checkpoint_info || {}
      loraInfo.value = data.lora_info || {}
      unetInfo.value = data.unet_info || {}
      controlnetModels.value = data.controlnet_models || {}
      seedvr2Models.value = data.seedvr2_models || []
      comfyuiDir.value = data.comfyui_dir || ''

      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  function fetchOptions(forceRefresh = false): Promise<void> {
    if (inflight) {
      return forceRefresh ? inflight.then(() => fetchOptions(true)) : inflight
    }
    const p = _doFetch(forceRefresh).finally(() => { if (inflight === p) inflight = null })
    inflight = p
    return p
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
    unets, clips, vaes,
    controlnetModels, seedvr2Models, comfyuiDir,
    load, refresh,
  }
}
