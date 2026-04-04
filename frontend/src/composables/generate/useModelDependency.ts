import { ref, type Ref } from 'vue'

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
  const show = ref(false)
  const loading = ref(false)
  const models = ref<ModelDep[]>(config.models)
  const modelStatus = ref<Map<string, ModelDepStatus>>(new Map())
  const selected = ref<Set<string>>(new Set())
  const downloading = ref(false)
  const progress = ref<DownloadProgress | null>(null)
  const error = ref('')

  let cancelled = false
  let currentDownloadId: string | null = null
  let activeSSE: EventSource | null = null

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

    // 2. Check file existence
    if (comfyuiDir) {
      const checkFiles: Array<{ save_dir: string; filename: string; _modelId: string }> = []
      for (const m of config.models) {
        for (const f of m.files) {
          checkFiles.push({
            save_dir: comfyuiDir + '/' + f.subdir,
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
    } else {
      _setAllUninstalled()
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

    // 4. Auto-resume any in-progress download (legacy: _resumeDownload)
    if (comfyuiDir) {
      const dlModel = config.models.find(m => {
        const ms = modelStatus.value.get(m.id)
        return ms?.downloading && ms.downloadId
      })
      if (dlModel) {
        selected.value = new Set([...selected.value, dlModel.id])
        const ms = modelStatus.value.get(dlModel.id)!
        _autoResume(ms.downloadId!, dlModel, comfyuiDir)
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
      for (let mi = 0; mi < total; mi++) {
        if (cancelled) return
        const model = toDownload[mi]
        progress.value = { modelIndex: mi, totalModels: total, modelName: model.name, percent: 0, speed: 0 }

        for (const f of model.files) {
          if (cancelled) return
          const saveDir = comfyuiDir + '/' + f.subdir

          // Check if file already exists
          const chkRes = await fetch('/api/downloads/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ save_dir: saveDir, filename: f.filename }),
          })
          if (chkRes.ok) {
            const chk = await chkRes.json()
            if (chk?.installed) continue
            if (chk?.downloading && chk.download_id) {
              // Resume existing download
              const ok = await _waitForDownload(chk.download_id, mi, total, model.name)
              if (!ok && !cancelled) {
                error.value = model.name
                downloading.value = false
                progress.value = null
                return
              }
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

          const downloadId = dlData.download_id
          if (!downloadId) {
            error.value = model.name
            downloading.value = false
            progress.value = null
            return
          }

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

  function _waitForDownload(downloadId: string, modelIdx: number, totalModels: number, modelName: string): Promise<boolean> {
    currentDownloadId = downloadId
    return new Promise<boolean>((resolve) => {
      const source = new EventSource(`/api/downloads/${downloadId}/events`)
      activeSSE = source

      source.onmessage = (e) => {
        if (cancelled) { _closeSSE(); resolve(false); return }
        try {
          const data = JSON.parse(e.data)
          if (data.error === '任务已删除') { _closeSSE(); resolve(false); return }

          progress.value = {
            modelIndex: modelIdx,
            totalModels,
            modelName,
            percent: data.progress || 0,
            speed: data.speed || 0,
          }

          if (data.status === 'complete') {
            _closeSSE()
            currentDownloadId = null
            resolve(true)
          } else if (data.status === 'failed' || data.status === 'cancelled') {
            _closeSSE()
            currentDownloadId = null
            resolve(false)
          }
        } catch { /* ignore parse errors */ }
      }

      source.onerror = () => {
        _closeSSE()
        if (cancelled) { resolve(false); return }
        // SSE connection lost — fall back to a single poll to check final state
        fetch(`/api/downloads/${downloadId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data) { resolve(false); return }
            if (data.status === 'complete') { currentDownloadId = null; resolve(true) }
            else if (data.status === 'failed' || data.status === 'cancelled') { currentDownloadId = null; resolve(false) }
            else { resolve(false) }  // Connection lost mid-download
          })
          .catch(() => resolve(false))
      }
    })
  }

  function _closeSSE() {
    if (activeSSE) {
      activeSSE.onmessage = null
      activeSSE.onerror = null
      activeSSE.close()
      activeSSE = null
    }
  }

  /**
   * Auto-resume an in-progress download detected during check().
   * Like legacy _resumeDownload — monitors a single model's download and
   * then continues with remaining models in startDownload.
   */
  async function _autoResume(downloadId: string, model: ModelDep, comfyuiDir: string) {
    downloading.value = true
    cancelled = false
    progress.value = { modelIndex: 0, totalModels: 1, modelName: model.name, percent: 0, speed: 0 }

    const ok = await _waitForDownload(downloadId, 0, 1, model.name)

    if (ok) {
      const ms = modelStatus.value.get(model.id)
      if (ms) { ms.installed = true; ms.downloading = false; ms.downloadId = null }
      modelStatus.value = new Map(modelStatus.value)
    }

    downloading.value = false
    progress.value = null
    // Don't auto-continue with other models — let user click download again
  }

  async function cancelDownload(): Promise<void> {
    cancelled = true
    _closeSSE()
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
    _closeSSE()
    currentDownloadId = null
  }

  return {
    show, loading, models, modelStatus, selected,
    downloading, progress, error,
    check, toggleSelect, startDownload, cancelDownload, dismiss, destroy,
  }
}
