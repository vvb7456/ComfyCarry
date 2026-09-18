import { ref, computed, type Ref } from 'vue'
import { useApiFetch } from './useApiFetch'
import { errorMessage } from '@/utils/errorMessage'

// ── Types ──────────────────────────────────────────────

export interface CivitaiImage {
  url: string
  type?: string
  /** 图级 NSFW 分级 (1=SFW, 2/4/8/16/32=NSFW); hide/blur 判断依据 */
  nsfwLevel?: string | number
  meta?: {
    seed?: number | string
    steps?: number
    cfgScale?: number
    sampler?: string
    prompt?: string
    negativePrompt?: string
  }
}

export interface CivitaiHit {
  id: number
  name: string
  type: string
  metrics?: { downloadCount?: number; thumbsUpCount?: number }
  images?: CivitaiImage[]
  version?: {
    id: number
    name: string
    baseModel?: string
    images?: CivitaiImage[]
    trainedWords?: (string | { word: string })[]
    hashes?: Record<string, string>
  }
  versions?: Array<{
    id: number
    name: string
    baseModel?: string
    images?: CivitaiImage[]
    trainedWords?: (string | { word: string })[]
    hashes?: Record<string, string>
  }>
  user?: { username?: string }
  nsfwLevel?: string | number
  availability?: string
}

export interface FacetOption {
  value: string
  label: string
  count: number
}

export type SortKey = 'Relevancy' | 'Most Downloaded' | 'Highest Rated' | 'Newest'

// ── Constants ──────────────────────────────────────────

const PAGE_SIZE = 20

const SORT_MAP: Record<SortKey, string[]> = {
  'Relevancy': [],
  'Most Downloaded': ['metrics.downloadCount:desc'],
  'Highest Rated': ['metrics.thumbsUpCount:desc'],
  'Newest': ['createdAt:desc'],
}

const TYPE_LABELS: Record<string, string> = {
  Checkpoint: 'Checkpoint',
  LORA: 'LORA',
  TextualInversion: 'Embedding',
  Controlnet: 'ControlNet',
  Upscaler: 'Upscaler',
  VAE: 'VAE',
  Poses: 'Poses',
}

const ATTRIBUTES_TO_RETRIEVE = [
  'id', 'name', 'type', 'metrics', 'images', 'version', 'versions',
  'lastVersionAtUnix', 'user', 'nsfwLevel', 'availability',
]

// ── Helpers ────────────────────────────────────────────

/** Check if every part of the query is a numeric ID or CivitAI URL */
function isIdQuery(text: string): boolean {
  const parts = text.split(/[,\s\n]+/).filter(p => p.trim())
  if (parts.length === 0) return false
  return parts.every(p =>
    /^\d+$/.test(p.trim()) || /civitai\.com\/models\/\d+/.test(p.trim()),
  )
}

/** Parse model IDs & version IDs from text (IDs + URLs) */
function parseIds(text: string): Array<{ id: number; versionId?: number }> {
  const parts = text.split(/[,\s\n]+/).filter(p => p.trim())
  const seen = new Set<string>()
  const result: Array<{ id: number; versionId?: number }> = []

  for (const part of parts) {
    const p = part.trim()
    let id: number | undefined
    let versionId: number | undefined

    const urlMatch = p.match(/civitai\.com\/models\/(\d+)/)
    if (urlMatch) {
      id = Number(urlMatch[1])
      const vMatch = p.match(/[?&]modelVersionId=(\d+)/)
      if (vMatch) versionId = Number(vMatch[1])
    } else if (/^\d+$/.test(p)) {
      id = Number(p)
    }

    if (id != null) {
      const key = versionId ? `${id}:${versionId}` : String(id)
      if (!seen.has(key)) {
        seen.add(key)
        result.push({ id, versionId })
      }
    }
  }
  return result
}

// ── CivitAI v1 API raw response types ──────────────────
// 字段类型经 2026-09 实测 (代理 /api/civitai/model/{id} 直连 civitai.com v1)
// 与官方 OpenAPI (developer.civitai.com) 双重核对: nsfwLevel 为整数位掩码,
// creator 可为 null, trainedWords 实测可为 null (官方文档标 string[])。

/** CivitAI v1 /models/{id} 返回的原始图片结构 */
export interface CivitaiApiImage {
  url: string
  type?: string
  nsfwLevel?: number
}

/** CivitAI v1 API 的原始 modelVersion 结构 (仅含前端用到的字段) */
export interface CivitaiApiVersion {
  id: number
  name?: string
  baseModel?: string
  images?: CivitaiApiImage[]
  trainedWords?: string[] | null
}

/** CivitAI v1 API 的原始 model 结构 (仅含前端用到的字段) */
export interface CivitaiApiModel {
  id: number
  name?: string
  type?: string
  nsfwLevel?: number
  nsfw?: boolean
  availability?: string
  stats?: { downloadCount?: number; thumbsUpCount?: number }
  creator?: { username?: string } | null
  images?: CivitaiApiImage[]
  modelVersions?: CivitaiApiVersion[]
}

/** Meilisearch multi-search 请求体中的一个 query */
interface MeiliSearchQuery {
  indexUid: string
  q: string
  limit: number
  offset: number
  filter?: string[]
  sort?: string[]
  attributesToRetrieve?: string[]
  attributesToHighlight?: string[]
  facets?: string[]
}

/** Meilisearch multi-search 响应中的一个 hit (civitai models_v9 索引)。
 *  与 CivitaiHit 的差异: nsfwLevel 是位掩码数组, hashes 是字符串数组, url 可为相对路径。 */
export interface MeiliCivitaiHit {
  id: number
  name?: string
  type?: string
  metrics?: { downloadCount?: number; thumbsUpCount?: number }
  images?: Array<{ url: string; type?: string; nsfwLevel?: number }>
  version?: {
    id: number
    name?: string
    baseModel?: string
    images?: CivitaiImage[]
    trainedWords?: string[]
    hashes?: string[]
  }
  versions?: Array<{
    id: number
    name?: string
    baseModel?: string
    images?: CivitaiImage[]
    trainedWords?: string[]
    hashes?: string[]
  }>
  user?: { username?: string } | null
  nsfwLevel?: number[]
  availability?: string
}

/** Meilisearch multi-search 响应中的一个 result */
interface MeiliSearchResult {
  hits?: MeiliCivitaiHit[]
  estimatedTotalHits?: number
  facetDistribution?: Record<string, Record<string, number>>
}

/** /api/search 代理的 Meilisearch multi-search 响应体 */
interface MeiliMultiSearchResponse {
  results?: MeiliSearchResult[]
}

/** Meilisearch hit → CivitaiHit。
 *  索引里的字段与 v1 API 形态不同: nsfwLevel 是位掩码数组 (取首个作图级判定),
 *  hashes 是纯字符串数组 (Map 成 {SHA256}), name/type 缺失时兜底。 */
function normalizeMeiliHit(h: MeiliCivitaiHit): CivitaiHit {
  const verImages = h.version?.images
  const hitImages = h.images?.length ? h.images : verImages
  return {
    id: h.id,
    name: h.name ?? 'Unknown',
    type: h.type ?? 'Checkpoint',
    metrics: h.metrics,
    images: hitImages,
    version: h.version
      ? {
          id: h.version.id,
          name: h.version.name ?? '',
          baseModel: h.version.baseModel,
          images: verImages,
          trainedWords: h.version.trainedWords,
          hashes: toHashRecord(h.version.hashes),
        }
      : undefined,
    versions: h.versions?.map(v => ({
      id: v.id,
      name: v.name ?? '',
      baseModel: v.baseModel,
      images: v.images,
      trainedWords: v.trainedWords,
      hashes: toHashRecord(v.hashes),
    })),
    user: h.user?.username ? { username: h.user.username } : undefined,
    nsfwLevel: h.nsfwLevel?.[0],
    availability: h.availability,
  }
}

/** Meili hashes 是字符串数组 (首项为短哈希); 前端只消费 SHA256,
 *  数组里无法区分算法 —— 取最长项 (SHA256=64hex) 作 SHA256, 缺失时不设。 */
function toHashRecord(hashes?: string[]): Record<string, string> | undefined {
  if (!hashes?.length) return undefined
  const sha256 = hashes.reduce((a, b) => (b.length > a.length ? b : a))
  return { SHA256: sha256 }
}

/** Normalize a CivitAI v1 API model response to match CivitaiHit shape */
function normalizeApiModel(m: CivitaiApiModel): CivitaiHit {
  const latestVersion = m.modelVersions?.[0]
  const toImages = (imgs?: CivitaiApiImage[]): CivitaiImage[] | undefined =>
    imgs?.map(img => ({ url: img.url, type: img.type, nsfwLevel: img.nsfwLevel }))
  return {
    id: m.id,
    name: m.name ?? 'Unknown',
    type: m.type ?? 'Checkpoint',
    metrics: {
      downloadCount: m.stats?.downloadCount,
      thumbsUpCount: m.stats?.thumbsUpCount,
    },
    images: toImages(latestVersion?.images),
    version: latestVersion
      ? {
          id: latestVersion.id,
          name: latestVersion.name ?? '',
          baseModel: latestVersion.baseModel,
          images: toImages(latestVersion.images),
        }
      : undefined,
    versions: m.modelVersions?.map(v => ({
      id: v.id,
      name: v.name ?? '',
      baseModel: v.baseModel,
      images: toImages(v.images),
    })),
    user: m.creator?.username ? { username: m.creator.username } : undefined,
    nsfwLevel: m.nsfwLevel,
    availability: m.availability,
  }
}

// ── Composable ─────────────────────────────────────────

export function useCivitaiSearch(sortKey: Ref<SortKey>) {
  const { post } = useApiFetch()

  // ── Reactive State ──
  const hits = ref<CivitaiHit[]>([])
  const loading = ref(false)
  const totalHits = ref(0)
  const page = ref(0)
  const lastQuery = ref('')
  const errorMsg = ref('')

  // Facets
  const typeFacets = ref<FacetOption[]>([])
  const baseModelFacets = ref<FacetOption[]>([])
  const selectedTypes = ref<string[]>([])
  const selectedBaseModels = ref<string[]>([])
  const facetsLoaded = ref(false)

  // Internal guards
  let _facetsPromise: Promise<void> | null = null
  let _searchId = 0
  const initialSearchDone = ref(false)

  // Derived
  const hasMore = computed(() => (page.value + 1) * PAGE_SIZE < totalHits.value)

  // ── Build Meilisearch filter array ──
  function buildFilter(): string[] {
    const filters: string[] = []
    if (selectedTypes.value.length > 0) {
      filters.push(selectedTypes.value.map(t => `type = "${t}"`).join(' OR '))
    }
    if (selectedBaseModels.value.length > 0) {
      filters.push(selectedBaseModels.value.map(b => `version.baseModel = "${b}"`).join(' OR '))
    }
    return filters
  }

  // ── Meilisearch text search ──
  async function searchMeili(query: string, pageNum: number, append: boolean) {
    const mySearchId = _searchId
    const sort = SORT_MAP[sortKey.value] ?? []
    // Empty query + Relevancy → fallback to Most Downloaded
    const effectiveSort = (!query && sort.length === 0)
      ? SORT_MAP['Most Downloaded']
      : sort

    const filter = buildFilter()
    const body = {
      queries: [{
        indexUid: 'models_v9',
        q: query,
        limit: PAGE_SIZE,
        offset: pageNum * PAGE_SIZE,
        ...(filter.length > 0 ? { filter } : {}),
        sort: effectiveSort,
        attributesToRetrieve: ATTRIBUTES_TO_RETRIEVE,
        attributesToHighlight: ['name'],
      } satisfies MeiliSearchQuery],
    }

    const data = await post<MeiliMultiSearchResponse>('/api/search', body)
    if (_searchId !== mySearchId) return false
    if (!data?.results?.[0]) return false

    const result = data.results[0]
    const newHits: CivitaiHit[] = (result.hits ?? []).map(normalizeMeiliHit)

    if (append) {
      hits.value = [...hits.value, ...newHits]
    } else {
      hits.value = newHits
    }

    totalHits.value = result.estimatedTotalHits ?? 0
    return true
  }

  // ── CivitAI ID lookup via backend proxy ──
  async function lookupByIds(text: string) {
    const mySearchId = _searchId
    const parsed = parseIds(text)
    const results: CivitaiHit[] = []

    for (const { id, versionId } of parsed) {
      if (_searchId !== mySearchId) return
      try {
        const res = await fetch(`/api/civitai/model/${id}`)
        if (res.ok) {
          const data = await res.json() as CivitaiApiModel
          const hit = normalizeApiModel(data)
          // If URL specified a versionId, select that version
          if (versionId && data.modelVersions) {
            const match = data.modelVersions.find(v => v.id === versionId)
            if (match) {
              hit.version = {
                id: match.id,
                name: match.name ?? '',
                baseModel: match.baseModel,
                images: match.images?.map(img => ({ url: img.url, type: img.type, nsfwLevel: img.nsfwLevel })),
              }
              hit.images = match.images?.map(img => ({ url: img.url, type: img.type, nsfwLevel: img.nsfwLevel }))
            }
          }
          results.push(hit)
        }
      } catch (e) {
        console.error(`CivitAI lookup failed for ID ${id}:`, e)
      }
    }

    if (_searchId !== mySearchId) return
    hits.value = results
    totalHits.value = results.length
  }

  // ── Smart search dispatcher ──
  async function search(query: string) {
    const q = query.trim()
    const mySearchId = ++_searchId
    loading.value = true
    errorMsg.value = ''
    page.value = 0
    lastQuery.value = q

    try {
      if (q && isIdQuery(q)) {
        await lookupByIds(q)
      } else {
        await searchMeili(q, 0, false)
      }
    } catch (e: unknown) {
      errorMsg.value = errorMessage(e) || 'Search failed'
      console.error('Search error:', e)
    } finally {
      if (_searchId === mySearchId) loading.value = false
    }
  }

  // ── Load next page (infinite scroll) ──
  async function loadMore() {
    if (loading.value || !hasMore.value) return
    // ID lookup has no pagination
    if (lastQuery.value && isIdQuery(lastQuery.value)) return

    loading.value = true
    const mySearchId = _searchId
    const nextPage = page.value + 1

    try {
      const applied = await searchMeili(lastQuery.value, nextPage, true)
      if (applied && _searchId === mySearchId) page.value = nextPage
    } catch (e: unknown) {
      if (_searchId === mySearchId) errorMsg.value = errorMessage(e) || '加载更多失败'
    } finally {
      if (_searchId === mySearchId) loading.value = false
    }
  }

  // ── Facets ──
  function updateFacets(dist: Record<string, Record<string, number>>) {
    if (dist.type) {
      typeFacets.value = Object.entries(dist.type)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({
          value,
          label: TYPE_LABELS[value] ?? value,
          count,
        }))
    }
    if (dist['version.baseModel']) {
      baseModelFacets.value = Object.entries(dist['version.baseModel'])
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({
          value,
          label: value,
          count,
        }))
    }
    facetsLoaded.value = true
  }

  /** Load facets via an empty search (no query, no filters).
   *  Deduplicates concurrent calls (same promise reuse pattern). */
  async function loadFacets() {
    if (facetsLoaded.value) return
    if (_facetsPromise) return _facetsPromise

    _facetsPromise = (async () => {
      const body = {
        queries: [{
          indexUid: 'models_v9',
          q: '',
          limit: 0,
          offset: 0,
          facets: ['type', 'version.baseModel'],
        } satisfies MeiliSearchQuery],
      }

      const data = await post<MeiliMultiSearchResponse>('/api/search', body)
      if (data?.results?.[0]?.facetDistribution) {
        updateFacets(data.results[0].facetDistribution)
      } else {
        _facetsPromise = null
      }
    })().catch(() => { _facetsPromise = null })

    return _facetsPromise
  }

  /** Load facets then run initial empty search (first tab activation). */
  async function activate() {
    await loadFacets()
    if (!initialSearchDone.value) {
      initialSearchDone.value = true
      await search('')
    }
  }

  /** Apply a filter selection without issuing a request. The toolbar owns the
   * draft values and calls search() once the user presses its Apply button. */
  function applyFilters(types: string[], baseModels: string[]) {
    selectedTypes.value = [...types]
    selectedBaseModels.value = [...baseModels]
  }

  return {
    // State
    hits,
    loading,
    totalHits,
    hasMore,
    errorMsg,
    lastQuery,

    // Facets
    typeFacets,
    baseModelFacets,
    selectedTypes,
    selectedBaseModels,
    facetsLoaded,

    // Methods
    search,
    applyFilters,
    loadMore,
    loadFacets,
    activate,
  }
}
