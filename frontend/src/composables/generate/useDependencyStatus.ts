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

/** 折叠态摘要 —— 各行独立下载, 这里汇总当前活跃的那些 */
export interface DepCurrent {
  /** 正在下载的行数 */
  active: number
  /** 其中第一行的名称 (折叠态只报一个, 数量另给) */
  name: string
  /** 活跃行的平均进度 */
  percent: number
  /** 活跃行的速度合计 (bytes/s) */
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
  /** 任一行在下载 (派生自行状态 —— 各行互不阻塞) */
  downloading: ComputedRef<boolean>
  current: ComputedRef<DepCurrent | null>
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
  const error = ref('')

  /** 正在被等待链盯着的行 id —— 防重复接管 */
  const watching = new Set<string>()
  /** 已点下、正在提交给引擎的行 id —— 提交有若干个来回, 这期间也算忙 */
  const submitting = new Set<string>()

  /** 该行是否忙 (提交中或等待中); 忙的只是行, 状态条整体不上锁 */
  function isBusy(rowId: string): boolean {
    return submitting.has(rowId) || watching.has(rowId)
  }

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

  // 下载态一律派生自行: 行与行之间没有互斥, 点第二行不该被第一行的下载挡掉
  const activeRows = computed(() => rows.value.filter(r => r.downloading))
  const downloading = computed(() => activeRows.value.length > 0)

  const current = computed<DepCurrent | null>(() => {
    const active = activeRows.value
    if (!active.length) return null
    return {
      active: active.length,
      name: active[0].row.label,
      percent: Math.round(active.reduce((a, r) => a + r.percent, 0) / active.length),
      speed: active.reduce((a, r) => a + r.speed, 0),
    }
  })

  // ── refresh() ─────────────────────────────────────────────────────────────

  /**
   * 按新清单落地行状态。
   * 正在下载的行沿用原来的状态对象 —— 等待链持有的是对象引用, 换新对象会让
   * 进行中的进度更新写进一个已经脱离 rows 的孤儿上, 界面看着就"卡住不动"了。
   */
  function buildStatuses(list: DepRow[]): DepRowStatus[] {
    const prev = new Map(rows.value.map(r => [r.row.id, r]))
    return list.map(row => {
      const p = prev.get(row.id)
      if (p && isBusy(row.id)) {
        p.row = row
        return p
      }
      return {
        row,
        installed: false,
        downloading: false,
        downloadIds: [],
        percent: 0,
        speed: 0,
        failed: false,
      }
    })
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
          // 已被等待链接管的行不动它的下载态: 那边才是权威, 这里再 push 只会攒重复 id
          if (r.downloading && !isBusy(s.row.id)) {
            s.downloading = true
            if (r.download_id && !s.downloadIds.includes(r.download_id)) {
              s.downloadIds.push(r.download_id)
            }
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

    // 自动接管进行中的下载 (刷新/切页回来接上); 已在盯的行跳过, 免得等两遍
    const inProgress = statuses.filter(
      s => s.downloading && s.downloadIds.length && !isBusy(s.row.id),
    )
    if (inProgress.length > 0) {
      await Promise.all(inProgress.map(s => watchRow(s)))
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
    const dir = toValue(opts.comfyuiDir) ?? ''
    if (dir === '') {
      error.value = t('generate.dep.error_no_dir')
      return
    }

    // 忙的只是行, 不是整条状态条: 已装或已在下载的行跳过, 其余照常提交
    const pending = targets.filter(s => !s.installed && !isBusy(s.row.id))
    if (!pending.length) return

    // 先占位再发请求: 提交要走 check + POST 若干个来回, 不占位的话连点两下会提交两遍。
    // 同时把行置为下载中 —— 点了按钮就该有反应, 不等提交往返回来才变样。
    for (const s of pending) {
      submitting.add(s.row.id)
      s.downloading = true
      s.failed = false
      s.percent = 0
      s.speed = 0
    }
    rows.value = [...rows.value]

    error.value = ''

    const waiting: DepRowStatus[] = []

    try {
      // ── 阶段 1: 把所有缺失文件一次性提交给引擎 ──
      // 不逐个等待; 中途切页/关面板不中断下载 (下载由后端引擎跑)。
      for (const s of pending) {
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
          s.downloading = false
          error.value = t('generate.dep.error_submit', { name: s.row.label })
          rows.value = [...rows.value]
          continue
        }

        if (!ids.length) {
          // 全部文件都已存在 → 直接算装好
          s.installed = true
          s.downloading = false
          rows.value = [...rows.value]
          continue
        }

        s.downloadIds = ids
        rows.value = [...rows.value]
        waiting.push(s)
      }

      // ── 阶段 2: 各行并行等待完成 (仅进度展示; 任务已全在引擎队列里) ──
      if (waiting.length > 0) await Promise.all(waiting.map(s => watchRow(s)))
    } catch (e) {
      console.error('[dep] download error:', e)
      error.value = t('generate.dep.failed')
    } finally {
      for (const s of pending) submitting.delete(s.row.id)
    }

    // 复核真实文件状态 (别的行可能还在下, refresh 会保住它们的进度)
    await refresh()
  }

  /**
   * 盯一行下载到终态, 期间把进度同步到行上。
   * 进度来自 downloads store 的等待链 (SSE 主 + 轮询兜底), 与下载管理页同源。
   * 一行一个等待链, 彼此不排队 —— 行 A 在下的时候行 B 照样能点。
   */
  async function watchRow(s: DepRowStatus): Promise<void> {
    const rowId = s.row.id
    if (watching.has(rowId)) return
    watching.add(rowId)

    // store 需在流式推送状态 (SSE 优先, 轮询兜底)
    dlStore.startPolling()

    const ids = [...s.downloadIds]
    s.failed = false

    // 行进度 = 各文件均值, 速度 = 各文件之和 (行内文件也是并行下的)
    const pcts = new Array(ids.length).fill(0)
    const speeds = new Array(ids.length).fill(0)

    try {
      const results = await Promise.all(ids.map((id, k) =>
        dlStore.watchTaskTerminal(id, (percent, speed) => {
          if (disposed) return
          pcts[k] = percent
          speeds[k] = speed
          s.percent = Math.round(pcts.reduce((a: number, b: number) => a + b, 0) / ids.length)
          s.speed = speeds.reduce((a: number, b: number) => a + b, 0)
          rows.value = [...rows.value]
        }),
      ))

      const rowOk = results.every(r => r === 'complete' || r === 'absent')
      s.downloading = false
      s.downloadIds = []
      s.speed = 0
      if (rowOk && !disposed) {
        s.installed = true
        s.percent = 100
      } else if (results.some(r => r === 'failed')) {
        s.failed = true
        error.value = t('generate.dep.error_download', { name: s.row.label })
      }
      rows.value = [...rows.value]
    } finally {
      watching.delete(rowId)
    }
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
          for (const r of rows.value) {
            if (r.downloading && r.downloadIds.length) void watchRow(r)
          }
        }
      },
    ),
  )

  function destroy(): void {
    for (const stop of stopHandles) stop()
    stopHandles.length = 0
    disposed = true
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
