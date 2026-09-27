import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { apiErrorText, apiMessageText } from '@/utils/apiError'
import { errorMessage } from '@/utils/errorMessage'
import { buildHuggingFaceDownloadBody } from '@/utils/hfDownload'
import { joinFilePath, normalizeFilePath } from '@/utils/filePath'
import type { PendingFile, DirOption } from '@/components/models/DownloadDirModal.vue'
import { HUGGINGFACE_MODELS } from '@/config/huggingface-models'
import type { HuggingFaceModel, HuggingFaceVersion } from '@/config/huggingface-models'

/** 后端 409 needs_classification 的载荷 —— 等待用户裁决目录的一次下载提交。 */
export interface PendingClassification {
  modelId: string
  modelType: string
  versionId?: number
  displayName: string
  civitaiUrl: string
  files: PendingFile[]
  dirOptions: DirOption[]
  /** 二次提交时带回的落盘文件名 (生成页缺失弹窗按配置引用覆写时需要; 模型页缺省不设) */
  customFilename?: string
}

export interface FavoriteItem {
  modelId: string
  name: string
  type: string
  imageUrl: string
  versionId?: number
  versionName?: string
  baseModel?: string
  /** 收藏来源 (civitai / huggingface)。后端暂不持久化, 收藏重载后靠 modelId 负号兜底识别 */
  source?: string
  allVersions?: Array<{ id: number; name: string; baseModel?: string }>
}

export interface DownloadTask {
  download_id: string
  save_dir: string
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

export type VersionState = 'idle' | 'submitting' | 'queued' | 'downloading' | 'verifying' | 'paused' | 'installed' | 'failed'

export interface VersionDownloadInfo {
  state: VersionState
  progress: number
  speed: number
  downloadId: string | null
}

export type ModelAggregateState = 'idle' | 'downloading' | 'partial' | 'installed'

const POLL_INTERVAL = 3000
const IDLE_DISCONNECT_MS = 60_000
const ACTIVE_STATES = new Set<string>(['active', 'queued', 'paused'])

interface FileCheck {
  path?: string
  installed: boolean
  downloading?: boolean
  download_id?: string | null
}

interface ResourceUpdate {
  resource_key: string
  state: string
  active_task_id?: string | null
}

function taskPath(task: DownloadTask): string {
  return task.save_dir ? joinFilePath(task.save_dir, task.filename) : ''
}

function taskInfo(task: DownloadTask): VersionDownloadInfo {
  const states: Record<DownloadTask['status'], VersionState> = {
    active: 'downloading', queued: 'queued', paused: 'paused', complete: 'installed', failed: 'failed', cancelled: 'idle',
  }
  return { state: states[task.status], progress: Math.min(100, Math.max(0, task.progress || 0)), speed: task.speed || 0,
    downloadId: task.download_id }
}

const idleInfo = (): VersionDownloadInfo => ({ state: 'idle', progress: 0, speed: 0, downloadId: null })

interface FavoriteApi {
  model_id: string
  version_id?: number
  name?: string
  model_type?: string
  image_url?: string
  version_name?: string
  base_model?: string
  source?: string
  all_versions?: Array<{ id: number; name: string; baseModel?: string }>
  fav_key?: string
}

function favoriteToApi(item: FavoriteItem): FavoriteApi {
  return {
    model_id: item.modelId,
    ...(item.versionId !== undefined && { version_id: item.versionId }),
    name: item.name,
    model_type: item.type,
    image_url: item.imageUrl,
    ...(item.versionName !== undefined && { version_name: item.versionName }),
    ...(item.baseModel !== undefined && { base_model: item.baseModel }),
    ...(item.source !== undefined && { source: item.source }),
    ...(item.allVersions && { all_versions: item.allVersions }),
  }
}

function apiToFavorite(f: Record<string, unknown>): FavoriteItem {
  return {
    modelId: String(f.model_id ?? ''),
    name: String(f.name ?? ''),
    type: String(f.model_type ?? ''),
    imageUrl: String(f.image_url ?? ''),
    ...(f.source !== undefined && f.source !== null && { source: String(f.source) }),
    ...(f.version_id !== undefined && f.version_id !== null && { versionId: Number(f.version_id) }),
    ...(f.version_name !== undefined && f.version_name !== null && { versionName: String(f.version_name) }),
    ...(f.base_model !== undefined && f.base_model !== null && { baseModel: String(f.base_model) }),
    ...(Array.isArray(f.all_versions) && { allVersions: f.all_versions as Array<{ id: number; name: string; baseModel?: string }> }),
  }
}

function favoriteKey(modelId: string, versionId?: number): string {
  return versionId ? `${modelId}:${versionId}` : modelId
}

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

/** 白名单采用内部稳定负整数 ID，与文件发布平台无关。 */
function isHuggingFaceId(modelId: number | string): boolean {
  return Number(modelId) < 0
}

/** 白名单版本查找: 版本号缺省或未命中时回落默认版本 model.version */
function findHuggingFaceVersion(
  modelId: number | string,
  versionId?: number | string,
): { model: HuggingFaceModel; version: HuggingFaceVersion } | null {
  const mid = Number(modelId)
  const model = HUGGINGFACE_MODELS.find(m => m.id === mid)
  if (!model) return null
  const vid = versionId != null ? Number(versionId) : model.version.id
  const version = model.versions.find(v => v.id === vid) || model.version
  return { model, version }
}

/** 后端资源 key 前缀：白名单内部 ID 与 CivitAI 平台 ID 分开。 */
function sourcePrefixFor(modelId: number | string): 'whitelist' | 'civitai' {
  return isHuggingFaceId(modelId) ? 'whitelist' : 'civitai'
}

function resourceKeyFor(modelId: number | string, versionId: number | string): string {
  return `${sourcePrefixFor(modelId)}:${String(modelId)}:${String(versionId)}`
}

export const useDownloadsStore = defineStore('downloads', () => {
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  const favorites = ref<Map<string, FavoriteItem>>(new Map())

  const tasks = ref<DownloadTask[]>([])
  const polling = ref(false)

  /**
   * 资源状态 (服务端下发, 已按磁盘现状派生): resource_key → state。
   *
   * 这是「已下载/已删除」的唯一判据 —— 服务端从 models 表 (扫盘对账维护)
   * 派生, 而不是从前端的本地索引缓存推断。"在不在磁盘上"没有本地缓存,
   * 因此不存在缓存过期导致的误报 (曾经因此把已删文件显示为已下载)。
   */
  const resourceStates = ref<Map<string, string>>(new Map())
  const resourceTaskIds = ref(new Map<string, string>())
  const fileChecks = ref(new Map<string, FileCheck>())
  const submittingPaths = ref(new Set<string>())
  const knownFiles = new Set<string>()
  const queuedChecks = new Set<string>()
  let fileCheckPromise: Promise<void> | null = null
  let revision = 0
  const taskRevisions = new Map<string, number>()
  const resourceRevisions = new Map<string, number>()
  let subscribers = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const submittingVersionIds = ref<Set<string>>(new Set())

  const pendingClassification = ref<PendingClassification | null>(null)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let globalSSE: EventSource | null = null
  let refreshPromise: Promise<void> | null = null
  /** Counter: >0 means a batch operation is in progress, suppress auto-stop */
  let _batchInFlight = 0

  let favoritesLoaded = false

  async function loadFavorites(): Promise<void> {
    if (favoritesLoaded) return
    favoritesLoaded = true
    try {
      const res = await fetch('/api/favorites')
      if (!res.ok) return
      const data = await res.json()
      const list: Array<FavoriteItem & { fav_key?: string }> = (data?.favorites || []).map((f: Record<string, unknown>) => apiToFavorite(f))
      const m = new Map<string, FavoriteItem>()
      for (const item of list) {
        const key = item.fav_key
          ? String(item.fav_key)
          : favoriteKey(item.modelId, item.versionId)
        const { fav_key: _omit, ...pureItem } = item
        m.set(key, pureItem as FavoriteItem)
      }
      favorites.value = m
    } catch { /* ignore */ }
  }

  async function addFavorite(item: FavoriteItem): Promise<boolean> {
    const key = favoriteKey(item.modelId, item.versionId)
    if (favorites.value.has(key)) return false
    const prev = new Map(favorites.value)
    const optimistic = new Map(prev)
    optimistic.set(key, item)
    favorites.value = optimistic
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(favoriteToApi(item)),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(apiErrorText(d, `HTTP ${res.status}`), 'error')
        favorites.value = prev
        return false
      }
      return true
    } catch (e: unknown) {
      toast(errorMessage(e), 'error')
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
        toast(apiErrorText(d, `HTTP ${res.status}`), 'error')
        favorites.value = prev
      }
    } catch (e: unknown) {
      toast(errorMessage(e), 'error')
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
        toast(apiErrorText(d, `HTTP ${res.status}`), 'error')
        favorites.value = prev
      }
    } catch (e: unknown) {
      toast(errorMessage(e), 'error')
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
        toast(apiErrorText(d, `HTTP ${res.status}`), 'error')
        favorites.value = prev
      }
    } catch (e: unknown) {
      toast(errorMessage(e), 'error')
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
    const updated: FavoriteItem = { ...item, versionId, versionName, baseModel: baseModel || item.baseModel }
    const newKey = favoriteKey(item.modelId, versionId)
    const prev = new Map(favorites.value)
    const m = new Map(prev)
    m.delete(key)
    m.set(newKey, updated)
    favorites.value = m
    try { await fetch(`/api/favorites/${encodeURIComponent(key)}`, { method: 'DELETE' }) } catch { /* ignore */ }
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(favoriteToApi(updated)),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(apiErrorText(d, `HTTP ${res.status}`), 'error')
        favorites.value = prev
      }
    } catch (e: unknown) {
      toast(errorMessage(e), 'error')
      favorites.value = prev
    }
  }

  function applyTaskUpdate(taskData: DownloadTask) {
    taskRevisions.set(taskData.download_id, ++revision)
    const idx = tasks.value.findIndex(t => t.download_id === taskData.download_id)
    if (idx >= 0) {
      tasks.value[idx] = taskData
      tasks.value = [...tasks.value]
    } else {
      tasks.value = [...tasks.value, taskData]
    }
    const path = taskPath(taskData)
    if (path) {
      const next = new Map(fileChecks.value)
      for (const [key, value] of next) {
        if (value.path !== path) continue
        if (taskData.status === 'complete') next.set(key, { ...value, installed: true, downloading: false, download_id: null })
        else if (ACTIVE_STATES.has(taskData.status)) next.set(key, { ...value, installed: false, downloading: true, download_id: taskData.download_id })
        else next.set(key, { ...value, downloading: false, download_id: null })
      }
      fileChecks.value = next
    }
  }

  function applyResourceUpdate(data: ResourceUpdate) {
    resourceRevisions.set(data.resource_key, ++revision)
    const ids = new Map(resourceTaskIds.value)
    if (data.active_task_id) ids.set(data.resource_key, data.active_task_id)
    else ids.delete(data.resource_key)
    resourceTaskIds.value = ids
    const newMap = new Map(resourceStates.value)
    if (data.state === 'absent') {
      newMap.delete(data.resource_key)
    } else {
      newMap.set(data.resource_key, data.state)
    }
    resourceStates.value = newMap
  }

  function connectGlobalSSE() {
    if (globalSSE) return
    const source = new EventSource('/api/downloads/stream')
    globalSSE = source

    globalSSE.onopen = async () => {
      stopPollTimer()
      // 连接建立后重新取快照，补上断线期间及首次订阅前发生的变化。
      if (refreshPromise) await refreshPromise
      if (globalSSE === source) await refreshStatus()
    }

    globalSSE.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        const { type, data } = event
        if (type === 'task.updated' || type === 'task.progress') {
          applyTaskUpdate(data as DownloadTask)
        } else if (type === 'resource.updated') {
          applyResourceUpdate(data)
        }
      } catch { /* ignore */ }
      scheduleIdleDisconnect()
    }

    globalSSE.onerror = () => {
      disconnectGlobalSSE()
      startPollTimer()
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
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

  function scheduleIdleDisconnect() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!subscribers && !submittingVersionIds.value.size && !submittingPaths.value.size && _batchInFlight === 0
          && !tasks.value.some(t => ACTIVE_STATES.has(t.status))) {
        stopPolling()
      } else {
        scheduleIdleDisconnect()
      }
    }, IDLE_DISCONNECT_MS)
  }

  /** Refresh task list + resource states from backend snapshot */
  async function _refreshStatus(): Promise<void> {
    const started = revision
    try {
      const res = await fetch('/api/downloads/snapshot')
      if (!res.ok) return
      const r = await res.json()

      if (r?.tasks) {
        const fresh = new Map<string, DownloadTask>((r.tasks as DownloadTask[]).map(task => [task.download_id, task]))
        for (const task of tasks.value) {
          if ((taskRevisions.get(task.download_id) ?? 0) > started) fresh.set(task.download_id, task)
        }
        tasks.value = [...fresh.values()]
      }

      if (r?.resources) {
        const newMap = new Map<string, string>()
        const ids = new Map<string, string>()
        for (const [key, view] of Object.entries(r.resources)) {
          const v = view as ResourceUpdate
          newMap.set(key, v.state)
          if (v.active_task_id) ids.set(key, v.active_task_id)
        }
        for (const [key, changed] of resourceRevisions) {
          if (changed <= started) continue
          if (resourceStates.value.has(key)) newMap.set(key, resourceStates.value.get(key)!)
          else newMap.delete(key)
          if (resourceTaskIds.value.has(key)) ids.set(key, resourceTaskIds.value.get(key)!)
          else ids.delete(key)
        }
        resourceStates.value = newMap
        resourceTaskIds.value = ids
      }
      await checkFiles()
    } catch { /* ignore network errors */ }
  }

  function refreshStatus(): Promise<void> {
    if (refreshPromise) return refreshPromise
    refreshPromise = _refreshStatus().finally(() => { refreshPromise = null })
    return refreshPromise
  }

  function startPolling() {
    if (polling.value) {
      refreshStatus()
      return
    }
    polling.value = true
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
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  }

  function subscribe() {
    subscribers++
    if (!polling.value) startPolling()
    let released = false
    return () => {
      if (released) return
      released = true
      subscribers--
      scheduleIdleDisconnect()
    }
  }

  function checkFiles(paths: string[] = [...knownFiles]): Promise<void> {
    for (const raw of paths) {
      const path = normalizeFilePath(raw)
      knownFiles.add(path)
      queuedChecks.add(path)
    }
    if (fileCheckPromise) return fileCheckPromise
    if (!queuedChecks.size) return Promise.resolve()
    fileCheckPromise = Promise.resolve().then(async () => {
      while (queuedChecks.size) {
        const batch = [...queuedChecks]
        queuedChecks.clear()
        const started = revision
        const res = await fetch('/api/downloads/check', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: batch.map(path => ({ path })) }) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { results: FileCheck[] }
        const next = new Map(fileChecks.value)
        batch.forEach((path, index) => {
          const checked = data.results[index]
          if (!checked) return
          const recent = newestTask(task => taskPath(task) === checked.path && (taskRevisions.get(task.download_id) ?? 0) > started)
          if (recent) {
            checked.downloading = ACTIVE_STATES.has(recent.status)
            checked.download_id = checked.downloading ? recent.download_id : null
            if (recent.status === 'complete') checked.installed = true
            else if (checked.downloading) checked.installed = false
          }
          next.set(path, checked)
        })
        fileChecks.value = next
      }
    }).finally(() => { fileCheckPromise = null })
    return fileCheckPromise
  }

  function newestTask(matches: (task: DownloadTask) => boolean): DownloadTask | undefined {
    return tasks.value.filter(matches).sort((a, b) =>
      Number(ACTIVE_STATES.has(b.status)) - Number(ACTIVE_STATES.has(a.status)) || b.created_at - a.created_at)[0]
  }

  function getFileDownloadInfo(path: string, resource?: { modelId: string; versionId: string }): VersionDownloadInfo {
    const key = normalizeFilePath(path)
    const checked = fileChecks.value.get(key)
    if (submittingPaths.value.has(key)) return { ...idleInfo(), state: 'submitting' }
    const task = newestTask(task => !!checked?.path && taskPath(task) === checked.path)
    const resourceInfo = resource?.modelId ? getVersionDownloadInfo(resource.modelId, resource.versionId) : undefined
    if (task && ACTIVE_STATES.has(task.status)) {
      return resourceInfo?.downloadId === task.download_id ? resourceInfo : taskInfo(task)
    }
    if (checked?.installed) return { ...idleInfo(), state: 'installed', progress: 100 }
    if (resourceInfo && ['submitting', 'queued', 'downloading', 'verifying', 'paused'].includes(resourceInfo.state)) return resourceInfo
    if (checked?.downloading && checked.download_id) {
      return { ...idleInfo(), state: 'downloading', downloadId: checked.download_id }
    }
    if (task?.status === 'failed') return taskInfo(task)
    return idleInfo()
  }

  async function downloadFile(file: { path: string; url: string; modelId?: string; versionId?: string; meta?: Record<string, unknown> }): Promise<boolean> {
    const path = normalizeFilePath(file.path)
    const state = getFileDownloadInfo(path, file.modelId ? { modelId: file.modelId, versionId: file.versionId || file.modelId } : undefined).state
    if (['installed', 'submitting', 'queued', 'downloading', 'verifying', 'paused'].includes(state)) return true
    submittingPaths.value = new Set([...submittingPaths.value, path])
    startPolling()
    try {
      if (file.modelId) {
        const submitted = await downloadHuggingFaceVersion(file.modelId, file.versionId, { targetPath: path })
        await checkFiles([path])
        return submitted
      }
      const res = await fetch('/api/downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: file.url, save_dir: path.slice(0, path.lastIndexOf('/')), filename: path.split('/').pop(), meta: file.meta }) })
      const result = await res.json()
      acceptSubmission(result)
      if (!res.ok || result.error || result.error_key) throw new Error(apiErrorText(result, `HTTP ${res.status}`))
      await checkFiles([path])
      return true
    } catch (error) {
      toast(errorMessage(error), 'error')
      return false
    } finally {
      const next = new Set(submittingPaths.value)
      next.delete(path)
      submittingPaths.value = next
    }
  }

  function setSubmitting(vid: string) {
    submittingVersionIds.value.add(vid)
    submittingVersionIds.value = new Set(submittingVersionIds.value)
  }

  function clearSubmitting(vid: string) {
    submittingVersionIds.value.delete(vid)
    submittingVersionIds.value = new Set(submittingVersionIds.value)
  }

  function acceptSubmission(result: unknown) {
    const task = result as DownloadTask | null
    // 推送可能先于 POST 响应到达；较早的提交响应不能把进度覆盖回 0。
    if (task?.download_id && task.status && !tasks.value.some(existing => existing.download_id === task.download_id)) applyTaskUpdate(task)
  }

  async function downloadOne(
    modelId: string,
    modelType: string,
    versionId?: number,
    dirKeys?: Record<string, string>,
    opts?: { customFilename?: string; targetPath?: string },
  ) {
    if (isHuggingFaceId(modelId)) return downloadHuggingFaceVersion(modelId, versionId, opts)

    const vid = versionId ? String(versionId) : modelId

    setSubmitting(vid)

    let result: {
      download_id?: string; message?: string; error?: string; existed?: boolean
      error_key?: string; error_params?: Record<string, unknown>
      message_key?: string; message_params?: Record<string, unknown>
      needs_classification?: boolean
      probe_auth?: boolean
      pending_files?: PendingFile[]
      dir_options?: DirOption[]
      civitai_url?: string
      display_name?: string
    } | null = null
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'civitai',
          model_id: modelId,
          model_type: modelType.toLowerCase(),
          ...(versionId && { version_id: versionId }),
          ...(dirKeys && Object.keys(dirKeys).length ? { dir_keys: dirKeys } : {}),
          // 生成页缺失弹窗按配置槽位取货时改用配置引用的文件名; 模型页缺省不带。
          ...(opts?.customFilename ? { custom_filename: opts.customFilename } : {}),
          ...(opts?.targetPath ? { target_path: opts.targetPath } : {}),
        }),
      })
      if (res.status === 401) {
        clearSubmitting(vid)
        window.location.href = '/login'
        return
      }
      result = await res.json()
      acceptSubmission(result)
      // 403 + probe_auth: 探针收到 401 —— 文件需付费或无权限下载。
      // 不创建下载任务, 不弹目录选择 modal, 仅 toast 错误。
      if (res.status === 403 && result?.probe_auth) {
        clearSubmitting(vid)
        toast(apiErrorText(result, t('models.err.dl_probe_auth')), 'error')
        await refreshStatus()
        return
      }
      // 409: 后端判不出目录, 未提交下载 —— 交给 UI 弹目录选择, 用户选完带 dir_keys 重来
      if (res.status === 409 && result?.needs_classification) {
        clearSubmitting(vid)
        pendingClassification.value = {
          modelId,
          modelType,
          versionId,
          displayName: result.display_name || '',
          civitaiUrl: result.civitai_url || '',
          files: result.pending_files || [],
          dirOptions: result.dir_options || [],
          ...(opts?.customFilename && { customFilename: opts.customFilename }),
        }
        return
      }
      if (!res.ok) {
        clearSubmitting(vid)
        toast(apiErrorText(result, `HTTP ${res.status}`), 'error')
        await refreshStatus()
        return
      }
    } catch (e: unknown) {
      clearSubmitting(vid)
      toast(errorMessage(e), 'error')
      return
    }

    if (!result) { clearSubmitting(vid); return }
    if (result.error_key || result.error) {
      clearSubmitting(vid)
      toast(apiErrorText(result), 'error')
      await refreshStatus()
      return
    }
    if (result.existed) {
      toast(apiMessageText(result, t('models.downloads.already_exists')), 'warning')
      await refreshStatus()
      clearSubmitting(vid)
      return
    }

    toast(apiMessageText(result, t('models.downloads.started')), 'success')
    startPolling()
    await refreshStatus()
    clearSubmitting(vid)
  }

  /**
   * Hugging Face 白名单下载提交 (SPEC §6-D / §6-E)。
   * meta 携带白名单完整登记数据; 提交状态 / toast / 轮询 / 快照刷新沿用 downloadOne 流程。
   * 返回 true 表示任务已提交 (含 existed), false 表示提交失败, 供批量收藏分派计数。
   */
  async function downloadHuggingFaceVersion(
    modelId: number | string,
    versionId?: number | string,
    opts?: { customFilename?: string; modelType?: HuggingFaceVersion['file']['modelType']; targetPath?: string },
  ): Promise<boolean> {
    const found = findHuggingFaceVersion(modelId, versionId)
    if (!found) {
      toast('Hugging Face 白名单中未找到该模型', 'error')
      return false
    }
    const { model, version } = found
    const vid = String(version.id)

    setSubmitting(vid)

    // 请求体契约唯一实现在 utils/hfDownload.ts (运行组件依赖条共用);
    // 生成页缺失弹窗按配置槽位覆写落盘文件名与登记类别。
    const body = buildHuggingFaceDownloadBody(model, version, {
      filename: opts?.customFilename,
      modelType: opts?.modelType,
      targetPath: opts?.targetPath,
    })

    let result: {
      download_id?: string; message?: string; error?: string; existed?: boolean
      error_key?: string; error_params?: Record<string, unknown>
      message_key?: string; message_params?: Record<string, unknown>
      needs_classification?: boolean
      probe_auth?: boolean
    } | null = null
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        clearSubmitting(vid)
        window.location.href = '/login'
        return false
      }
      result = await res.json()
      acceptSubmission(result)
      // 403 + probe_auth: 与 civitai 路径一致 —— 文件需付费或无权限下载
      if (res.status === 403 && result?.probe_auth) {
        clearSubmitting(vid)
        toast(apiErrorText(result, t('models.err.dl_probe_auth')), 'error')
        await refreshStatus()
        return false
      }
      // 409 needs_classification: 白名单 model_type 直接定目录, 理论不命中; 兜底按错误提示
      if (res.status === 409 && result?.needs_classification) {
        clearSubmitting(vid)
        toast(apiErrorText(result, `HTTP ${res.status}`), 'error')
        await refreshStatus()
        return false
      }
      if (!res.ok) {
        clearSubmitting(vid)
        toast(apiErrorText(result, `HTTP ${res.status}`), 'error')
        await refreshStatus()
        return false
      }
    } catch (e: unknown) {
      clearSubmitting(vid)
      toast(errorMessage(e), 'error')
      return false
    }

    if (!result) { clearSubmitting(vid); return false }
    if (result.error_key || result.error) {
      clearSubmitting(vid)
      toast(apiErrorText(result), 'error')
      await refreshStatus()
      return false
    }
    if (result.existed) {
      toast(apiMessageText(result, t('models.downloads.already_exists')), 'warning')
      await refreshStatus()
      clearSubmitting(vid)
      return true
    }

    toast(apiMessageText(result, t('models.downloads.started')), 'success')
    startPolling()
    await refreshStatus()
    clearSubmitting(vid)
    return true
  }

  async function resolveClassification(dirKeys: Record<string, string>) {
    const p = pendingClassification.value
    if (!p) return
    pendingClassification.value = null
    await downloadOne(p.modelId, p.modelType, p.versionId, dirKeys,
      p.customFilename ? { customFilename: p.customFilename } : undefined)
  }

  function cancelClassification() {
    pendingClassification.value = null
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
      if (item.source === 'whitelist' || isHuggingFaceId(item.modelId)) {
        const submitted = await downloadHuggingFaceVersion(item.modelId, item.versionId)
        if (submitted) ok++
        else fail++
        continue
      }
      try {
        const res = await fetch('/api/downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'civitai',
            model_id: item.modelId,
            model_type: (item.type || 'Checkpoint').toLowerCase(),
            ...(item.versionId && { version_id: item.versionId }),
          }),
        })
        const data = await res.json()
        clearSubmitting(vid)
        if (res.ok && !data.error_key && !data.error) ok++
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

  /** 裸 POST, 不刷新 —— 批量操作用它, 刷新留到最后统一做一次 */
  async function _post(url: string) {
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    } catch { /* ignore */ }
  }

  async function _postControl(url: string) {
    await _post(url)
    await refreshStatus()
  }

  async function pauseDownload(id: string) { await _postControl(`/api/downloads/${id}/pause`) }
  async function cancelDownload(id: string) { await _postControl(`/api/downloads/${id}/cancel`) }

  async function resumeDownload(id: string) {
    await _postControl(`/api/downloads/${id}/resume`)
    startPolling()
  }

  async function retryDownload(id: string) {
    try {
      const res = await fetch(`/api/downloads/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      acceptSubmission(data)
      if (data?.error_key || data?.error) {
        toast(apiErrorText(data), 'error')
      } else {
        toast(apiMessageText(data, t('models.downloads.started')), 'success')
        startPolling()
      }
    } catch (e: unknown) {
      toast(errorMessage(e), 'error')
    }
    await refreshStatus()
  }

  /** 批量请求共用一次快照刷新；操作期间保持事件订阅。 */
  async function _bulkControl(ids: string[], action: 'pause' | 'resume') {
    if (!ids.length) return
    _batchInFlight++
    try {
      await Promise.all(ids.map(id => _post(`/api/downloads/${id}/${action}`)))
    } finally {
      _batchInFlight--
    }
    await refreshStatus()
  }

  async function pauseAll() {
    await _bulkControl(
      tasks.value.filter(t => t.status === 'active').map(t => t.download_id),
      'pause',
    )
  }

  /**
   * Unified retry entrypoint for version-scoped UI (cards / modals).
   * If a download task still exists in the list → retryDownload(id) (engine retry);
   * otherwise → downloadOne re-submits from scratch.
   */
  async function retryVersion(modelId: string, modelType: string, versionId?: number) {
    const mid = String(modelId)
    const vid = versionId ? String(versionId) : mid
    const existing = versionTask(mid, vid)
    if (existing?.status === 'failed') {
      await retryDownload(existing.download_id)
    } else {
      await downloadOne(modelId, modelType, versionId)
    }
  }

  async function resumeAll() {
    await _bulkControl(
      tasks.value.filter(t => t.status === 'paused').map(t => t.download_id),
      'resume',
    )
    startPolling()
  }

  async function clearHistory() {
    await _postControl('/api/downloads/clear')
    toast(t('models.downloads.history_cleared') || 'History cleared', 'success')
  }

  /**
   * Get the unified state for a specific version.
   * Priority: submitting > resourceStates > active task > local index > idle
   */
  function getVersionState(modelId: string | number, versionId: string | number): VersionState {
    const mid = String(modelId)
    const vid = String(versionId)

    if (submittingVersionIds.value.has(vid)) return 'submitting'

    // 服务端下发的资源状态已按「磁盘现状 ⊕ 进行中流程态」派生 ——
    // installed 表示磁盘上确有该文件 (可用性问磁盘, 不问历史)。
    // 这是唯一判据, 前端不再维护自己的索引 (那会过期且无法自愈)。
    const resourceKey = resourceKeyFor(mid, vid)
    const rState = resourceStates.value.get(resourceKey)
    const task = versionTask(mid, vid)
    const mapped = mapResourceState(rState || '')
    if (['submitting', 'downloading', 'paused', 'verifying'].includes(mapped)) return mapped
    if (task && ACTIVE_STATES.has(task.status)) return taskInfo(task).state
    if (mapped !== 'idle') return mapped
    if (task && task.status !== 'complete') return taskInfo(task).state

    return 'idle'
  }

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

  function getVersionDownloadInfo(modelId: string | number, versionId: string | number): VersionDownloadInfo {
    const mid = String(modelId)
    const vid = String(versionId)
    const state = getVersionState(mid, vid)

    const task = versionTask(mid, vid)

    if (task && (task.status === 'active' || task.status === 'queued' || task.status === 'paused')) {
      return {
        state,
        progress: Math.min(Math.max(task.progress || 0, 0), 100),
        speed: task.speed || 0,
        downloadId: task.download_id,
      }
    }

    return { state, progress: state === 'installed' ? 100 : 0, speed: 0, downloadId: null }
  }

  function versionTask(modelId: string, versionId: string): DownloadTask | undefined {
    const id = resourceTaskIds.value.get(resourceKeyFor(modelId, versionId))
    const linked = id ? tasks.value.find(task => task.download_id === id && ACTIVE_STATES.has(task.status)) : undefined
    return linked ?? newestTask(task => task.meta?.source === sourcePrefixFor(modelId)
      && String(task.meta?.model_id) === modelId
      && (String(task.meta?.version_id) === versionId || (!task.meta?.version_id && versionId === modelId)))
  }

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
    favorites,
    tasks,
    polling,
    resourceStates,
    fileChecks,
    submittingVersionIds,
    pendingClassification,
    resolveClassification,
    cancelClassification,

    favoritesItems,
    favoritesCount,
    loadFavorites,
    addFavorite,
    removeFavorite,
    removeFavoritesByModel,
    clearFavorites,
    isInFavorites,
    updateFavoriteVersion,

    activeTasks,
    pausedTasks,
    completedTasks,
    failedTasks,

    getVersionState,
    getVersionDownloadInfo,
    getModelAggregateState,
    getFileDownloadInfo,
    checkFiles,
    downloadFile,
    subscribe,

    downloadOne,
    downloadHuggingFaceVersion,
    downloadAll: downloadAllFromFavorites,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    retryVersion,
    pauseAll,
    resumeAll,
    clearHistory,

    refreshStatus,
    startPolling,
    stopPolling,
  }
})
