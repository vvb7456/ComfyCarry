import { ref, computed, watch, type Ref } from 'vue'
import { useApiFetch } from './useApiFetch'

// ── Types ──────────────────────────────────────────────

export interface CivitaiImage {
  url: string
  type?: string
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

/** Normalize a CivitAI v1 API model response to match CivitaiHit shape */
function normalizeApiModel(m: any): CivitaiHit {
  const latestVersion = m.modelVersions?.[0]
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    metrics: {
      downloadCount: m.stats?.downloadCount,
      thumbsUpCount: m.stats?.thumbsUpCount,
    },
    images: latestVersion?.images?.map((img: any) => ({
      url: img.url,
      type: img.type,
    })),
    version: latestVersion
      ? {
          id: latestVersion.id,
          name: latestVersion.name,
          baseModel: latestVersion.baseModel,
          images: latestVersion.images?.map((img: any) => ({
            url: img.url,
            type: img.type,
          })),
        }
      : undefined,
    versions: m.modelVersions?.map((v: any) => ({
      id: v.id,
      name: v.name,
      baseModel: v.baseModel,
      images: v.images?.map((img: any) => ({ url: img.url, type: img.type })),
    })),
    user: m.creator ? { username: m.creator.username } : undefined,
    nsfwLevel: m.nsfwLevel ?? m.nsfw,
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

  // Results cache (modelId → hit) for metadata lookups
  const cache = new Map<number, CivitaiHit>()

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
      }],
    }

    const data = await post<any>('/api/search', body as any)
    if (_searchId !== mySearchId) return
    if (!data?.results?.[0]) return

    const result = data.results[0]
    const newHits: CivitaiHit[] = result.hits ?? []

    // Cache hits
    for (const h of newHits) {
      cache.set(h.id, h)
    }

    if (append) {
      hits.value = [...hits.value, ...newHits]
    } else {
      hits.value = newHits
    }

    totalHits.value = result.estimatedTotalHits ?? 0
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
          const data = await res.json()
          const hit = normalizeApiModel(data)
          // If URL specified a versionId, select that version
          if (versionId && data.modelVersions) {
            const match = data.modelVersions.find((v: any) => v.id === versionId)
            if (match) {
              hit.version = {
                id: match.id,
                name: match.name,
                baseModel: match.baseModel,
                images: match.images?.map((img: any) => ({ url: img.url, type: img.type })),
              }
              hit.images = match.images?.map((img: any) => ({ url: img.url, type: img.type }))
            }
          }
          cache.set(hit.id, hit)
          results.push(hit)
        }
      } catch (e) {
        console.error(`CivitAI lookup failed for ID ${id}:`, e)
      }
    }

    hits.value = results
    totalHits.value = results.length
  }

  // ── Smart search dispatcher ──
  async function search(query: string) {
    const q = query.trim()
    ++_searchId
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
    } catch (e: any) {
      errorMsg.value = e?.message || 'Search failed'
      console.error('Search error:', e)
    } finally {
      loading.value = false
    }
  }

  // ── Load next page (infinite scroll) ──
  async function loadMore() {
    if (loading.value || !hasMore.value) return
    // ID lookup has no pagination
    if (lastQuery.value && isIdQuery(lastQuery.value)) return

    loading.value = true
    const nextPage = page.value + 1

    try {
      await searchMeili(lastQuery.value, nextPage, true)
      page.value = nextPage
    } catch (e: any) {
      errorMsg.value = e?.message || '加载更多失败'
    } finally {
      loading.value = false
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
   *  Deduplicates concurrent calls (same promise reuse pattern as legacy). */
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
        }],
      }

      const data = await post<any>('/api/search', body as any)
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

  // ── Get cached hit ──
  function getCached(modelId: number): CivitaiHit | undefined {
    return cache.get(modelId)
  }

  // ── Re-search when sort or filters change ──
  watch(sortKey, () => {
    if (hits.value.length > 0 || lastQuery.value) {
      search(lastQuery.value)
    }
  })

  watch([selectedTypes, selectedBaseModels], () => {
    if (hits.value.length > 0 || lastQuery.value) {
      search(lastQuery.value)
    }
  })

  // ── Reset all state ──
  function reset() {
    hits.value = []
    loading.value = false
    totalHits.value = 0
    page.value = 0
    lastQuery.value = ''
    errorMsg.value = ''
    selectedTypes.value = []
    selectedBaseModels.value = []
    initialSearchDone.value = false
    _facetsPromise = null
    cache.clear()
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
    loadMore,
    loadFacets,
    activate,
    getCached,
    reset,
  }
}
