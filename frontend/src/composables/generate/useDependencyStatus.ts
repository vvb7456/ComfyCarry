import { ref, computed, watch, onScopeDispose, toValue, type Ref, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloadsStore } from '@/stores/downloads'

/**
 * useDependencyStatus — 依赖状态机 (运行组件那套的通用化)。
 *
 * 唯一真相是磁盘: 状态只来自 /api/downloads/check, 没有"看过没有"的记忆位,
 * 因此换架构/删模型/别处下完都会自然收敛。调用方按行 (DepRow) 描述依赖,
 * 一行 = 一个可展示的条目, 底下挂 1..N 个必须齐全的文件。
 *
 * 就绪判定: 所有 required 行已装 且 已装的可选行数 >= minOptional。
 */

// ── 类型 ─────────────────────────────────────────────────────────────────────

export interface DepFileSpec {
  filename: string
  url: string
  /** 相对 ComfyUI 根的目录 */
  subdir: string
}

export interface DepRow {
  /** 稳定唯一 id */
  id: string
  label: string
  /** 一行说明, 展开态显示在标签右侧 */
  hint?: string
  /** 展示用体积文本 (如 '~2.5 GB'); bytes 存在时优先按 bytes 格式化 */
  sizeText?: string
  /** 精确字节数, 用于"待下载合计" */
  bytes?: number
  /** 必需行: 不可取消勾选, 缺失即未就绪 */
  required?: boolean
  /** 本行的文件, 需全部存在才算已装 */
  files: DepFileSpec[]
  /** 调用方私有数据 (如 registry 里的原始 ComponentFile), 引擎不解释 */
  meta?: unknown
}

export interface DepRowStatus {
  row: DepRow
  installed: boolean
  downloading: boolean
  /** 本行进行中的任务 id (多文件行有多个) */
  downloadIds: string[]
  /** 0-100, 多文件行为各文件均值 */
  percent: number
  /** bytes/s, 多文件行为当前活跃文件的速度 */
  speed: number
  failed: boolean
}

export interface DepCurrent {
  index: number
  total: number
  name: string
  percent: number
  speed: number
}

export interface UseDependencyStatusOptions {
  /** 至少需要装几个可选行 (默认 0 = 可选行装不装都算就绪) */
  minOptional?: MaybeRefOrGetter<number>
  /** ComfyUI 根目录; 空则无法提交下载 */
  comfyuiDir?: MaybeRefOrGetter<string>
  /** 下载任务的 meta.source, 便于在下载管理页区分来源 */
  source?: string
  /** 附加到下载任务 meta 的字段 */
  metaOf?: (row: DepRow) => Record<string, unknown>
  /**
   * 是否体检 (默认 true)。ModelTab 是全量 v-show 挂载的, 17 个架构 × 6 组依赖
   * 一起体检 = 页面加载 100+ 次 /api/downloads/check; 模块级依赖用它推迟到
   * 该 tab 真正被激活时再查, 切回来会自动复查 (别处下完的也就跟着收敛)。
   */
  enabled?: MaybeRefOrGetter<boolean>
}

export interface UseDependencyStatusReturn {
  loading: Ref<boolean>
  /** 首次体检是否已完成 (未完成时 installed 全为 false, 属"未知"而非"缺失") */
  checked: Ref<boolean>
  rows: Ref<DepRowStatus[]>
  /** 该上下文是否存在依赖需求 (空清单 → false) */
  has: ComputedRef<boolean>
  /** 必需项齐全 且 可选项满足 minOptional */
  ready: ComputedRef<boolean>
  /** 未安装的行 */
  missing: ComputedRef<DepRowStatus[]>
  /** 未安装的必需行 —— "获取缺失"批量按钮的目标 */
  missingRequired: ComputedRef<DepRowStatus[]>
  downloading: Ref<boolean>
  current: Ref<DepCurrent | null>
  error: Ref<string>
  refresh(): Promise<void>
  /** 下载单行 —— 下载入口一律逐行, 没有批量按钮 */
  downloadRow(rowId: string): Promise<void>
  /** 取消单行的下载 */
  cancelRow(rowId: string): Promise<void>
  destroy(): void
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useDependencyStatus(
  rowsSource: MaybeRefOrGetter<DepRow[]>,
  opts: UseDependencyStatusOptions = {},
): UseDependencyStatusReturn {
  const loading = ref(false)
  const checked = ref(false)
  const rows = ref<DepRowStatus[]>([])
  const downloading = ref(false)
  const current = ref<DepCurrent | null>(null)
  const error = ref('')

  const dlStore = useDownloadsStore()
  const { t } = useI18n({ useScope: 'global' })

  const stopHandles: Array<() => void> = []

  const minOptional = computed(() => toValue(opts.minOptional) ?? 0)

  // ── 派生状态 ──────────────────────────────────────────────────────────────

  const has = computed(() => rows.value.length > 0)

  const missing = computed(() => rows.value.filter(r => !r.installed))

  const installedOptional = computed(
    () => rows.value.filter(r => !r.row.required && r.installed).length,
  )

  const ready = computed(() => {
    // 体检完成前一律算就绪: "还不知道" 不等于 "缺件", 否则 UI 会闪一下未就绪
    if (!checked.value) return true
    if (!has.value) return true
    if (rows.value.some(r => r.row.required && !r.installed)) return false
    return installedOptional.value >= minOptional.value
  })

  /** 未装的必需行 —— 批量"获取缺失"只碰这些 */
  const missingRequired = computed(() => rows.value.filter(r => !r.installed && r.row.required))

  // ── refresh() ─────────────────────────────────────────────────────────────

  function buildStatuses(list: DepRow[]): DepRowStatus[] {
    return list.map(row => ({
      row,
      installed: false,
      downloading: false,
      downloadIds: [],
      percent: 0,
      speed: 0,
      failed: false,
    }))
  }

  async function refresh(): Promise<void> {
    const list = toValue(rowsSource)

    // 无依赖需求 → 清空, 不发任何请求
    if (!list.length) {
      rows.value = []
      checked.value = true
      loading.value = false
      error.value = ''
      return
    }

    loading.value = true
    error.value = ''

    // 先按清单落地占位行, 请求回来再覆盖 —— 状态条据此与其它 UI 同帧出现并显示
    // 骨架态, 不会等一个来回之后才"蹦"出来 (has 从此由配置决定, 不由请求结果决定)。
    const statuses = buildStatuses(list)
    rows.value = statuses
    // 扁平文件清单 + 每个文件属于第几行
    const flat: Array<{ rowIdx: number; file: DepFileSpec }> = []
    list.forEach((row, rowIdx) => {
      for (const file of row.files) flat.push({ rowIdx, file })
    })

    try {
      const res = await fetch('/api/downloads/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: flat.map(f => ({ subdir: f.file.subdir, filename: f.file.filename })),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const results: Array<{ installed: boolean; downloading: boolean; download_id: string | null }> =
          data?.results || []

        // 行内全装才算已装; 任一文件在下载则该行标下载中
        for (const s of statuses) s.installed = true
        for (let i = 0; i < flat.length; i++) {
          const r = results[i]
          const s = statuses[flat[i].rowIdx]
          if (!r) { s.installed = false; continue }
          if (!r.installed) s.installed = false
          if (r.downloading) {
            s.downloading = true
            if (r.download_id) s.downloadIds.push(r.download_id)
          }
        }
      } else {
        console.warn('[dep] check failed:', res.status)
        error.value = t('generate.dep.error_check')
      }
    } catch (e) {
      console.warn('[dep] check error:', e)
      error.value = t('generate.dep.error_check')
    }

    rows.value = [...statuses]
    checked.value = true
    loading.value = false

    // 自动接管进行中的下载 (刷新/切页回来接上)
    const inProgress = statuses.filter(s => s.downloading && s.downloadIds.length)
    if (inProgress.length > 0) {
      await waitRows(inProgress.map(s => ({ status: s, ids: s.downloadIds })))
      await refresh()
    }
  }

  // ── 下载 ──────────────────────────────────────────────────────────────────

  /** 下载单行 */
  async function downloadRow(rowId: string): Promise<void> {
    const r = rows.value.find(x => x.row.id === rowId)
    if (!r || r.installed) return
    await _download([r])
  }

  async function _download(targets: DepRowStatus[]): Promise<void> {
    if (downloading.value) return

    const dir = toValue(opts.comfyuiDir) ?? ''
    if (dir === '') {
      error.value = t('generate.dep.error_no_dir')
      return
    }

    if (!targets.length) return

    downloading.value = true
    error.value = ''

    const waiting: Array<{ status: DepRowStatus; ids: string[] }> = []

    try {
      // ── 阶段 1: 把所有缺失文件一次性提交给引擎 ──
      // 不逐个等待; 中途切页/关面板不中断下载 (下载由后端引擎跑)。
      for (const s of targets) {
        const ids: string[] = []
        let rowFailed = false

        for (const f of s.row.files) {
          const saveDir = dir + '/' + f.subdir

          // 先 check: 已装跳过, 已在下载则复用其 id
          try {
            const chkRes = await fetch('/api/downloads/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ save_dir: saveDir, filename: f.filename }),
            })
            if (chkRes.ok) {
              const chk = await chkRes.json()
              if (chk?.installed) continue
              if (chk?.downloading && chk.download_id) { ids.push(chk.download_id); continue }
            }
          } catch { /* check 失败则继续尝试提交 */ }

          try {
            const dlRes = await fetch('/api/downloads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: f.url,
                save_dir: saveDir,
                filename: f.filename,
                meta: {
                  source: opts.source || 'model-dependency',
                  model: s.row.label,
                  ...(opts.metaOf ? opts.metaOf(s.row) : {}),
                },
              }),
            })
            if (!dlRes.ok) {
              console.warn('[dep] submit failed:', f.filename, dlRes.status)
              rowFailed = true
              break
            }
            const dlData = await dlRes.json()
            if (dlData?.error) {
              console.warn('[dep] submit rejected:', f.filename, dlData.error)
              rowFailed = true
              break
            }
            if (dlData?.status === 'complete') continue  // 文件已存在
            if (!dlData?.download_id) { rowFailed = true; break }
            ids.push(dlData.download_id)
          } catch (e) {
            console.warn('[dep] submit error:', f.filename, e)
            rowFailed = true
            break
          }
        }

        if (rowFailed) {
          s.failed = true
          error.value = t('generate.dep.error_submit', { name: s.row.label })
          rows.value = [...rows.value]
          continue
        }

        if (!ids.length) {
          // 全部文件都已存在 → 直接算装好
          s.installed = true
          rows.value = [...rows.value]
          continue
        }

        s.downloading = true
        s.downloadIds = ids
        rows.value = [...rows.value]
        waiting.push({ status: s, ids })
      }

      // ── 阶段 2: 逐行等待完成 (仅进度展示; 任务已全在引擎队列里) ──
      if (waiting.length > 0) await waitRows(waiting)
    } catch (e) {
      console.error('[dep] download error:', e)
      error.value = t('generate.dep.failed')
    }

    downloading.value = false
    current.value = null

    // 复核真实文件状态
    await refresh()
  }

  /**
   * 等待若干行的下载结束, 期间把进度同步到行上。
   * 进度来自 downloads store 的等待链 (SSE 主 + 轮询兜底), 与下载管理页同源。
   */
  async function waitRows(entries: Array<{ status: DepRowStatus; ids: string[] }>): Promise<void> {
    downloading.value = true
    const total = entries.length

    // store 需在流式推送状态 (SSE 优先, 轮询兜底)
    dlStore.startPolling()

    for (let i = 0; i < entries.length; i++) {
      if (disposed) break
      const { status: s, ids } = entries[i]
      s.failed = false

      current.value = { index: i, total, name: s.row.label, percent: s.percent, speed: s.speed }

      // 行进度 = 各文件均值 (已完成的计 100)
      const pcts = new Array(ids.length).fill(0)
      let rowOk = true

      for (let k = 0; k < ids.length; k++) {
        if (disposed) break
        const result = await dlStore.watchTaskTerminal(ids[k], (percent, speed) => {
          if (disposed) return
          pcts[k] = percent
          s.percent = Math.round(pcts.reduce((a: number, b: number) => a + b, 0) / ids.length)
          s.speed = speed
          rows.value = [...rows.value]
          current.value = { index: i, total, name: s.row.label, percent: s.percent, speed: s.speed }
        })

        if (result === 'complete' || result === 'absent') {
          pcts[k] = 100
          continue
        }
        rowOk = false
        if (result === 'failed') {
          s.failed = true
          error.value = t('generate.dep.error_download', { name: s.row.label })
        }
        break  // 失败/取消 → 本行不再等剩余文件
      }

      s.downloading = false
      s.downloadIds = []
      if (rowOk && !disposed) {
        s.installed = true
        s.percent = 100
      }
      rows.value = [...rows.value]
    }

    current.value = null
  }

  // ── 逐行取消 ──────────────────────────────────────────────────────────────

  /** 组合式已销毁 (卸载); 等待循环据此收手 */
  let disposed = false

  async function cancelRow(rowId: string): Promise<void> {
    const r = rows.value.find(x => x.row.id === rowId)
    if (!r) return
    for (const id of r.downloadIds) {
      try {
        await fetch(`/api/downloads/${id}/cancel`, { method: 'POST' })
      } catch { /* 忽略 */ }
    }
    // 任务转终态后等待链自行收尾, 这里只把行状态即时回落
    r.downloading = false
    r.downloadIds = []
    r.percent = 0
    rows.value = [...rows.value]
  }

  // ── 响应式 & 生命周期 ─────────────────────────────────────────────────────

  // 依赖清单变化 (架构切换 / branch 切换 / 条件组件增删) 或从未启用变启用 → 重新判定。
  // 下载进行中不打断, 结束后的 refresh 自会带上新清单。
  stopHandles.push(
    watch(
      () => [toValue(opts.enabled ?? true), toValue(rowsSource).map(r => r.id).join('|')] as const,
      ([on]) => {
        if (!on || downloading.value) return
        void refresh()
      },
      { immediate: true },
    ),
  )

  // comfyuiDir 从空变非空: 若有进行中的下载则重新接管一次
  let prevDir = toValue(opts.comfyuiDir) ?? ''
  stopHandles.push(
    watch(
      () => toValue(opts.comfyuiDir) ?? '',
      (newDir) => {
        const wasEmpty = prevDir === ''
        prevDir = newDir
        if (wasEmpty && newDir !== '') {
          const inProgress = rows.value.filter(r => r.downloading && r.downloadIds.length)
          if (inProgress.length > 0) {
            void waitRows(inProgress.map(r => ({ status: r, ids: r.downloadIds })))
          }
        }
      },
    ),
  )

  function destroy(): void {
    for (const stop of stopHandles) stop()
    stopHandles.length = 0
    disposed = true
    downloading.value = false
    current.value = null
  }

  // 兜底: 调用方忘记 destroy 也不泄漏
  onScopeDispose(destroy)

  return {
    loading,
    checked,
    rows,
    has,
    ready,
    missing,
    missingRequired,
    downloading,
    current,
    error,
    refresh,
    downloadRow,
    cancelRow,
    destroy,
  }
}
