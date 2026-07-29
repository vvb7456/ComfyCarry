import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import type { ModelTypeConfig } from '@/config/model-types'

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
  /** AuraSR 权重是否在磁盘 (固定两文件, 后端报布尔) */
  aurasrInstalled: Ref<boolean>
  ultralyticsBboxModels: Ref<string[]>
  samModels: Ref<string[]>
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
  lora_triggers: Record<string, string>
  checkpoint_info: Record<string, Record<string, unknown>>
  lora_info: Record<string, Record<string, unknown>>
  unet_info: Record<string, Record<string, unknown>>
  controlnet_models: Record<string, string[]>
  seedvr2_models: string[]
  aurasr_installed?: boolean
  ultralytics_bbox_models: string[]
  sam_models: string[]
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
  const aurasrInstalled = ref(false)
  const ultralyticsBboxModels = ref<string[]>([])
  const samModels = ref<string[]>([])

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
  const loraTriggers = ref<Record<string, string>>({})
  const checkpointInfo = ref<Record<string, Record<string, unknown>>>({})
  const loraInfo = ref<Record<string, Record<string, unknown>>>({})
  const unetInfo = ref<Record<string, Record<string, unknown>>>({})

  // Structured computed
  // packaging 由列表归属推导 — checkpoints 列表项 = 整合包, unets 列表项 = 拆分件。
  // 字段本身保留 (picker 徽章 / 形态过滤 chip / BasicSettings 仍读 item.packaging)。
  const checkpoints = computed<CheckpointItem[]>(() =>
    rawCheckpoints.value.map(name => ({
      name,
      preview: checkpointPreviews.value[name] ?? null,
      arch: checkpointArchs.value[name] ?? 'unknown',
      info: checkpointInfo.value[name] ?? null,
      packaging: 'checkpoint',
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
      packaging: 'split',
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
      loraTriggers.value = data.lora_triggers || {}
      checkpointInfo.value = data.checkpoint_info || {}
      loraInfo.value = data.lora_info || {}
      unetInfo.value = data.unet_info || {}
      controlnetModels.value = data.controlnet_models || {}
      seedvr2Models.value = data.seedvr2_models || []
      aurasrInstalled.value = !!data.aurasr_installed
      ultralyticsBboxModels.value = data.ultralytics_bbox_models || []
      samModels.value = data.sam_models || []
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
    controlnetModels, seedvr2Models, aurasrInstalled, ultralyticsBboxModels, samModels, comfyuiDir,
    load, refresh,
  }
}

// ── 打包形态判定 helper ────────────────────────────────────────────
// 收敛 ModelTab.selectedPackaging (原 unet 优先) 与 useGenerateSubmit.resolvePackaging
// (原 checkpoint 优先) 两处互为镜像、优先级相反的实现。正常情况下 (state.checkpoint 与
// state.unet 互斥) 二者结论本就一致; 脏数据 (两字段同时非空) 下旧实现会分叉, 此 helper
// 保证两处必然同结论。语义见 docs/DOWNLOAD_PROBE_CONVERGENCE_SPEC.md §4:
//   1. 视频架构恒 split (supportedPackaging:['split'], 显式短路保留可读性)
//   2. 单形态 tab 取其唯一形态
//   3. 否则看文件是否在 checkpoints 列表里 (目录判定 = ComfyUI 加载节点目录绑定)
// name 为空 (未选) 不在 checkpoints 列表 → 'split', 与双形态 tab 现有默认行为一致。
export function packagingOf(
  name: string,
  config: ModelTypeConfig | undefined,
  checkpointNames: readonly string[],
): 'checkpoint' | 'split' {
  if (config?.mediaType === 'video') return 'split'
  const sp = config?.supportedPackaging
  if (sp && sp.length === 1) return sp[0]
  return checkpointNames.includes(name) ? 'checkpoint' : 'split'
}
