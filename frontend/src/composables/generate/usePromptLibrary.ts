/**
 * usePromptLibrary — Tag library API & state composable.
 *
 * Provides:
 * - Library status check
 * - Group / subgroup / tag queries (lazy-loaded, cached)
 * - Autocomplete search (debounced via backend API)
 * - History / favorites CRUD
 */
import { ref, type Ref } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import type {
  PromptGroup,
  PromptSubgroup,
  PromptTag,
  AutocompleteItem,
  PromptHistoryItem,
  PromptHistoryPage,
  PromptLibraryStatus,
  PromptLibraryDataResponse,
} from '@/types/prompt-library'

export interface UsePromptLibraryReturn {
  status: Ref<PromptLibraryStatus | null>
  groups: Ref<PromptGroup[]>
  loading: Ref<boolean>

  fetchStatus(): Promise<PromptLibraryStatus | null>
  fetchGroups(): Promise<PromptGroup[]>
  fetchSubgroups(groupId: number): Promise<PromptSubgroup[]>
  fetchTags(subgroupId: number): Promise<PromptTag[]>
  autocomplete(query: string, limit?: number): Promise<AutocompleteItem[]>
  resolveTags(texts: string[]): Promise<Record<string, { color: string; translate: string }>>

  fetchHistory(type?: string, page?: number, size?: number): Promise<PromptHistoryPage | null>
  addHistory(positive: string, negative?: string): Promise<number | null>
  updateHistory(id: number, fields: Record<string, unknown>): Promise<boolean>
  deleteHistory(id: number): Promise<boolean>
  deleteHistoryBatch(ids: number[]): Promise<number>
  toggleFavorite(item: PromptHistoryItem): Promise<boolean>
}

export function usePromptLibrary(): UsePromptLibraryReturn {
  const { get, post, put, del } = useApiFetch()

  const status = ref<PromptLibraryStatus | null>(null)
  const groups = ref<PromptGroup[]>([])
  const loading = ref(false)

  // ── Cache ────────────────────────────────────────────────────
  const _subgroupsCache = new Map<number, PromptSubgroup[]>()
  const _tagsCache = new Map<number, PromptTag[]>()
  let _groupsLoaded = false

  // ── Status ───────────────────────────────────────────────────
  async function fetchStatus(): Promise<PromptLibraryStatus | null> {
    const resp = await get<PromptLibraryStatus>('/api/prompt-library/status')
    if (resp) status.value = resp
    return resp
  }

  // ── Tag Library Queries ──────────────────────────────────────
  async function fetchGroups(): Promise<PromptGroup[]> {
    if (_groupsLoaded) return groups.value
    loading.value = true
    try {
      const resp = await get<PromptLibraryDataResponse<PromptGroup[]>>('/api/prompt-library/groups')
      if (!resp) return groups.value // request failed — don't mark as loaded
      groups.value = resp.data ?? []
      _groupsLoaded = true
      return groups.value
    } finally {
      loading.value = false
    }
  }

  async function fetchSubgroups(groupId: number): Promise<PromptSubgroup[]> {
    const cached = _subgroupsCache.get(groupId)
    if (cached) return cached
    const resp = await get<PromptLibraryDataResponse<PromptSubgroup[]>>(
      `/api/prompt-library/subgroups?parent=${groupId}`,
    )
    if (!resp) return [] // request failed — don't cache
    const data = resp.data ?? []
    _subgroupsCache.set(groupId, data)
    return data
  }

  async function fetchTags(subgroupId: number): Promise<PromptTag[]> {
    const cached = _tagsCache.get(subgroupId)
    if (cached) return cached
    const resp = await get<PromptLibraryDataResponse<PromptTag[]>>(
      `/api/prompt-library/tags?parent=${subgroupId}`,
    )
    if (!resp) return [] // request failed — don't cache
    const data = resp.data ?? []
    _tagsCache.set(subgroupId, data)
    return data
  }

  // ── Autocomplete ─────────────────────────────────────────────
  async function autocomplete(query: string, limit = 20): Promise<AutocompleteItem[]> {
    if (!query.trim()) return []
    const resp = await get<PromptLibraryDataResponse<AutocompleteItem[]>>(
      `/api/prompt-library/autocomplete?q=${encodeURIComponent(query)}&limit=${limit}`,
    )
    return resp?.data ?? []
  }

  // ── History / Favorites ──────────────────────────────────────
  async function fetchHistory(
    type = 'all',
    page = 1,
    size = 20,
  ): Promise<PromptHistoryPage | null> {
    return get<PromptHistoryPage>(
      `/api/prompt-library/history?type=${type}&page=${page}&size=${size}`,
    )
  }

  async function addHistory(positive: string, negative = ''): Promise<number | null> {
    const resp = await post<{ success: boolean; id: number }>('/api/prompt-library/history', {
      positive,
      negative,
    })
    return resp?.id ?? null
  }

  async function updateHistory(id: number, fields: Record<string, unknown>): Promise<boolean> {
    const resp = await put<{ success: boolean }>(`/api/prompt-library/history/${id}`, fields)
    return resp?.success ?? false
  }

  async function deleteHistory(id: number): Promise<boolean> {
    const resp = await del<{ success: boolean }>(`/api/prompt-library/history/${id}`)
    return resp?.success ?? false
  }

  async function deleteHistoryBatch(ids: number[]): Promise<number> {
    const resp = await del<{ success: boolean; deleted: number }>(
      '/api/prompt-library/history/batch',
      { ids },
    )
    return resp?.deleted ?? 0
  }

  async function toggleFavorite(item: PromptHistoryItem): Promise<boolean> {
    return updateHistory(item.id, { is_favorite: item.is_favorite ? 0 : 1 })
  }

  // ── Resolve Tags (batch color/translate lookup) ──────────────
  async function resolveTags(
    texts: string[],
  ): Promise<Record<string, { color: string; translate: string }>> {
    if (!texts.length) return {}
    const resp = await post<{ data: Record<string, { color: string; translate: string }> }>(
      '/api/prompt-library/resolve',
      { texts },
    )
    return resp?.data ?? {}
  }

  return {
    status,
    groups,
    loading,
    fetchStatus,
    fetchGroups,
    fetchSubgroups,
    fetchTags,
    autocomplete,
    resolveTags,
    fetchHistory,
    addHistory,
    updateHistory,
    deleteHistory,
    deleteHistoryBatch,
    toggleFavorite,
  }
}
