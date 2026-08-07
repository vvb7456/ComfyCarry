import type { ModelMeta, ModelMetaImage } from '@/types/models'
import type { CivitaiHit, CivitaiImage } from '@/composables/useCivitaiSearch'

// ── 远程模型 → ModelMeta 转换 ─────────────────────────────────────────────
// CivitAI 标签页与 Hugging Face 标签页共用的展示模型转换逻辑。两个标签页都把
// 远程条目适配到同一 ModelMeta 结构后交给卡片、详情弹窗和下载流程复用。
// channel='civitai' 时输出字段与旧 CivitaiTab 内实现完全一致;channel='huggingface'
// 时不再设置 civitaiUrl,改用 sourceUrl/sourceLabel 描述模型来源页面。

const CIVITAI_CDN = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/'

/** 图片转换:绝对 http(s) URL 原样透传(兼容 HF 绝对地址),相对路径拼 CivitAI CDN 前缀。 */
export function convertImages(imgs: CivitaiImage[]): ModelMetaImage[] {
  const out: ModelMetaImage[] = []
  for (const img of imgs) {
    if (!img.url) continue
    const url = img.url.startsWith('http')
      ? img.url
      : `${CIVITAI_CDN}${img.url}/default.jpg`
    const m = img.meta
    out.push({
      url,
      type: img.type,
      ...(m && {
        seed: m.seed,
        steps: m.steps,
        cfg: m.cfgScale,
        sampler: m.sampler,
        positive: m.prompt,
        negative: m.negativePrompt,
      }),
    })
  }
  return out
}

/** 触发词归一化:兼容字符串数组与 { word } 对象数组。 */
export function normalizeWords(words?: (string | { word: string })[]): string[] {
  if (!words?.length) return []
  return words.map(w => typeof w === 'string' ? w : w.word).filter(Boolean)
}

export interface RemoteMetaOptions {
  /** 来源渠道,默认 'civitai'。 */
  channel?: 'civitai' | 'huggingface'
  /** Hugging Face 模型页面 URL;缺省时回退读取 hit 上的 sourceUrl 字段。 */
  sourceUrl?: string
}

/**
 * 远程条目 → ModelMeta。CivitAI 标签页传默认 channel('civitai'),
 * Hugging Face 标签页传 channel('huggingface') 并携带模型页面 URL。
 */
export function remoteHitToMeta(h: CivitaiHit, opts?: RemoteMetaOptions): ModelMeta {
  const channel = opts?.channel ?? 'civitai'
  const allImgs = h.images?.length ? h.images : (h.version?.images || [])
  const meta: ModelMeta = {
    name: h.name || 'Unknown',
    type: h.type,
    baseModel: h.version?.baseModel,
    id: h.id,
    versionId: h.version?.id,
    versionName: h.version?.name,
    author: h.user?.username,
    stats: {
      downloads: h.metrics?.downloadCount,
      likes: h.metrics?.thumbsUpCount,
    },
    trainedWords: normalizeWords(h.version?.trainedWords),
    images: convertImages(allImgs),
    versions: (h.versions || []).map(v => ({
      id: v.id,
      name: v.name,
      baseModel: v.baseModel,
      images: convertImages(v.images || []),
      trainedWords: normalizeWords(v.trainedWords),
      hashes: v.hashes,
    })),
    channel,
  }
  if (channel === 'huggingface') {
    const hfHit = h as CivitaiHit & { sourceUrl?: string; description?: string }
    const hfVersion = h.version as { file?: { sizeBytes?: number; filename?: string } } | undefined
    meta.sourceUrl = opts?.sourceUrl ?? hfHit.sourceUrl
    meta.sourceLabel = 'Hugging Face'
    meta.description = hfHit.description
    meta.sizeBytes = hfVersion?.file?.sizeBytes
    meta.filename = hfVersion?.file?.filename
  } else {
    meta.civitaiUrl = `https://civitai.com/models/${h.id}`
  }
  return meta
}
