import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from './useToast'

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
export type VersionState = 'idle' | 'submitting' | 'downloading' | 'paused' | 'installed' | 'failed'

/** Aggregated model-level state for card display */
export type ModelAggregateState = 'idle' | 'downloading' | 'partial' | 'installed'

// ── Constants ──────────────────────────────────────────

const STORAGE_KEY = 'civitai_cart'
const POLL_INTERVAL = 3000
const ACTIVE_STATES = new Set<string>(['active', 'queued', 'paused'])
const TERMINAL_STATES = new Set<string>(['complete', 'failed', 'cancelled'])

// ── Singleton State ────────────────────────────────────

const cart = ref<Map<string, CartItem>>(new Map())
const tasks = ref<DownloadTask[]>([])
const polling = ref(false)

/** civitai_model_id → Set<civitai_version_id> — built from local models API + completed tasks */
const localCivitaiIds = ref<Map<string, Set<string>>>(new Map())

/** Backend ResourceState map: "source:modelId:versionId" → state string */
const resourceStates = ref<Map<string, string>>(new Map())

/** Version IDs with pending POST requests (submitting state, before backend confirms) */
const submittingVersionIds = ref<Set<string>>(new Set())

let pollTimer: ReturnType<typeof setInterval> | null = null
let cartLoaded = false
/** Promise for the current in-flight refreshStatus, so callers can await the same request */
let refreshPromise: Promise<void> | null = null
/** Counter: >0 means a batch operation is in progress, suppress auto-stop */
let _batchInFlight = 0

// Global SSE stream connection (replaces per-task SSE)
let globalSSE: EventSource | null = null

// Late-bound toast/i18n (set by first useDownloads() call in component setup context)
let _toast: ReturnType<typeof useToast>['toast'] | null = null
let _t: ReturnType<typeof useI18n>['t'] | null = null

// ── Cart Helpers ───────────────────────────────────────

function cartKey(modelId: string, versionId?: number): string {
  return versionId ? `${modelId}:${versionId}` : modelId
}

function loadCart() {
  if (cartLoaded) return
  cartLoaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (Array.isArray(data)) {
      cart.value = new Map(data)
    } else if (typeof data === 'object') {
      cart.value = new Map(Object.entries(data))
    }
  } catch { /* ignore corrupt data */ }
}

function saveCart() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cart.value.entries()]))
  } catch { /* ignore */ }
}

// ── SSE & Task Update ──────────────────────────────────

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
  // Update resourceStates map
  const newMap = new Map(resourceStates.value)
  if (data.state === 'absent') {
    newMap.delete(data.resource_key)
  } else {
    newMap.set(data.resource_key, data.state)
  }
  resourceStates.value = newMap

  // When installed, also merge into localCivitaiIds for backward compatibility
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

// ── Global SSE Stream ──────────────────────────────────

function connectGlobalSSE() {
  if (globalSSE) return

  globalSSE = new EventSource('/api/downloads/stream')

  globalSSE.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data)
      const { type, data } = event

      if (type === 'task.updated' || type === 'task.progress') {
        applyTaskUpdate(data as DownloadTask)
        // When task completes, merge into local (fallback for when resource.updated arrives late)
        if (data.status === 'complete' && data.meta?.model_id) {
          mergeOneTaskIntoLocal(data as DownloadTask)
        }
      } else if (type === 'resource.updated') {
        applyResourceUpdate(data)
      }
    } catch { /* ignore */ }
  }

  globalSSE.onerror = () => {
    disconnectGlobalSSE()
    // Auto-reconnect after 3s
    setTimeout(() => {
      if (polling.value) connectGlobalSSE()
    }, 3000)
  }
}

function disconnectGlobalSSE() {
  if (globalSSE) {
    globalSSE.onmessage = null
    globalSSE.onerror = null
    globalSSE.close()
    globalSSE = null
  }
}

// ── Local Model Index ──────────────────────────────────

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

// ── Module-level Polling (singleton, no per-instance closures) ──

/** Refresh task list + resource states from backend snapshot */
async function _refreshStatus(): Promise<void> {
  try {
    const res = await fetch('/api/downloads/snapshot')
    if (!res.ok) return
    const r = await res.json()

    // Update tasks
    if (r?.tasks) {
      tasks.value = r.tasks
      mergeCompletedIntoLocal(r.tasks)
    }

    // Update resource states from snapshot
    if (r?.resources) {
      const newMap = new Map<string, string>()
      for (const [key, view] of Object.entries(r.resources)) {
        const v = view as { state: string; model_id?: string; version_id?: string }
        newMap.set(key, v.state)
        // Also merge installed resources into localCivitaiIds
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
      localCivitaiIds.value = new Map(localCivitaiIds.value) // trigger reactivity
    }

    // Auto-stop polling when no active tasks remain (unless batch is in progress)
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
  if (pollTimer) {
    // Already polling — just trigger one refresh for the new caller
    refreshStatus()
    return
  }
  polling.value = true
  fetchLocalIndex()
  refreshStatus()
  connectGlobalSSE()
  pollTimer = setInterval(refreshStatus, POLL_INTERVAL)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  polling.value = false
  disconnectGlobalSSE()
}

// ── Submitting state helpers ───────────────────────────

function setSubmitting(vid: string) {
  submittingVersionIds.value.add(vid)
  submittingVersionIds.value = new Set(submittingVersionIds.value)
}

function clearSubmitting(vid: string) {
  submittingVersionIds.value.delete(vid)
  submittingVersionIds.value = new Set(submittingVersionIds.value)
}

// ── Module-level Download Actions ──────────────────────

async function downloadOne(modelId: string, modelType: string, versionId?: number) {
  const vid = versionId ? String(versionId) : modelId

  // Submitting: immediately mark version
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
      _toast?.(result?.error || `HTTP ${res.status}`, 'error')
      await refreshStatus()
      return
    }
  } catch (e: unknown) {
    clearSubmitting(vid)
    _toast?.((e as Error)?.message || 'Network error', 'error')
    return
  }

  if (!result) { clearSubmitting(vid); return }
  if (result.error) {
    clearSubmitting(vid)
    _toast?.(result.error, 'error')
    await refreshStatus()
    return
  }
  if (result.existed) {
    _toast?.(result.message || _t?.('models.downloads.already_exists') || 'Already exists', 'warning')
    await refreshStatus()
    clearSubmitting(vid)
    return
  }

  // Success: start polling, refresh to pick up task, then clear submitting
  _toast?.(result.message || _t?.('models.downloads.started') || 'Download started', 'success')
  startPolling()
  await refreshStatus()
  clearSubmitting(vid)
}

async function downloadAllFromCart() {
  const allItems = [...cart.value.values()]
  // Skip items that are already installed locally
  const items = allItems.filter(item => {
    if (!item.versionId) return true
    return getVersionState(item.modelId, item.versionId) !== 'installed'
  })
  if (!items.length) return

  // Mark all as submitting
  for (const item of items) {
    setSubmitting(item.versionId ? String(item.versionId) : item.modelId)
  }

  // Guard: prevent auto-stop during batch
  _batchInFlight++

  // Start polling + SSE before submitting so real-time events arrive during batch
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

  const msg = (_t?.('models.downloads.batch_result', { ok }) || `${ok} started`)
    + (fail ? (_t?.('models.downloads.batch_fail', { fail }) || `, ${fail} failed`) : '')
  _toast?.(msg, fail ? 'warning' : 'success')
  await refreshStatus()
}

// ── Module-level Download Control ──────────────────────

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
      _toast?.(data.error, 'error')
    } else {
      _toast?.(data.message || _t?.('models.downloads.started') || 'Retrying', 'success')
      startPolling()
    }
  } catch (e: unknown) {
    _toast?.((e as Error)?.message || 'Network error', 'error')
  }
  await refreshStatus()
}

async function pauseAll() {
  for (const t of tasks.value) {
    if (t.status === 'active') await _postControl(`/api/downloads/${t.download_id}/pause`)
  }
}

async function resumeAll() {
  for (const t of tasks.value) {
    if (t.status === 'paused') await _postControl(`/api/downloads/${t.download_id}/resume`)
  }
}

async function clearHistory() {
  await _postControl('/api/downloads/clear')
  _toast?.(_t?.('models.downloads.history_cleared') || 'History cleared', 'success')
}

// ── Selectors (pure functions reading singleton refs) ──

/**
 * Get the unified state for a specific version.
 * Priority: submitting > resourceStates > active task > local index > idle
 * State is monotonically non-regressing: downloading never goes back to idle.
 */
function getVersionState(modelId: string | number, versionId: string | number): VersionState {
  const mid = String(modelId)
  const vid = String(versionId)

  // 1. Submitting (user just clicked, backend hasn't confirmed yet)
  if (submittingVersionIds.value.has(vid)) return 'submitting'

  // 2. Backend resource state (authoritative, from global SSE / snapshot)
  const resourceKey = `civitai:${mid}:${vid}`
  const rState = resourceStates.value.get(resourceKey)
  if (rState) {
    const mapped = mapResourceState(rState)
    if (mapped !== 'idle') return mapped
  }

  // 3. Active task exists for this version (fallback for legacy/non-resource tasks)
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

  // 4. Local index (files already on disk)
  const localVersions = localCivitaiIds.value.get(mid)
  if (localVersions?.has(vid)) return 'installed'

  return 'idle'
}

/** Map backend ResourceState string to frontend VersionState */
function mapResourceState(state: string): VersionState {
  switch (state) {
    case 'submit_pending': return 'submitting'
    case 'downloading': return 'downloading'
    case 'paused': return 'paused'
    case 'verifying': return 'downloading' // show as downloading (with spinner)
    case 'installed': return 'installed'
    case 'failed': return 'failed'
    case 'cancelled': return 'idle'
    case 'absent': return 'idle'
    default: return 'idle'
  }
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
    if (state === 'submitting' || state === 'downloading' || state === 'paused') anyDownloading = true
    if (state === 'installed') anyInstalled = true
    else allInstalled = false
  }

  if (allInstalled && versionIds.length > 0) return 'installed'
  if (anyDownloading) return 'downloading'
  if (anyInstalled) return 'partial'
  return 'idle'
}

// ── Composable ─────────────────────────────────────────

export function useDownloads() {
  // Late-bind toast & i18n on first setup-context call
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })
  _toast = toast
  _t = t

  loadCart()

  // ── Computed ──

  const cartItems = computed(() => [...cart.value.values()])
  const cartCount = computed(() => cart.value.size)

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

  // ── Cart CRUD ──

  function addToCart(item: CartItem) {
    const key = cartKey(item.modelId, item.versionId)
    if (cart.value.has(key)) return false
    cart.value.set(key, item)
    cart.value = new Map(cart.value)
    saveCart()
    return true
  }

  function removeFromCart(key: string) {
    cart.value.delete(key)
    cart.value = new Map(cart.value)
    saveCart()
  }

  function isInCart(modelId: string | number): boolean {
    const id = String(modelId)
    for (const [k] of cart.value) {
      if (k === id || k.startsWith(`${id}:`)) return true
    }
    return false
  }

  function clearCart() {
    cart.value = new Map()
    saveCart()
  }

  function updateCartVersion(key: string, versionId: number, versionName: string, baseModel?: string) {
    const item = cart.value.get(key)
    if (!item) return
    cart.value.delete(key)
    const updated = { ...item, versionId, versionName, baseModel: baseModel || item.baseModel }
    const newKey = cartKey(item.modelId, versionId)
    cart.value.set(newKey, updated)
    cart.value = new Map(cart.value)
    saveCart()
  }

  return {
    // Cart
    cart,
    cartItems,
    cartCount,
    addToCart,
    removeFromCart,
    isInCart,
    clearCart,
    updateCartVersion,

    // Tasks
    tasks,
    activeTasks,
    pausedTasks,
    completedTasks,
    failedTasks,

    // Selectors (primary API for UI state)
    getVersionState,
    getModelAggregateState,

    // Actions (module-level singletons)
    downloadOne,
    downloadAll: downloadAllFromCart,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    pauseAll,
    resumeAll,
    clearHistory,

    // Polling (module-level singletons)
    refreshStatus,
    startPolling,
    stopPolling,

    // Local model index
    localCivitaiIds,
    fetchLocalIndex,
  }
}
