import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from './useApiFetch'
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

/** Model IDs with pending POST requests (optimistic UI, cleared after API responds) */
const pendingModelIds = ref<Set<string>>(new Set())

let pollTimer: ReturnType<typeof setInterval> | null = null
let cartLoaded = false
let refreshing = false

// SSE per-task connections
const sseConnections = new Map<string, EventSource>()

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

// ── SSE Helpers ────────────────────────────────────────

/** Update a single task in-place from an SSE event (real-time progress) */
function applySSEEvent(downloadId: string, evt: Record<string, unknown>) {
  const idx = tasks.value.findIndex(t => t.download_id === downloadId)
  if (idx < 0) return
  const task = { ...tasks.value[idx] }
  if (evt.status !== undefined) task.status = evt.status as DownloadTask['status']
  if (typeof evt.progress === 'number') task.progress = evt.progress
  if (typeof evt.speed === 'number') task.speed = evt.speed
  if (typeof evt.completed_bytes === 'number') task.completed_bytes = evt.completed_bytes
  if (typeof evt.total_bytes === 'number') task.total_bytes = evt.total_bytes
  if (typeof evt.error === 'string') task.error = evt.error
  tasks.value[idx] = task
  tasks.value = [...tasks.value]
}

function openTaskSSE(downloadId: string, onTerminal: () => void) {
  if (sseConnections.has(downloadId)) return
  const source = new EventSource(`/api/downloads/${downloadId}/events`)
  sseConnections.set(downloadId, source)

  source.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.error === '任务已删除') {
        closeTaskSSE(downloadId)
        onTerminal()
        return
      }
      applySSEEvent(downloadId, data)
      if (data.status && TERMINAL_STATES.has(data.status)) {
        closeTaskSSE(downloadId)
        onTerminal()
      }
    } catch { /* ignore */ }
  }

  source.onerror = () => {
    closeTaskSSE(downloadId)
  }
}

function closeTaskSSE(downloadId: string) {
  const source = sseConnections.get(downloadId)
  if (source) {
    source.onmessage = null
    source.onerror = null
    source.close()
    sseConnections.delete(downloadId)
  }
}

function closeAllSSE() {
  for (const [id] of sseConnections) closeTaskSSE(id)
}

function syncSSEConnections(onTerminal: () => void) {
  for (const task of tasks.value) {
    if (ACTIVE_STATES.has(task.status) && !sseConnections.has(task.download_id)) {
      openTaskSSE(task.download_id, onTerminal)
    }
  }
  for (const [id] of sseConnections) {
    const task = tasks.value.find(t => t.download_id === id)
    if (!task || !ACTIVE_STATES.has(task.status)) {
      closeTaskSSE(id)
    }
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

// ── Composable ─────────────────────────────────────────

export function useDownloads() {
  const { get, post } = useApiFetch()
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

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

  /** Model IDs with active downloads — merges optimistic pending + real task state */
  const downloadingModelIds = computed(() => {
    const ids = new Set<string>(pendingModelIds.value)
    for (const t of tasks.value) {
      if (ACTIVE_STATES.has(t.status) && t.meta?.model_id) {
        ids.add(t.meta.model_id)
      }
    }
    return ids
  })

  const downloadingVersionIds = computed(() => {
    const ids = new Set<string>()
    for (const t of tasks.value) {
      if (ACTIVE_STATES.has(t.status) && t.meta?.version_id) {
        ids.add(t.meta.version_id)
      }
    }
    return ids
  })

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

  // ── Download Actions ──

  async function downloadOne(modelId: string, modelType: string, versionId?: number) {
    // Optimistic: instantly mark model as downloading (mirrors legacy doDownload behavior)
    pendingModelIds.value.add(modelId)
    pendingModelIds.value = new Set(pendingModelIds.value)

    const result = await post<{ download_id?: string; message?: string; error?: string; existed?: boolean }>(
      '/api/downloads/civitai',
      { model_id: modelId, model_type: modelType.toLowerCase(), ...(versionId && { version_id: versionId }) },
    )

    // Clear optimistic state — real state comes from tasks via refreshStatus
    pendingModelIds.value.delete(modelId)
    pendingModelIds.value = new Set(pendingModelIds.value)

    if (!result) return
    if (result.error) { toast(result.error, 'error'); return }
    if (result.existed) { toast(result.message || t('models.downloads.already_exists'), 'warning'); return }
    toast(result.message || t('models.downloads.started'), 'success')
    startPolling()
    await refreshStatus()
  }

  async function downloadAll() {
    const items = cartItems.value
    if (!items.length) return
    let ok = 0, fail = 0
    for (const item of items) {
      const result = await post<{ error?: string; existed?: boolean }>(
        '/api/downloads/civitai',
        {
          model_id: item.modelId,
          model_type: (item.type || 'Checkpoint').toLowerCase(),
          ...(item.versionId && { version_id: item.versionId }),
        },
      )
      if (result && !result.error) ok++
      else fail++
    }
    const msg = t('models.downloads.batch_result', { ok }) + (fail ? t('models.downloads.batch_fail', { fail }) : '')
    toast(msg, fail ? 'warning' : 'success')
    if (ok > 0) startPolling()
    await refreshStatus()
  }

  // ── Download Control ──

  async function pauseDownload(id: string) {
    await post(`/api/downloads/${id}/pause`)
    await refreshStatus()
  }

  async function resumeDownload(id: string) {
    await post(`/api/downloads/${id}/resume`)
    await refreshStatus()
  }

  async function cancelDownload(id: string) {
    await post(`/api/downloads/${id}/cancel`)
    await refreshStatus()
  }

  async function retryDownload(id: string) {
    await post(`/api/downloads/${id}/retry`)
    await refreshStatus()
  }

  async function pauseAll() {
    for (const t of activeTasks.value) {
      if (t.status === 'active') await post(`/api/downloads/${t.download_id}/pause`)
    }
    await refreshStatus()
  }

  async function resumeAll() {
    for (const t of pausedTasks.value) {
      await post(`/api/downloads/${t.download_id}/resume`)
    }
    await refreshStatus()
  }

  async function clearHistory() {
    await post('/api/downloads/clear')
    await refreshStatus()
    toast(t('models.downloads.history_cleared'), 'success')
  }

  // ── Status Polling + SSE ──

  async function refreshStatus() {
    if (refreshing) return
    refreshing = true
    try {
      const r = await get<{ tasks: DownloadTask[] }>('/api/downloads')
      if (!r?.tasks) return
      tasks.value = r.tasks
      // Merge completed tasks' model/version IDs into localCivitaiIds (instant, no extra API call)
      mergeCompletedIntoLocal(r.tasks)
      // Sync SSE: open for active tasks, close for terminal
      if (polling.value) syncSSEConnections(() => refreshStatus())
      // Auto-stop polling when no active/queued tasks remain
      if (polling.value && !r.tasks.some(t => ACTIVE_STATES.has(t.status))) {
        stopPolling()
      }
    } finally {
      refreshing = false
    }
  }

  function startPolling() {
    if (pollTimer) return
    polling.value = true
    fetchLocalIndex()
    refreshStatus()
    pollTimer = setInterval(refreshStatus, POLL_INTERVAL)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    polling.value = false
    closeAllSSE()
  }

  onUnmounted(stopPolling)

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
    downloadingModelIds,
    downloadingVersionIds,

    // Actions
    downloadOne,
    downloadAll,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    pauseAll,
    resumeAll,
    clearHistory,

    // Polling
    refreshStatus,
    startPolling,
    stopPolling,

    // Local model index
    localCivitaiIds,
    fetchLocalIndex,
  }
}
