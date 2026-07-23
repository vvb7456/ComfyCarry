import { ref, computed, watch, onScopeDispose, toValue, type Ref, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloadsStore } from '@/stores/downloads'
import {
  requiredComponents,
  type ComponentFile,
} from '@/config/component-registry'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface ComponentFileStatus {
  file: ComponentFile
  installed: boolean
  downloading: boolean
  downloadId: string | null
  /** 0-100 */
  percent: number
  /** bytes/s */
  speed: number
  failed: boolean
}

export interface ComponentCurrent {
  index: number
  total: number
  name: string
  percent: number
  speed: number
}

export interface UseComponentStatusReturn {
  loading: Ref<boolean>
  files: Ref<ComponentFileStatus[]>
  /** registry 中该 arch 是否有组件需求 (整合包架构如 sdxl 为 false) */
  hasComponents: ComputedRef<boolean>
  /** 全部必需文件均已安装 (hasComponents 为 false 时恒 true) */
  ready: ComputedRef<boolean>
  missing: ComputedRef<ComponentFileStatus[]>
  downloading: Ref<boolean>
  /** 当前整体下载进度展示用 */
  current: Ref<ComponentCurrent | null>
  error: Ref<string>
  refresh(): Promise<void>
  downloadMissing(): Promise<void>
  cancel(): Promise<void>
  destroy(): void
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useComponentStatus(
  arch: MaybeRefOrGetter<string>,
  comfyuiDir?: MaybeRefOrGetter<string>,
): UseComponentStatusReturn {
  const loading = ref(false)
  const files = ref<ComponentFileStatus[]>([])
  const downloading = ref(false)
  const current = ref<ComponentCurrent | null>(null)
  const error = ref('')

  // downloads store: 提供任务列表与 wait-chain 辅助
  const dlStore = useDownloadsStore()
  const { t } = useI18n({ useScope: 'global' })

  // 已收集的 watch 句柄, destroy 时统一停止
  const stopHandles: Array<() => void> = []

  // ── 派生状态 ──────────────────────────────────────────────────────────────

  const hasComponents = computed(() => files.value.length > 0)

  const ready = computed(() => {
    if (!hasComponents.value) return true
    return files.value.every(f => f.installed)
  })

  const missing = computed(() => files.value.filter(f => !f.installed))

  // ── 内部: 构造文件状态 ────────────────────────────────────────────────────

  function buildStatuses(list: ComponentFile[], _currentArch: string): ComponentFileStatus[] {
    return list.map(f => ({
      file: f,
      installed: false,
      downloading: false,
      downloadId: null,
      percent: 0,
      speed: 0,
      failed: false,
    }))
  }

  /** 将后端 check 结果(数组, 顺序与入参一致)合并到 files */
  function applyCheckResults(
    statuses: ComponentFileStatus[],
    results: Array<{ installed: boolean; downloading: boolean; download_id: string | null }>,
  ): void {
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i]
      const r = results[i]
      if (!r) continue
      s.installed = r.installed
      s.downloading = r.downloading
      s.downloadId = r.download_id ?? null
    }
    files.value = [...statuses]
  }

  // ── refresh() ─────────────────────────────────────────────────────────────

  async function refresh(): Promise<void> {
    const currentArch = toValue(arch)
    const list = requiredComponents(currentArch)

    // 整合包架构无组件需求 → 清空状态, 直接返回 (不发任何请求)
    if (list.length === 0) {
      files.value = []
      loading.value = false
      error.value = ''
      return
    }

    loading.value = true
    error.value = ''

    const statuses = buildStatuses(list, currentArch)

    try {
      const res = await fetch('/api/downloads/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: list.map(f => ({ subdir: f.subdir, filename: f.filename })),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const results: Array<{ installed: boolean; downloading: boolean; download_id: string | null }> =
          data?.results || []
        applyCheckResults(statuses, results)
      } else {
        // 非 2xx → 全部按未安装处理
        files.value = [...statuses]
        console.warn('[components] check failed:', res.status)
        error.value = t('generate.components.error_check')
      }
    } catch (e) {
      // 网络错误 → 全部按未安装处理
      files.value = [...statuses]
      console.warn('[components] check error:', e)
      error.value = t('generate.components.error_check')
    }

    loading.value = false

    // 自动接管进行中的下载: 若有 downloading && downloadId, 走与 downloadMissing 相同的等待逻辑
    const inProgress = files.value.filter(f => f.downloading && f.downloadId)
    if (inProgress.length > 0) {
      await waitDownloads(
        inProgress.map(f => ({ status: f, downloadId: f.downloadId! })),
        /*resubmit*/ false,
      )
      // 全部结束后再 refresh 一次复核真实文件状态
      await refresh()
    }
  }

  // ── downloadMissing() ─────────────────────────────────────────────────────

  async function downloadMissing(): Promise<void> {
    // 防重入
    if (downloading.value) return

    const dir = toValue(comfyuiDir) ?? ''
    if (dir === '') {
      error.value = t('generate.components.error_no_dir')
      return
    }

    const currentArch = toValue(arch)
    const targets = missing.value
    if (targets.length === 0) return

    downloading.value = true
    error.value = ''

    // 待等待的下载项: { status, downloadId }
    const pending: Array<{ status: ComponentFileStatus; downloadId: string }> = []

    try {
      // ── 阶段 1: 一次性把所有缺失文件提交给下载引擎 ──
      // 不逐个等待; 中途切页/关面板不会中断下载 (下载由后端引擎跑)。
      for (const s of targets) {
        const f = s.file
        const saveDir = dir + '/' + f.subdir

        // 先单文件 check: 已装则跳过, 已在下载则复用其 download_id
        let reused = false
        try {
          const chkRes = await fetch('/api/downloads/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ save_dir: saveDir, filename: f.filename }),
          })
          if (chkRes.ok) {
            const chk = await chkRes.json()
            if (chk?.installed) {
              s.installed = true
              files.value = [...files.value]
              continue
            }
            if (chk?.downloading && chk.download_id) {
              pending.push({ status: s, downloadId: chk.download_id })
              s.downloadId = chk.download_id
              s.downloading = true
              files.value = [...files.value]
              reused = true
              continue
            }
          }
        } catch { /* check 失败则继续尝试提交下载 */ }

        if (reused) continue

        // 提交新下载
        let dlData: { download_id?: string; status?: string; error?: string } | null = null
        try {
          const dlRes = await fetch('/api/downloads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: f.url,
              save_dir: saveDir,
              filename: f.filename,
              meta: { source: 'runtime-component', arch: currentArch, component: f.id },
            }),
          })
          if (!dlRes.ok) {
            s.failed = true
            console.warn('[components] submit failed:', f.filename, dlRes.status)
            error.value = t('generate.components.error_submit', { name: f.label })
            files.value = [...files.value]
            continue
          }
          dlData = await dlRes.json()
        } catch (e) {
          s.failed = true
          console.warn('[components] submit error:', f.filename, e)
          error.value = t('generate.components.error_submit', { name: f.label })
          files.value = [...files.value]
          continue
        }

        if (!dlData) {
          s.failed = true
          error.value = t('generate.components.error_submit', { name: f.label })
          files.value = [...files.value]
          continue
        }
        if (dlData.error) {
          s.failed = true
          console.warn('[components] submit rejected:', f.filename, dlData.error)
          error.value = t('generate.components.error_submit', { name: f.label })
          files.value = [...files.value]
          continue
        }
        // 文件已存在 → 视为已装
        if (dlData.status === 'complete') {
          s.installed = true
          files.value = [...files.value]
          continue
        }
        if (!dlData.download_id) {
          s.failed = true
          error.value = t('generate.components.error_submit', { name: f.label })
          files.value = [...files.value]
          continue
        }

        s.downloadId = dlData.download_id
        s.downloading = true
        files.value = [...files.value]
        pending.push({ status: s, downloadId: dlData.download_id })
      }

      // ── 阶段 2: 逐个等待完成 (仅进度展示; 任务已全部在引擎队列中) ──
      if (pending.length > 0) {
        await waitDownloads(pending, /*resubmit*/ true)
      }
    } catch (e) {
      console.error('[components] download error:', e)
      error.value = t('generate.components.failed')
    }

    downloading.value = false
    current.value = null

    // 复核真实文件状态
    await refresh()
  }

  /**
   * 等待一组下载完成, 同步进度到 files / current。
   * resubmit=false 时不重复提交下载 (用于 refresh 自动接管进行中任务)。
   */
  async function waitDownloads(
    entries: Array<{ status: ComponentFileStatus; downloadId: string }>,
    _resubmit: boolean,
  ): Promise<void> {
    downloading.value = true
    const total = entries.length

    // 启动 store 轮询 (SSE 优先 + 轮询兜底)
    dlStore.startPolling()

    // 监听 store.tasks, 同步进度到对应文件
    const stopProgress = watch(
      () => dlStore.tasks,
      (taskList) => {
        for (const entry of entries) {
          const task = taskList.find(t => t.download_id === entry.downloadId)
          if (!task) continue
          entry.status.percent = Math.min(Math.max(task.progress || 0, 0), 100)
          entry.status.speed = task.speed || 0
        }
        files.value = [...files.value]

        // 更新 current (当前等待中的第一项)
        const activeIdx = entries.findIndex(e => !e.status.installed && !e.status.failed)
        if (activeIdx >= 0) {
          const e = entries[activeIdx]
          current.value = {
            index: activeIdx,
            total,
            name: e.status.file.label,
            percent: e.status.percent,
            speed: e.status.speed,
          }
        }
      },
      { deep: true },
    )

    try {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        const s = entry.status

        current.value = {
          index: i,
          total,
          name: s.file.label,
          percent: s.percent,
          speed: s.speed,
        }

        const result = await dlStore.watchTaskTerminal(entry.downloadId)

        if (result === 'complete' || result === 'absent') {
          s.installed = true
          s.downloading = false
          s.downloadId = null
          s.percent = 100
        } else if (result === 'failed') {
          s.failed = true
          s.downloading = false
          s.downloadId = null
          error.value = t('generate.components.error_download', { name: s.file.label })
        } else if (result === 'cancelled') {
          // 静默, 不标失败
          s.downloading = false
          s.downloadId = null
        }

        files.value = [...files.value]
      }
    } finally {
      stopProgress()
    }
  }

  // ── cancel() ──────────────────────────────────────────────────────────────

  async function cancel(): Promise<void> {
    const toCancel = files.value.filter(f => f.downloading && f.downloadId)
    for (const f of toCancel) {
      if (!f.downloadId) continue
      try {
        await fetch(`/api/downloads/${f.downloadId}/cancel`, { method: 'POST' })
      } catch { /* 失败忽略 */ }
    }
    downloading.value = false
    current.value = null
    await refresh()
  }

  // ── 响应式 & 生命周期 ─────────────────────────────────────────────────────

  // arch 变化时自动 refresh
  stopHandles.push(
    watch(
      () => toValue(arch),
      () => { void refresh() },
      { immediate: true },
    ),
  )

  // comfyuiDir 从空变成非空时, 若有进行中的下载则重新接管
  let prevDir = toValue(comfyuiDir) ?? ''
  stopHandles.push(
    watch(
      () => toValue(comfyuiDir) ?? '',
      (newDir) => {
        const wasEmpty = prevDir === ''
        prevDir = newDir
        if (wasEmpty && newDir !== '') {
          // 目录从空变非空: 若当前有进行中的下载, 重新接管一次
          const inProgress = files.value.filter(f => f.downloading && f.downloadId)
          if (inProgress.length > 0) {
            void waitDownloads(
              inProgress.map(f => ({ status: f, downloadId: f.downloadId! })),
              false,
            )
          }
        }
      },
    ),
  )

  function destroy(): void {
    for (const stop of stopHandles) stop()
    stopHandles.length = 0
    downloading.value = false
    current.value = null
  }

  // 兜底: 调用方忘记调 destroy 也不泄漏
  onScopeDispose(destroy)

  // ── 返回 ──────────────────────────────────────────────────────────────────

  return {
    loading,
    files,
    hasComponents,
    ready,
    missing,
    downloading,
    current,
    error,
    refresh,
    downloadMissing,
    cancel,
    destroy,
  }
}
