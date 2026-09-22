import type { ModelMeta, ModelMetaImage } from '@/types/models'
import type { CivitaiHit, CivitaiImage } from '@/composables/useCivitaiSearch'
import { localizedText, type LocalizedText } from '@/config/huggingface-models'
import { civitaiModelUrl } from '@/utils/constants'
import i18n from '@/i18n/vue-i18n'

const CIVITAI_CDN = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/'

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
      ...(img.nsfwLevel != null && { nsfwLevel: img.nsfwLevel }),
    })
  }
  return out
}

export function normalizeWords(words?: (string | { word: string })[]): string[] {
  if (!words?.length) return []
  return words.map(w => typeof w === 'string' ? w : w.word).filter(Boolean)
}

export interface RemoteMetaOptions {
  channel?: 'civitai' | 'huggingface'
  sourceUrl?: string
}

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
    const hfHit = h as CivitaiHit & { sourceUrl?: string; description?: LocalizedText }
    const hfVersion = h.version as { file?: { sizeBytes?: number; filename?: string } } | undefined
    meta.sourceUrl = opts?.sourceUrl ?? hfHit.sourceUrl
    meta.sourceLabel = 'Hugging Face'
    // 白名单描述是双语字段, 按当前界面语言取值 (不接入 i18n locale)
    meta.description = hfHit.description
      ? localizedText(hfHit.description, String(i18n.global.locale.value))
      : undefined
    meta.sizeBytes = hfVersion?.file?.sizeBytes
    meta.filename = hfVersion?.file?.filename
  } else {
    meta.civitaiUrl = civitaiModelUrl(h.id)
  }
  return meta
}
