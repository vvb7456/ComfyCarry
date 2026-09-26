import { computed, ref } from 'vue'
import { useGenerateStore } from '@/stores/generate'
import { MODEL_TYPES } from '@/config/model-types'
import { HUGGINGFACE_MODELS } from '@/config/huggingface-models'
import type { HuggingFaceFile, HuggingFaceModel, HuggingFaceVersion } from '@/config/huggingface-models'

/**
 * 导入后「这份配置还差什么」的清单。
 *
 * 范围 = 配置里引用的、本机不存在的模型。判定来自 store: restore 的校验链按
 * 本机文件逐个核对引用, 缺的记入 missingRefs (引用保留, 只是标记)。
 *
 * 取货来源按固定顺序检索 (指纹表里只有哈希, 没有来源):
 *   1. 本机已有 (restore 校验通过) —— 不进清单
 *   2. 指纹表无此键 → unknown → 只能手动准备
 *   3. 白名单哈希索引命中 → 可下载, 名称取白名单元数据
 *   4. civitai by-hash 命中且 files 里哈希精确一致 → 可下载, 名称取响应
 *   5. 双命中 → 白名单优先
 *
 * 下载一律沿用既有端点与请求体 (白名单走 huggingface 通道, civitai 走模型页
 * 同款请求体); 本模块不拼下载 URL、不造端点。
 */

export interface MissingModel {
  /** 去重键: `<category>/<配置里的文件名字符串>` */
  key: string
  /** 展示标题 (白名单/civitai 命中取元数据名; unknown 取文件名) */
  name: string
  /** 配置引用的原值 (完整相对路径), 兼作副行事实 */
  path: string
  /** 展示角色 (i18n key 后缀 `generate.missing.role_<role>`) */
  role: string
  baseModel: string
  /** 预览图 (白名单/civitai 命中取元数据图; unknown 无) */
  imageUrl: string
  /** 落盘/登记类别 (MODEL_DIRS key) */
  category: HuggingFaceFile['modelType']
  source: 'whitelist' | 'civitai' | 'unknown'
  modelId: string
  versionId: string
}

/** 插槽字段 → 展示角色 (i18n key 后缀), 与生成页各面板名称对齐 */
const ROLE_OF_FIELD: Record<string, string> = {
  checkpoint: 'checkpoint',
  unet: 'unet',
  unetHigh: 'unet_high',
  unetLow: 'unet_low',
  clip: 'clip',
  clip2: 'clip2',
  vae: 'vae',
  vaeOverride: 'vae',
  audioVae: 'audio_vae',
  loras: 'lora',
  'controlNets.pose.model': 'controlnet',
  'controlNets.canny.model': 'controlnet',
  'controlNets.depth.model': 'controlnet',
  'upscale.svrModel': 'upscale_model',
  'faceDetailer.detectionModel': 'face_model',
}

/**
 * 字段 → 落盘/登记类别 (取值 = MODEL_DIRS 的 key, 见 comfycarry/config.py)。
 * clip/vae 系列当前由 restore 直接置空 (单值主键, 缺件另有依赖条提示), 不会被
 * 标记缺失; 保留映射以便将来校验口径变化时不必再补一份。
 */
const FIELD_CATEGORY: Record<string, HuggingFaceFile['modelType']> = {
  checkpoint: 'checkpoints',
  unet: 'diffusion_models',
  unetHigh: 'diffusion_models',
  unetLow: 'diffusion_models',
  clip: 'text_encoders',
  clip2: 'text_encoders',
  vae: 'vae',
  vaeOverride: 'vae',
  audioVae: 'vae',
  loras: 'loras',
  'controlNets.pose.model': 'controlnet',
  'controlNets.canny.model': 'controlnet',
  'controlNets.depth.model': 'controlnet',
  // SeedVR2 DiT 权重落在 models/SEEDVR2/ (MODEL_DIRS 键 'seedvr2'); 若按
  // 'upscale_models' 取货会下到 models/upscale_models/, SeedVR2LoadDiTModel
  // 读不到 → 配置仍跑不起来。
  'upscale.svrModel': 'seedvr2',
  'faceDetailer.detectionModel': 'ultralytics_bbox',
}

/** 白名单哈希索引: sha256(小写) → 条目。构建一次, 比较时两侧统一小写。 */
const WHITELIST_BY_SHA256: ReadonlyMap<string, { model: HuggingFaceModel; version: HuggingFaceVersion }> = (() => {
  const m = new Map<string, { model: HuggingFaceModel; version: HuggingFaceVersion }>()
  for (const model of HUGGINGFACE_MODELS) {
    for (const version of model.versions) {
      const sha = version.file.sha256?.toLowerCase()
      if (sha) m.set(sha, { model, version })
    }
  }
  return m
})()

/** civitai by-hash 查询结果 (归一化版本详情) */
interface CivitaiByHash {
  model_id: number | string
  version_id: number | string
  model_name: string
  version_name: string
  base_model: string
  files: Array<{ name?: string; hashes?: Record<string, string> }>
  images?: Array<{ url?: string }>
}

/** 查询超时: 到点即把未返回的归入「需手动」, 不让 modal 一直转 */
const LOOKUP_TIMEOUT_MS = 8000

function basename(name: string): string {
  return name.split('/').pop() || name
}

// 模块级共享状态: GeneratePage 与 MissingModelsModal 各调一次本组合式, 二者
// 必须看到同一份清单 (页面持 visible/分区列表, modal 触发 prepare) —— 各自持
// 一份副本会让 modal 解析出的结果传不回页面的展示列表。
const dismissed = ref(false)
/** 指纹表 (表2); 非空即视为「本实例曾导入配置」 */
const hashes = ref<Record<string, string>>({})
const imported = ref(false)
/** 解析完成后的缺失清单 (prepare 前为空) */
const resolved = ref<MissingModel[]>([])
/** 打开后的查询进行中 (列表展示前先转圈, 避免内容跳变) */
const loading = ref(false)
/** 下载能力复核缓存: civitai model_id → {版本id: 是否可下载}; null = 未拿到判据 */
const flagsCache = new Map<string, Record<string, boolean> | null>()
/** by-hash 查询缓存: sha256(小写) → 结果 (查不到存 null) */
const byHashCache = new Map<string, CivitaiByHash | null>()

export function useMissingModels() {
  const store = useGenerateStore()

  /** 带超时的 fetch: 到点抛错, 由调用方按「查不到」处理 */
  async function fetchWithTimeout(url: string): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), LOOKUP_TIMEOUT_MS)
    try {
      return await fetch(url, { signal: ctl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  /** 拉取表2 (只读)。非空即视为导入过 —— 与旧 modelMeta 的「是否导入」判据同义。 */
  async function loadHashes(): Promise<void> {
    try {
      const res = await fetch('/api/generate/model-hashes')
      if (!res.ok) return
      const data = await res.json() as { hashes?: Record<string, string> }
      hashes.value = data?.hashes ?? {}
      imported.value = Object.keys(hashes.value).length > 0
    } catch {
      // 拉不到按空表: 缺失项全部落入手动列表, 不阻塞弹窗
    }
  }

  /** 表2里取指纹。精确键查不到时按 basename 后缀兜底:
   *  配置引用可能是裸文件名 (face_yolov8m.pt), 而登记行的键带子目录前缀
   *  (ultralytics/bbox/face_yolov8m.pt —— 父根先扫, 键的 category 随登记行),
   *  两边 category 口径对不上。指纹表是"按字节取货"的索引, 键只是它的住址,
   *  落盘路径以配置槽为准 —— 故后缀命中即可认定同一文件。
   *  多行同 basename 时无法区分 → 只认唯一命中。 */
  function hashOfKey(key: string, refValue: string): string | undefined {
    const exact = hashes.value[key]
    if (exact) return exact
    const name = basename(refValue)
    const hits = Object.entries(hashes.value)
      .filter(([k]) => k.endsWith(`/${name}`) || k === name)
    return hits.length === 1 ? hits[0]![1] : undefined
  }

  /** 查一个哈希的 civitai 版本详情 (按哈希缓存); 未命中/超时 → null */
  async function lookupByHash(sha256: string): Promise<CivitaiByHash | null> {
    const digest = sha256.toLowerCase()
    const cached = byHashCache.get(digest)
    if (cached !== undefined) return cached

    let result: CivitaiByHash | null = null
    try {
      const res = await fetchWithTimeout(`/api/civitai/by-hash/${encodeURIComponent(digest)}`)
      if (res.ok) {
        const data = await res.json() as CivitaiByHash
        if (data?.model_id != null && data?.version_id != null) result = data
      }
    } catch {
      result = null
    }
    byHashCache.set(digest, result)
    return result
  }

  /** 下载能力复核: 沿用模型页同款判据; 未拿到判据按不可下载 */
  async function lookupFlags(modelId: string): Promise<Record<string, boolean> | null> {
    if (!modelId) return null
    const cached = flagsCache.get(modelId)
    if (cached !== undefined) return cached

    let flags: Record<string, boolean> | null = null
    try {
      const res = await fetchWithTimeout(`/api/civitai/model/${encodeURIComponent(modelId)}/download_flags`)
      if (res.ok) {
        const data = await res.json() as { flags?: Record<string, boolean>; resolved?: boolean }
        if (data?.resolved) flags = data.flags ?? {}
      }
    } catch {
      flags = null
    }
    flagsCache.set(modelId, flags)
    return flags
  }

  /** 解析一条缺失引用 → 最终展示行 (来源已定, 下载能力已复核) */
  async function resolveItem(field: string, refValue: string): Promise<MissingModel> {
    const category = FIELD_CATEGORY[field] ?? ('' as HuggingFaceFile['modelType'])
    const key = `${category}/${refValue}`
    const base: MissingModel = {
      key, name: basename(refValue), path: refValue,
      role: ROLE_OF_FIELD[field] ?? '', baseModel: '',
      imageUrl: '',
      category, source: 'unknown', modelId: '', versionId: '',
    }

    const sha = hashOfKey(key, refValue)
    if (!sha) return base

    // 白名单哈希索引命中 (双命中时优先)
    const wl = WHITELIST_BY_SHA256.get(sha.toLowerCase())
    if (wl) {
      return {
        ...base,
        name: wl.version.name ? `${wl.model.name} — ${wl.version.name}` : wl.model.name,
        baseModel: wl.version.baseModel,
        imageUrl: wl.model.images[0]?.url || wl.version.images[0]?.url || '',
        source: 'whitelist',
        modelId: String(wl.model.id),
        versionId: String(wl.version.id),
      }
    }

    // civitai by-hash: 命中后必须在 files 里找到哈希精确一致的那个文件 ——
    // 只认 model_id/version_id 不够, 同一版本可能含多个文件 (high/low、VAE 等)。
    const hit = await lookupByHash(sha)
    if (!hit) return base
    const match = hit.files?.find(f => f.hashes?.SHA256?.toLowerCase() === sha.toLowerCase())
    if (!match) return base

    const modelId = String(hit.model_id)
    const versionId = String(hit.version_id)
    const flags = await lookupFlags(modelId)
    // fail-closed 是刻意选择: 弹窗语义是「确认可下才给按钮」, 判据拿不到
    // (Generation-Only 探测接口抖动等) 宁可归手动列表, 不给一个点了会失败的按钮
    if (!flags || flags[versionId] !== true) return base

    return {
      ...base,
      name: hit.version_name ? `${hit.model_name} — ${hit.version_name}` : hit.model_name,
      baseModel: hit.base_model,
      imageUrl: hit.images?.[0]?.url || '',
      source: 'civitai',
      modelId,
      versionId,
    }
  }

  /** 去重后的缺失条目 (同步可得, 供 visible 判定; 不含检索结果) */
  const refEntries = computed<Array<{ field: string; name: string; key: string }>>(() => {
    const seen = new Set<string>()
    const out: Array<{ field: string; name: string; key: string }> = []
    for (const r of store.missingRefs) {
      if (r.arch && !MODEL_TYPES[r.arch]) continue
      const category = FIELD_CATEGORY[r.field] ?? ''
      const key = `${category}/${r.name}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ field: r.field, name: r.name, key })
    }
    return out
  })

  /** 可下载 / 需手动, 供 modal 分区展示 */
  const downloadable = computed<MissingModel[]>(() => resolved.value.filter(m => m.source !== 'unknown'))
  const unavailable = computed<MissingModel[]>(() => resolved.value.filter(m => m.source === 'unknown'))

  /**
   * 展示前把全部缺失项解析完 (表2 + 白名单索引 + civitai by-hash + 判据),
   * 列表一次成型, 不跳变。
   */
  async function prepare() {
    loading.value = true
    try {
      await loadHashes()
      // 并发解析: 串行会让最坏情况叠加成 N×8s 的转圈
      resolved.value = await Promise.all(
        refEntries.value.map(entry => resolveItem(entry.field, entry.name)),
      )
    } finally {
      loading.value = false
    }
  }

  /**
   * 「忽略无效设置并回退到默认语义」: 把缺失引用从状态里剔除。
   * 删除是**用户显式选择** —— 系统装载时不替用户销毁配置, 但用户可以清理。
   */
  function ignoreAndFallback() {
    store.pruneMissing()
    resolved.value = []
    dismiss()
  }

  function dismiss() {
    dismissed.value = true
  }

  /** 有缺失、来自导入、且用户未关闭过 → 自动展示 modal */
  const visible = computed(() =>
    !dismissed.value && imported.value && refEntries.value.length > 0,
  )

  return {
    resolved,
    downloadable,
    unavailable,
    visible,
    loading,
    prepare,
    loadHashes,
    imported,
    ignoreAndFallback,
    dismiss,
  }
}
