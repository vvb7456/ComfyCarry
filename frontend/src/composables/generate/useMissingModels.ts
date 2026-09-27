import { computed, ref, getCurrentScope, onScopeDispose } from 'vue'
import { useDownloadsStore } from '@/stores/downloads'
import { useGenerateStore } from '@/stores/generate'
import { MODEL_TYPES } from '@/config/model-types'
import { HUGGINGFACE_MODELS } from '@/config/huggingface-models'
import type { HuggingFaceFile, HuggingFaceModel, HuggingFaceVersion } from '@/config/huggingface-models'
import type { WorkspaceFile } from './workspaceFiles'

/**
 * 导入后「这份配置还差什么」的清单。
 *
 * 范围 = 工作区 files 引用的全部文件；通过下载服务按原路径检查磁盘。
 *
 * 取货来源按固定顺序检索 (指纹表里只有哈希, 没有来源):
 *   1. 本机已有 (restore 校验通过) —— 不进清单
 *   2. 指纹表无此键 → unknown → 只能手动准备
 *   3. 白名单哈希索引命中 → 可下载, 名称取白名单元数据
 *   4. civitai by-hash 命中且 files 里哈希精确一致 → 可下载, 名称取响应
 *   5. 双命中 → 白名单优先
 *
 * 下载沿用下载服务，指定原路径以跳过目录推断。
 */

export interface MissingModel {
  /** 去重键为原路径。 */
  key: string
  /** 展示标题 (白名单/civitai 命中取元数据名; unknown 取文件名) */
  name: string
  /** 带根标记的文件地址或实例内绝对路径。 */
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
  const downloads = useDownloadsStore()
  if (getCurrentScope()) onScopeDispose(downloads.subscribe())
  const missingPaths = computed(() => new Set(store.restoredFiles
    .filter(file => downloads.fileChecks.has(file.path) && downloads.getFileDownloadInfo(file.path).state !== 'installed')
    .map(file => file.path)))

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
    await checkFiles().catch(() => {})
  }

  async function checkFiles(): Promise<void> {
    const paths = [...new Set(store.restoredFiles.map(file => file.path))]
    await downloads.checkFiles(paths)
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
  async function resolveItem(file: WorkspaceFile): Promise<MissingModel> {
    const { field, path: refValue } = file
    const category = file.category as HuggingFaceFile['modelType']
    const key = refValue
    const base: MissingModel = {
      key, name: basename(refValue), path: refValue,
      role: ROLE_OF_FIELD[field] ?? (field.startsWith('upscale.') ? 'upscale_model'
        : field.startsWith('controlNets.') ? 'controlnet'
        : field.startsWith('faceDetailer.') ? 'face_model'
        : field.startsWith('fast.') ? 'lora' : ''), baseModel: '',
      imageUrl: '',
      category, source: 'unknown', modelId: '', versionId: '',
    }

    const sha = hashes.value[file.path]
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
  const refEntries = computed<WorkspaceFile[]>(() => {
    const seen = new Set<string>()
    const out: WorkspaceFile[] = []
    for (const r of store.restoredFiles) {
      if (r.arch && !MODEL_TYPES[r.arch]) continue
      const key = r.path
      if (!missingPaths.value.has(key)) continue
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
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
        refEntries.value.map(resolveItem),
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
    store.pruneMissing(missingPaths.value)
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
    checkFiles,
    isMissing: (path: string) => missingPaths.value.has(path),
    imported,
    ignoreAndFallback,
    dismiss,
  }
}
