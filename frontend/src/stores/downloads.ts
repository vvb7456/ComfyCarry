import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'

// ── Types ──────────────────────────────────────────────

export interface CartItem {
  modelId: string
  name: string
  type: string
  imageUrl: string
  versionId?: number
  versionName?: string
  baseModel?: string
  allVersions?: Array<{ id: number; name: string; baseModel?: string }>
}

export interface DownloadTask {
  download_id: string
  filename: string
  status: 'queued' | 'active' | 'paused' | 'complete' | 'failed' | 'cancelled'
  total_bytes: number
  completed_bytes: number
  speed: number
  progress: number
  error: string
  created_at: number
  completed_at: number
  meta: {
    source?: string
    model_id?: string
    version_id?: string
    model_name?: string
    version_name?: string
    model_type?: string
    base_model?: string
    image_url?: string
  }
}

/** Unified version-level state for UI consumption */
export type VersionState = 'idle' | 'submitting' | 'queued' | 'downloading' | 'verifying' | 'paused' | 'installed' | 'failed'

/** Version-level download info bundle: state + progress/speed/downloadId for active tasks */
export interface VersionDownloadInfo {
  state: VersionState
  progress: number
  speed: number
  downloadId: string | null
}

/** Aggregated model-level state for card display */
export type ModelAggregateState = 'idle' | 'downloading' | 'partial' | 'installed'

// ── Constants ──────────────────────────────────────────

const POLL_INTERVAL = 3000
const IDLE_DISCONNECT_MS = 60_000
const ACTIVE_STATES = new Set<string>(['active', 'queued', 'paused'])
const TERMINAL_STATES = new Set<string>(['complete', 'failed', 'cancelled'])

// ── Favorites (CartItem) ↔ API snake_case mapping ──────

interface FavoriteApi {
  model_id: string
  version_id?: number
  name?: string
  model_type?: string
  image_url?: string
  version_name?: string
  base_model?: string
  all_versions?: Array<{ id: number; name: string; baseModel?: string }>
  fav_key?: string
}

function cartToApi(item: CartItem): FavoriteApi {
  return {
    model_id: item.modelId,
    ...(item.versionId !== undefined && { version_id: item.versionId }),
    name: item.name,
    model_type: item.type,
    image_url: item.imageUrl,
    ...(item.versionName !== undefined && { version_name: item.versionName }),
    ...(item.baseModel !== undefined && { base_model: item.baseModel }),
    ...(item.allVersions && { all_versions: item.allVersions }),
  }
}

function apiToCart(f: Record<string, unknown>): CartItem {
  return {
    modelId: String(f.model_id ?? ''),
    name: String(f.name ?? ''),
    type: String(f.model_type ?? ''),
    imageUrl: String(f.image_url ?? ''),
    ...(f.version_id !== undefined && f.version_id !== null && { versionId: Number(f.version_id) }),
    ...(f.version_name !== undefined && f.version_name !== null && { versionName: String(f.version_name) }),
    ...(f.base_model !== undefined && f.base_model !== null && { baseModel: String(f.base_model) }),
    ...(Array.isArray(f.all_versions) && { allVersions: f.all_versions as Array<{ id: number; name: string; baseModel?: string }> }),
  }
}

function cartKey(modelId: string, versionId?: number): string {
  return versionId ? `${modelId}:${versionId}` : modelId
}

/** Map backend ResourceState string to frontend VersionState */
function mapResourceState(state: string): VersionState {
  switch (state) {
    case 'submit_pending': return 'submitting'
    case 'downloading': return 'downloading'
    case 'paused': return 'paused'
    case 'verifying': return 'verifying'
    case 'installed': return 'installed'
    case 'failed': return 'failed'
    case 'cancelled': return 'idle'
    case 'absent': return 'idle'
    default: return 'idle'
  }
}

// ── Store ──────────────────────────────────────────────

export const useDownloadsStore = defineStore('downloads', () => {
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  // ── State ──

  /** favorites (formerly cart): Map<cartKey, CartItem> — now backed by /api/favorites */
  const favorites = ref<Map<string, CartItem>>(new Map())

  const tasks = ref<DownloadTask[]>([])
  const polling = ref(false)

  /** civitai_model_id → Set<civitai_version_id> — built from local models API + completed tasks */
  const localCivitaiIds = ref<Map<string, Set<string>>>(new Map())

  /** Backend ResourceState map: "source:modelId:versionId" → state string */
  const resourceStates = ref<Map<string, string>>(new Map())

  /** Version IDs with pending POST requests (submitting state, before backend confirms) */
  const submittingVersionIds = ref<Set<string>>(new Set())

  // ── Connection management ──

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let globalSSE: EventSource | null = null
  /** Promise for the current in-flight refreshStatus, so callers can await the same request */
  let refreshPromise: Promise<void> | null = null
  /** Counter: >0 means a batch operation is in progress, suppress auto-stop */
  let _batchInFlight = 0

  let favoritesLoaded = false

  // ── Favorites API (C2) ──

  /** Load favorites from /api/favorites */
  async function loadFavorites(): Promise<void> {
    if (favoritesLoaded) return
    favoritesLoaded = true
    try {
      const res = await fetch('/api/favorites')
      if (!res.ok) return
      const data = await res.json()
      const list: Array<CartItem & { fav_key?: string }> = (data?.favorites || []).map((f: Record<string, unknown>) => apiToCart(f))
      const m = new Map<string, CartItem>()
      for (const item of list) {
        const key = item.fav_key
          ? String(item.fav_key)
          : cartKey(item.modelId, item.versionId)
        const { fav_key: _omit, ...pureItem } = item
        m.set(key, pureItem as CartItem)
      }
      favorites.value = m
    } catch { /* ignore */ }
  }

  async function addFavorite(item: CartItem): Promise<boolean> {
    const key = cartKey(item.modelId, item.versionId)
    if (favorites.value.has(key)) return false
    // optimistic insert
    const prev = new Map(favorites.value)
    const optimistic = new Map(prev)
    optimistic.set(key, item)
    favorites.value = optimistic
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cartToApi(item)),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d?.error || `HTTP ${res.status}`, 'error')
        favorites.value = prev
        return false
      }
      return true
    } catch (e: unknown) {
      toast((e as Error)?.message || 'Network error', 'error')
      favorites.value = prev
      return false
    }
  }

  async function removeFavorite(key: string): Promise<void> {
    if (!favorites.value.has(key)) return
    const prev = new Map(favorites.value)
    const m = new Map(prev)
    m.delete(key)
    favorites.value = m
    try {
      const res = await fetch(`/api/favorites/${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        const d = await res.json().catch(() => ({}))
        toast(d?.error || `HTTP ${res.status}`, 'error')
        favorites.value = prev
      }
    } catch (e: unknown) {
      toast((e as Error)?.message || 'Network error', 'error')
      favorites.value = prev
    }
  }

  async function removeFavoritesByModel(modelId: string): Promise<void> {
    const keys: string[] = []
    for (const [k, item] of favorites.value) {
      if (item.modelId === String(modelId) || k === String(modelId) || k.startsWith(`${String(modelId)}:`)) keys.push(k)
    }
    if (!keys.length) return
    const prev = new Map(favorites.value)
    const m = new Map(prev)
    for (const k of keys) m.delete(k)
    favorites.value = m
    try {
      const res = await fetch(`/api/favorites?model_id=${encodeURIComponent(String(modelId))}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d?.error || `HTTP ${res.status}`, 'error')
        favorites.value = prev
      }
    } catch (e: unknown) {
      toast((e as Error)?.message || 'Network error', 'error')
      favorites.value = prev
    }
  }

  async function clearFavorites(): Promise<void> {
    const prev = new Map(favorites.value)
    favorites.value = new Map()
    try {
      const res = await fetch('/api/favorites', { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d?.error || `HTTP ${res.status}`, 'error')
        favorites.value = prev
      }
    } catch (e: unknown) {
      toast((e as Error)?.message || 'Network error', 'error')
      favorites.value = prev
    }
  }

  function isInFavorites(modelId: string | number): boolean {
    const id = String(modelId)
    for (const [k] of favorites.value) {
      if (k === id || k.startsWith(`${id}:`)) return true
    }
    return false
  }

  async function updateFavoriteVersion(key: string, versionId: number, versionName: string, baseModel?: string): Promise<void> {
    const item = favorites.value.get(key)
    if (!item) return
    const updated: CartItem = { ...item, versionId, versionName, baseModel: baseModel || item.baseModel }
    const newKey = cartKey(item.modelId, versionId)
    const prev = new Map(favorites.value)
    const m = new Map(prev)
    m.delete(key)
    m.set(newKey, updated)
    favorites.value = m
    // optimistic remove old + add new via API
    try { await fetch(`/api/favorites/${encodeURIComponent(key)}`, { method: 'DELETE' }) } catch { /* ignore */ }
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cartToApi(updated)),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d?.error || `HTTP ${res.status}`, 'error')
        favorites.value = prev
      }
    } catch (e: unknown) {
      toast((e as Error)?.message || 'Network error', 'error')
      favorites.value = prev
    }
  }

  // ── SSE & Task Update ──

  /** Update a single task in-place from event data */
  function applyTaskUpdate(taskData: DownloadTask) {
    const idx = tasks.value.findIndex(t => t.download_id === taskData.download_id)
    if (idx >= 0) {
      tasks.value[idx] = taskData
      tasks.value = [...tasks.value]
    }
  }

  /** Merge a single completed task into localCivitaiIds in the same tick */
  function mergeOneTaskIntoLocal(task: DownloadTask) {
    const mid = String(task.meta.model_id)
    const vid = task.meta.version_id ? String(task.meta.version_id) : null
    let versions = localCivitaiIds.value.get(mid)
    let changed = false
    if (!versions) {
      versions = new Set()
      localCivitaiIds.value.set(mid, versions)
      changed = true
    }
    if (vid && !versions.has(vid)) {
      versions.add(vid)
      changed = true
    }
    if (changed) {
      localCivitaiIds.value = new Map(localCivitaiIds.value)
    }
  }

  /** Apply a resource update from global SSE */
  function applyResourceUpdate(data: { resource_key: string; state: string; model_id: string; version_id: string }) {
    const newMap = new Map(resourceStates.value)
    if (data.state === 'absent') {
      newMap.delete(data.resource_key)
    } else {
      newMap.set(data.resource_key, data.state)
    }
    resourceStates.value = newMap

    if (data.state === 'installed' && data.model_id) {
      const mid = String(data.model_id)
      const vid = data.version_id ? String(data.version_id) : null
      let versions = localCivitaiIds.value.get(mid)
      let changed = false
      if (!versions) {
        versions = new Set()
        localCivitaiIds.value.set(mid, versions)
        changed = true
      }
      if (vid && !versions.has(vid)) {
        versions.add(vid)
        changed = true
      }
      if (changed) {
        localCivitaiIds.value = new Map(localCivitaiIds.value)
      }
    }
  }

  // ── Global SSE Stream (SSE primary, polling fallback) ──

  function connectGlobalSSE() {
    if (globalSSE) return
    globalSSE = new EventSource('/api/downloads/stream')

    globalSSE.onopen = () => {
      // SSE connected → stop polling fallback
      stopPollTimer()
    }

    globalSSE.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        const { type, data } = event
        if (type === 'task.updated' || type === 'task.progress') {
          applyTaskUpdate(data as DownloadTask)
          if (data.status === 'complete' && data.meta?.model_id) {
            mergeOneTaskIntoLocal(data as DownloadTask)
          }
        } else if (type === 'resource.updated') {
          applyResourceUpdate(data)
        }
      } catch { /* ignore */ }
      scheduleIdleDisconnect()
    }

    globalSSE.onerror = () => {
      disconnectGlobalSSE()
      // SSE failed → start polling fallback
      startPollTimer()
      // Auto-reconnect after 3s
      setTimeout(() => {
        if (polling.value) connectGlobalSSE()
      }, 3000)
    }

    scheduleIdleDisconnect()
  }

  function disconnectGlobalSSE() {
    if (globalSSE) {
      globalSSE.onmessage = null
      globalSSE.onopen = null
      globalSSE.onerror = null
      globalSSE.close()
      globalSSE = null
    }
  }

  function startPollTimer() {
    if (pollTimer) return
    pollTimer = setInterval(refreshStatus, POLL_INTERVAL)
  }

  function stopPollTimer() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /** Schedule auto-disconnect after IDLE_DISCONNECT_MS of no activity */
  function scheduleIdleDisconnect() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      // Only disconnect when no active tasks remain
      if (!tasks.value.some(t => ACTIVE_STATES.has(t.status))) {
        stopPolling()
      } else {
        scheduleIdleDisconnect()
      }
    }, IDLE_DISCONNECT_MS)
  }

  // ── Local Model Index ──

  /** Full rebuild from /api/local_models (called once on init) */
  async function fetchLocalIndex() {
    try {
      const res = await fetch('/api/local_models?category=all')
      if (!res.ok) return
      const data = await res.json()
      const models: Array<{ civitai_id?: number | string; civitai_version_id?: number | string }> = data.models || []
      const newMap = new Map<string, Set<string>>()
      for (const m of models) {
        if (!m.civitai_id) continue
        const mid = String(m.civitai_id)
        if (!newMap.has(mid)) newMap.set(mid, new Set())
        if (m.civitai_version_id) newMap.get(mid)!.add(String(m.civitai_version_id))
      }
      localCivitaiIds.value = newMap
    } catch { /* ignore */ }
  }

  /** Incrementally merge completed tasks' meta into localCivitaiIds */
  function mergeCompletedIntoLocal(taskList: DownloadTask[]) {
    let changed = false
    for (const task of taskList) {
      if (task.status !== 'complete' || !task.meta?.model_id) continue
      const mid = String(task.meta.model_id)
      const vid = task.meta.version_id ? String(task.meta.version_id) : null
      let versions = localCivitaiIds.value.get(mid)
      if (!versions) {
        versions = new Set()
        localCivitaiIds.value.set(mid, versions)
        changed = true
      }
      if (vid && !versions.has(vid)) {
        versions.add(vid)
        changed = true
      }
    }
    if (changed) {
      localCivitaiIds.value = new Map(localCivitaiIds.value)
    }
  }

  // ── Snapshot refresh ──

  /** Refresh task list + resource states from backend snapshot */
  async function _refreshStatus(): Promise<void> {
    try {
      const res = await fetch('/api/downloads/snapshot')
      if (!res.ok) return
      const r = await res.json()

      if (r?.tasks) {
        tasks.value = r.tasks
        mergeCompletedIntoLocal(r.tasks)
      }

      if (r?.resources) {
        const newMap = new Map<string, string>()
        for (const [key, view] of Object.entries(r.resources)) {
          const v = view as { state: string; model_id?: string; version_id?: string }
          newMap.set(key, v.state)
          if (v.state === 'installed' && v.model_id) {
            const mid = String(v.model_id)
            const vid = v.version_id ? String(v.version_id) : null
            let versions = localCivitaiIds.value.get(mid)
            if (!versions) {
              versions = new Set()
              localCivitaiIds.value.set(mid, versions)
            }
            if (vid) versions.add(vid)
          }
        }
        resourceStates.value = newMap
        localCivitaiIds.value = new Map(localCivitaiIds.value)
      }

      if (polling.value && _batchInFlight === 0 && r?.tasks && !r.tasks.some((t: DownloadTask) => ACTIVE_STATES.has(t.status))) {
        stopPolling()
      }
    } catch { /* ignore network errors */ }
  }

  /** Coalescing refreshStatus: multiple callers await the same in-flight request */
  function refreshStatus(): Promise<void> {
    if (refreshPromise) return refreshPromise
    refreshPromise = _refreshStatus().finally(() => { refreshPromise = null })
    return refreshPromise
  }

  function startPolling() {
    if (polling.value) {
      // Already polling — just trigger one refresh for the new caller
      refreshStatus()
      return
    }
    polling.value = true
    fetchLocalIndex()
    refreshStatus()
    connectGlobalSSE()
    startPollTimer()
    scheduleIdleDisconnect()
  }

  function stopPolling() {
    stopPollTimer()
    polling.value = false
    disconnectGlobalSSE()
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  }

  // ── Submitting state helpers ──

  function setSubmitting(vid: string) {
    submittingVersionIds.value.add(vid)
    submittingVersionIds.value = new Set(submittingVersionIds.value)
  }

  function clearSubmitting(vid: string) {
    submittingVersionIds.value.delete(vid)
    submittingVersionIds.value = new Set(submittingVersionIds.value)
  }

  // ── Download Actions ──

  async function downloadOne(modelId: string, modelType: string, versionId?: number) {
    const vid = versionId ? String(versionId) : modelId

    setSubmitting(vid)

    let result: { download_id?: string; message?: string; error?: string; existed?: boolean } | null = null
    try {
      const res = await fetch('/api/downloads/civitai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId, model_type: modelType.toLowerCase(), ...(versionId && { version_id: versionId }) }),
      })
      if (res.status === 401) {
        clearSubmitting(vid)
        window.location.href = '/login'
        return
      }
      result = await res.json()
      if (!res.ok) {
        clearSubmitting(vid)
        toast(result?.error || `HTTP ${res.status}`, 'error')
        await refreshStatus()
        return
      }
    } catch (e: unknown) {
      clearSubmitting(vid)
      toast((e as Error)?.message || 'Network error', 'error')
      return
    }

    if (!result) { clearSubmitting(vid); return }
    if (result.error) {
      clearSubmitting(vid)
      toast(result.error, 'error')
      await refreshStatus()
      return
    }
    if (result.existed) {
      toast(result.message || t('models.downloads.already_exists') || 'Already exists', 'warning')
      await refreshStatus()
      clearSubmitting(vid)
      return
    }

    toast(result.message || t('models.downloads.started') || 'Download started', 'success')
    startPolling()
    await refreshStatus()
    clearSubmitting(vid)
  }

  async function downloadAllFromFavorites() {
    const allItems = [...favorites.value.values()]
    const items = allItems.filter(item => {
      if (!item.versionId) return true
      return getVersionState(item.modelId, item.versionId) !== 'installed'
    })
    if (!items.length) return

    for (const item of items) {
      setSubmitting(item.versionId ? String(item.versionId) : item.modelId)
    }

    _batchInFlight++
    startPolling()

    let ok = 0, fail = 0
    for (const item of items) {
      const vid = item.versionId ? String(item.versionId) : item.modelId
      try {
        const res = await fetch('/api/downloads/civitai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model_id: item.modelId,
            model_type: (item.type || 'Checkpoint').toLowerCase(),
            ...(item.versionId && { version_id: item.versionId }),
          }),
        })
        const data = await res.json()
        clearSubmitting(vid)
        if (res.ok && !data.error) ok++
        else fail++
      } catch {
        clearSubmitting(vid)
        fail++
      }
    }

    _batchInFlight--

    const msg = (t('models.downloads.batch_result', { ok }) || `${ok} started`)
      + (fail ? (t('models.downloads.batch_fail', { fail }) || `, ${fail} failed`) : '')
    toast(msg, fail ? 'warning' : 'success')
    await refreshStatus()
  }

  // ── Download Control ──

  async function _postControl(url: string) {
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    } catch { /* ignore */ }
    await refreshStatus()
  }

  async function pauseDownload(id: string) { await _postControl(`/api/downloads/${id}/pause`) }
  async function resumeDownload(id: string) { await _postControl(`/api/downloads/${id}/resume`) }
  async function cancelDownload(id: string) { await _postControl(`/api/downloads/${id}/cancel`) }

  async function retryDownload(id: string) {
    try {
      const res = await fetch(`/api/downloads/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data?.error) {
        toast(data.error, 'error')
      } else {
        toast(data.message || t('models.downloads.started') || 'Retrying', 'success')
        startPolling()
      }
    } catch (e: unknown) {
      toast((e as Error)?.message || 'Network error', 'error')
    }
    await refreshStatus()
  }

  async function pauseAll() {
    for (const t of tasks.value) {
      if (t.status === 'active') await _postControl(`/api/downloads/${t.download_id}/pause`)
    }
  }

  /**
   * Unified retry entrypoint for version-scoped UI (cards / modals).
   * If a download task still exists in the list → retryDownload(id) (engine retry);
   * otherwise → downloadOne re-submits from scratch.
   */
  async function retryVersion(modelId: string, modelType: string, versionId?: number) {
    const mid = String(modelId)
    const vid = versionId ? String(versionId) : mid
    const existing = tasks.value.find(t => {
      const tvid = t.meta?.version_id ? String(t.meta.version_id) : null
      const tmid = t.meta?.model_id ? String(t.meta.model_id) : null
      return (tvid === vid || (!tvid && tmid === mid)) && t.status === 'failed'
    })
    if (existing) {
      await retryDownload(existing.download_id)
    } else {
      await downloadOne(modelId, modelType, versionId)
    }
  }

  async function resumeAll() {
    for (const t of tasks.value) {
      if (t.status === 'paused') await _postControl(`/api/downloads/${t.download_id}/resume`)
    }
  }

  async function clearHistory() {
    await _postControl('/api/downloads/clear')
    toast(t('models.downloads.history_cleared') || 'History cleared', 'success')
  }

  // ── Selectors (pure functions reading state) ──

  /**
   * Get the unified state for a specific version.
   * Priority: submitting > resourceStates > active task > local index > idle
   */
  function getVersionState(modelId: string | number, versionId: string | number): VersionState {
    const mid = String(modelId)
    const vid = String(versionId)

    if (submittingVersionIds.value.has(vid)) return 'submitting'

    const resourceKey = `civitai:${mid}:${vid}`
    const rState = resourceStates.value.get(resourceKey)
    if (rState) {
      const mapped = mapResourceState(rState)
      if (mapped !== 'idle') return mapped
    }

    for (const task of tasks.value) {
      const taskVid = task.meta?.version_id ? String(task.meta.version_id) : null
      const taskMid = task.meta?.model_id ? String(task.meta.model_id) : null
      if (taskVid === vid || (!taskVid && taskMid === mid)) {
        if (task.status === 'active' || task.status === 'queued') return 'downloading'
        if (task.status === 'paused') return 'paused'
        if (task.status === 'failed') return 'failed'
        if (task.status === 'complete') return 'installed'
      }
    }

    const localVersions = localCivitaiIds.value.get(mid)
    if (localVersions?.has(vid)) return 'installed'

    return 'idle'
  }

  /**
   * Get aggregated state for a model across its versions.
   */
  function getModelAggregateState(modelId: string | number, versionIds: (string | number)[]): ModelAggregateState {
    const mid = String(modelId)
    let anyDownloading = false
    let anyInstalled = false
    let allInstalled = versionIds.length > 0

    for (const vid of versionIds) {
      const state = getVersionState(mid, vid)
      if (state === 'submitting' || state === 'queued' || state === 'downloading' || state === 'verifying' || state === 'paused') anyDownloading = true
      if (state === 'installed') anyInstalled = true
      else allInstalled = false
    }

    if (allInstalled && versionIds.length > 0) return 'installed'
    if (anyDownloading) return 'downloading'
    if (anyInstalled) return 'partial'
    return 'idle'
  }

  /**
   * Get version-level download info bundle (state + progress/speed/downloadId).
   */
  function getVersionDownloadInfo(modelId: string | number, versionId: string | number): VersionDownloadInfo {
    const mid = String(modelId)
    const vid = String(versionId)
    const state = getVersionState(mid, vid)

    const task = tasks.value.find(t => {
      const taskVid = t.meta?.version_id ? String(t.meta.version_id) : null
      const taskMid = t.meta?.model_id ? String(t.meta.model_id) : null
      return taskVid === vid || (!taskVid && taskMid === mid)
    })

    if (task && (task.status === 'active' || task.status === 'queued' || task.status === 'paused')) {
      return {
        state,
        progress: Math.min(Math.max(task.progress || 0, 0), 100),
        speed: task.speed || 0,
        downloadId: task.download_id,
      }
    }

    return { state, progress: 0, speed: 0, downloadId: null }
  }

  /** Watch a download task's status until it reaches a terminal state.
   *  Resolves immediately if task already terminal or not found.
   *  Used by useModelDependency (C1 wait-chain re-source). */
  function watchTaskTerminal(downloadId: string): Promise<'complete' | 'failed' | 'cancelled' | 'absent'> {
    return new Promise((resolve) => {
      const existing = tasks.value.find(t => t.download_id === downloadId)
      if (!existing) {
        // Maybe already cleared; check snapshot once
        refreshStatus().then(() => {
          const t = tasks.value.find(x => x.download_id === downloadId)
          if (!t) { resolve('absent'); return }
          if (TERMINAL_STATES.has(t.status)) { resolve(t.status as 'complete' | 'failed' | 'cancelled'); return }
          subscribe()
        })
        return
      }
      if (TERMINAL_STATES.has(existing.status)) {
        resolve(existing.status as 'complete' | 'failed' | 'cancelled')
        return
      }
      subscribe()

      function subscribe() {
        const stop = watch(
          () => tasks.value.find(t => t.download_id === downloadId)?.status,
          (st) => {
            if (st && TERMINAL_STATES.has(st)) {
              stop()
              resolve(st as 'complete' | 'failed' | 'cancelled')
            }
          },
          { immediate: false },
        )
      }
    })
  }

  // ── Computed ──

  const favoritesItems = computed(() => [...favorites.value.values()])
  const favoritesCount = computed(() => favorites.value.size)

  const activeTasks = computed(() =>
    tasks.value.filter(t => t.status === 'active' || t.status === 'queued'),
  )
  const pausedTasks = computed(() =>
    tasks.value.filter(t => t.status === 'paused'),
  )
  const completedTasks = computed(() =>
    tasks.value.filter(t => t.status === 'complete'),
  )
  const failedTasks = computed(() =>
    tasks.value.filter(t => t.status === 'failed'),
  )

  return {
    // State
    favorites,
    tasks,
    polling,
    localCivitaiIds,
    resourceStates,
    submittingVersionIds,

    // Favorites (formerly cart) — API-backed
    favoritesItems,
    favoritesCount,
    loadFavorites,
    addFavorite,
    removeFavorite,
    removeFavoritesByModel,
    clearFavorites,
    isInFavorites,
    updateFavoriteVersion,

    // Tasks
    activeTasks,
    pausedTasks,
    completedTasks,
    failedTasks,

    // Selectors
    getVersionState,
    getVersionDownloadInfo,
    getModelAggregateState,

    // Actions
    downloadOne,
    downloadAll: downloadAllFromFavorites,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    retryVersion,
    pauseAll,
    resumeAll,
    clearHistory,

    // Connection
    refreshStatus,
    startPolling,
    stopPolling,

    // Local model index
    fetchLocalIndex,

    // Wait-chain helper for useModelDependency
    watchTaskTerminal,
  }
})
