import { ref, type Ref } from 'vue'
import { useDownloadsStore } from '@/stores/downloads'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModelDepFile {
  filename: string
  url: string
  subdir: string
}

export interface ModelDep {
  id: string
  name: string
  description?: string
  size?: string
  required?: boolean
  files: ModelDepFile[]
}

export interface ModelDepConfig {
  tab: string
  title: string
  models: ModelDep[]
  minOptional?: number
}

export interface ModelDepStatus {
  installed: boolean
  downloading: boolean
  downloadId: string | null
}

export interface DownloadProgress {
  modelIndex: number  // current model index (0-based)
  totalModels: number
  modelName: string
  percent: number     // 0-100
  speed: number       // bytes/sec
}

export interface UseModelDependencyReturn {
  /** Whether the welcome gate should be shown */
  show: Ref<boolean>
  /** Whether currently loading/checking */
  loading: Ref<boolean>
  /** Model list with install status */
  models: Ref<ModelDep[]>
  /** Install status per model id */
  modelStatus: Ref<Map<string, ModelDepStatus>>
  /** User-selected model ids */
  selected: Ref<Set<string>>
  /** Whether batch download is in progress */
  downloading: Ref<boolean>
  /** Current download progress */
  progress: Ref<DownloadProgress | null>
  /** Error message if download failed */
  error: Ref<string>

  /** Check welcome_state + file existence */
  check(comfyuiDir: string): Promise<void>
  /** Toggle selection of a model */
  toggleSelect(modelId: string): void
  /** Start batch downloading selected models */
  startDownload(comfyuiDir: string): Promise<void>
  /** Cancel ongoing download */
  cancelDownload(): Promise<void>
  /** Dismiss welcome gate (POST welcome_state) */
  dismiss(): Promise<void>
  /** Cleanup active SSE/polling */
  destroy(): void
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useModelDependency(config: ModelDepConfig): UseModelDependencyReturn {
  // 初始 true：避免 check() 异步期间真实表单/面板"闪"出来。
  // check() 完成后根据 welcome_state 决定是否保留 true（首次未 dismiss）或 set false（已 dismiss）。
  const show = ref(true)
  const loading = ref(false)
  const models = ref<ModelDep[]>(config.models)
  const modelStatus = ref<Map<string, ModelDepStatus>>(new Map())
  const selected = ref<Set<string>>(new Set())
  const downloading = ref(false)
  const progress = ref<DownloadProgress | null>(null)
  const error = ref('')

  let cancelled = false
  let currentDownloadId: string | null = null

  // ── Downloads store (C1: wait-chain re-sourced to pinia store) ──
  const dlStore = useDownloadsStore()

  // ── Check ──────────────────────────────────────────────────────────────

  async function check(comfyuiDir: string): Promise<void> {
    loading.value = true
    error.value = ''

    try {
      // 1. Check welcome_state — if already dismissed, skip
      const stateRes = await fetch('/api/generate/welcome_state')
      if (stateRes.ok) {
        const stateData = await stateRes.json()
        if (stateData?.[config.tab]) {
          show.value = false
          loading.value = false
          return
        }
      }
    } catch { /* continue */ }

    // 2. Check file existence — 后端根据 subdir 相对 ComfyUI 根解析, 不再依赖 comfyuiDir
    {
      const checkFiles: Array<{ subdir: string; filename: string; _modelId: string }> = []
      for (const m of config.models) {
        for (const f of m.files) {
          checkFiles.push({
            subdir: f.subdir,
            filename: f.filename,
            _modelId: m.id,
          })
        }
      }

      try {
        const res = await fetch('/api/downloads/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: checkFiles.map(({ _modelId, ...rest }) => rest) }),
        })

        if (res.ok) {
          const data = await res.json()
          const results: Array<{ installed: boolean; downloading: boolean; download_id: string | null }> = data?.results || []

          // Default all to installed
          const statusMap = new Map<string, ModelDepStatus>()
          for (const m of config.models) {
            statusMap.set(m.id, { installed: true, downloading: false, downloadId: null })
          }

          // Mark uninstalled
          for (let i = 0; i < checkFiles.length; i++) {
            const mid = checkFiles[i]._modelId
            const r = results[i]
            if (!r) continue
            const ms = statusMap.get(mid)!
            if (!r.installed) ms.installed = false
            if (r.downloading) { ms.downloading = true; ms.downloadId = r.download_id }
          }

          modelStatus.value = statusMap
        } else {
          _setAllUninstalled()
        }
      } catch {
        _setAllUninstalled()
      }
    }

    // 3. Init selection: installed or required
    const sel = new Set<string>()
    for (const m of config.models) {
      const ms = modelStatus.value.get(m.id)
      if (ms?.installed || m.required) sel.add(m.id)
    }
    selected.value = sel

    show.value = true
    loading.value = false

    // 4. Auto-resume all in-progress downloads (页面刷新/切走后回来接上)
    if (comfyuiDir) {
      const dlEntries: Array<{ model: ModelDep; downloadId: string }> = []
      for (const m of config.models) {
        const ms = modelStatus.value.get(m.id)
        if (ms?.downloading && ms.downloadId) dlEntries.push({ model: m, downloadId: ms.downloadId })
      }
      if (dlEntries.length) {
        selected.value = new Set([...selected.value, ...dlEntries.map(e => e.model.id)])
        _autoResume(dlEntries, comfyuiDir)
      }
    }
  }

  function _setAllUninstalled() {
    const statusMap = new Map<string, ModelDepStatus>()
    for (const m of config.models) {
      statusMap.set(m.id, { installed: false, downloading: false, downloadId: null })
    }
    modelStatus.value = statusMap
  }

  // ── Selection ──────────────────────────────────────────────────────────

  function toggleSelect(modelId: string) {
    if (downloading.value) return
    const m = config.models.find(x => x.id === modelId)
    if (!m) return
    const ms = modelStatus.value.get(modelId)
    if (ms?.installed || m.required) return  // locked

    const next = new Set(selected.value)
    if (next.has(modelId)) next.delete(modelId)
    else next.add(modelId)
    selected.value = next
  }

  // ── Download ───────────────────────────────────────────────────────────

  async function startDownload(comfyuiDir: string): Promise<void> {
    const toDownload = config.models.filter(m =>
      selected.value.has(m.id) && !modelStatus.value.get(m.id)?.installed,
    )
    if (!toDownload.length) return

    downloading.value = true
    cancelled = false
    error.value = ''
    const total = toDownload.length

    try {
      // Phase 1: 先把所有缺失文件一次性提交给下载引擎 (后台并行下载)。
      // 编排不依赖页面存活 — 中途切页/刷新, 剩余文件仍会继续下载,
      // 回到页面后由 check() 的自动恢复接管进度展示。
      const pendingIds = new Map<string, string[]>()  // model.id → download_ids
      for (const model of toDownload) {
        const ids: string[] = []
        for (const f of model.files) {
          if (cancelled) return
          const saveDir = comfyuiDir + '/' + f.subdir

          // Check if file already exists / already downloading
          const chkRes = await fetch('/api/downloads/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ save_dir: saveDir, filename: f.filename }),
          })
          if (chkRes.ok) {
            const chk = await chkRes.json()
            if (chk?.installed) continue
            if (chk?.downloading && chk.download_id) {
              ids.push(chk.download_id)
              continue
            }
          }

          // Submit new download
          const dlRes = await fetch('/api/downloads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: f.url,
              save_dir: saveDir,
              filename: f.filename,
              meta: { source: 'model-dependency', model: model.name },
            }),
          })

          if (!dlRes.ok) {
            error.value = model.name
            downloading.value = false
            progress.value = null
            return
          }

          const dlData = await dlRes.json()
          if (dlData?.error) {
            error.value = model.name
            downloading.value = false
            progress.value = null
            return
          }
          if (dlData?.status === 'complete') continue

          if (!dlData.download_id) {
            error.value = model.name
            downloading.value = false
            progress.value = null
            return
          }
          ids.push(dlData.download_id)
        }
        pendingIds.set(model.id, ids)
      }

      // Phase 2: 逐模型等待完成 (仅进度展示; 任务已全部在引擎队列中)
      for (let mi = 0; mi < total; mi++) {
        if (cancelled) return
        const model = toDownload[mi]
        progress.value = { modelIndex: mi, totalModels: total, modelName: model.name, percent: 0, speed: 0 }

        for (const downloadId of pendingIds.get(model.id) || []) {
          if (cancelled) return
          const ok = await _waitForDownload(downloadId, mi, total, model.name)
          if (!ok && !cancelled) {
            error.value = model.name
            downloading.value = false
            progress.value = null
            return
          }
        }

        // Model complete
        const ms = modelStatus.value.get(model.id)
        if (ms) {
          ms.installed = true
          ms.downloading = false
          ms.downloadId = null
        }
        modelStatus.value = new Map(modelStatus.value)
      }

      // All done
      progress.value = null
      downloading.value = false
    } catch (e) {
      console.error('[mdep] batch download error:', e)
      error.value = String(e)
      downloading.value = false
      progress.value = null
    }
  }

  async function _waitForDownload(downloadId: string, modelIdx: number, totalModels: number, modelName: string): Promise<boolean> {
    currentDownloadId = downloadId
    // Ensure the store is actively streaming task updates (SSE primary + polling fallback)
    dlStore.startPolling()

    // Subscribe to store's task list until terminal state (store SSE/polling guarantees convergence).
    // Pre-check current task progress for immediate UI feedback.
    const preTask = dlStore.tasks.find(t => t.download_id === downloadId)
    if (preTask) {
      progress.value = {
        modelIndex: modelIdx,
        totalModels,
        modelName,
        percent: preTask.progress || 0,
        speed: preTask.speed || 0,
      }
    }

    const result = await dlStore.watchTaskTerminal(downloadId)
    currentDownloadId = null
    if (cancelled) return false
    if (result === 'absent') return true  // task already cleared → treat as complete
    return result === 'complete'
  }

  /**
   * Auto-resume in-progress downloads detected during check().
   * 逐个等待所有进行中的任务, 结束后重新 check() 核对文件真实状态
   * (一个模型可能有多个文件, check 的 per-model 状态只保留了一个 download_id;
   * 复查能把遗漏的进行中任务再接上, 直到收敛为全部安装/无任务)。
   */
  async function _autoResume(entries: Array<{ model: ModelDep; downloadId: string }>, comfyuiDir: string) {
    downloading.value = true
    cancelled = false

    for (let i = 0; i < entries.length; i++) {
      if (cancelled) break
      const { model, downloadId } = entries[i]
      progress.value = { modelIndex: i, totalModels: entries.length, modelName: model.name, percent: 0, speed: 0 }
      await _waitForDownload(downloadId, i, entries.length, model.name)
    }

    downloading.value = false
    progress.value = null
    if (!cancelled) await check(comfyuiDir)
  }

  async function cancelDownload(): Promise<void> {
    cancelled = true
    if (currentDownloadId) {
      try {
        await fetch(`/api/downloads/${currentDownloadId}/cancel`, { method: 'POST' })
      } catch { /* ignore */ }
      currentDownloadId = null
    }
    downloading.value = false
    progress.value = null
  }

  // ── Dismiss ────────────────────────────────────────────────────────────

  async function dismiss(): Promise<void> {
    try {
      await fetch('/api/generate/welcome_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: config.tab }),
      })
    } catch { /* silent */ }
    show.value = false
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  function destroy() {
    cancelled = true
    currentDownloadId = null
  }

  return {
    show, loading, models, modelStatus, selected,
    downloading, progress, error,
    check, toggleSelect, startDownload, cancelDownload, dismiss, destroy,
  }
}
