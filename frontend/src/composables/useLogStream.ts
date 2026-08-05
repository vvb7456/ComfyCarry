import { ref, onUnmounted, type Ref } from 'vue'

export interface LogLine {
  text: string
  className?: string
  level?: string
  /** 文件行号 (1-based), 用于往上滚懒加载游标。SSE 新行无行号。 */
  line?: number
}

export type LogStatus = 'loading' | 'standby' | 'error'

/** history 端点返回的行条目 (后端 log_service read_history 格式) */
interface HistoryEntry {
  line: number
  text: string
  level: string
}

interface HistoryResponse {
  entries: HistoryEntry[]
  total: number
}

export interface LogStreamOptions {
  historyUrl: string
  streamUrl: string
  maxLines?: number
  classify?: (line: string) => string
  /** 自定义从 SSE data 解析出行 (默认 JSON {line, level} 或纯文本) */
  parseMessage?: (data: string) => { text: string; level?: string; line?: number } | null
  /** 对每行文本做变换 (history + stream 都走), 如 sync 的 JSONL 翻译成可读文本 */
  transformText?: (text: string) => { text: string; level?: string } | string
}

/**
 * SSE log stream composable.
 *
 * history (行号游标分页) + tail -f stream 两段式:
 * - 初始拉末尾 N 行, 滚到顶时按最早行号 before 游标往前懒加载, prepend 并保持滚动位置。
 * - stream 只给新行 (tail -f), 连接建立即 onopen (服务没跑时文件仍在, tail -f 照常打开)。
 * - buffer 上限 maxLines, 超过裁剪头部。
 *
 * 状态语义:
 * - loading  - 初始 history fetch
 * - standby  - SSE 已连, 等待新行 (或 history 完成但 stream 尚无数据)
 * - error    - 连接彻底失败 (CLOSED)
 */
export function useLogStream(opts: LogStreamOptions) {
  const lines: Ref<LogLine[]> = ref([])
  const status: Ref<LogStatus> = ref('loading')
  const maxLines = opts.maxLines ?? 5000
  /** 是否还有更早的历史可加载 (total=0 或已到文件头时为 false) */
  const hasMore = ref(true)
  /** 正在加载更早历史 (滚顶时) */
  const loadingMore = ref(false)

  let source: EventSource | null = null
  let generation = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let stopped = false
  const MAX_RECONNECT = 10
  const RECONNECT_BASE_MS = 2000
  const SCROLL_THRESHOLD = 30 // 距顶多少 px 触发懒加载

  function levelToClass(level?: string): string {
    if (!level) return ''
    if (level === 'error') return 'log-error'
    if (level === 'warn' || level === 'warning') return 'log-warn'
    if (level === 'info') return 'log-info'
    return ''
  }

  function makeLine(text: string, level?: string, line?: number): LogLine {
    // transformText: sync JSONL 等需要把行文本翻译成可读文本的场景
    if (opts.transformText) {
      const r = opts.transformText(text)
      if (typeof r === 'string') {
        text = r
      } else {
        text = r.text
        if (r.level) level = r.level
      }
    }
    let className = levelToClass(level)
    if (!className && opts.classify) {
      className = opts.classify(text) || ''
    }
    return { text, className, level, line }
  }

  function appendLine(entry: { text: string; level?: string; line?: number } | null) {
    if (!entry) return
    const ln = makeLine(entry.text, entry.level, entry.line)
    lines.value.push(ln)
    // buffer 上限: 超过则裁剪头部 (不管 follow tail, 避免无限增长)
    if (lines.value.length > maxLines) {
      lines.value.splice(0, lines.value.length - maxLines)
      // 裁剪后首行可能是 SSE 新行 (无 line 号), 无法再做行号游标懒加载
      if (!lines.value[0]?.line) hasMore.value = false
    }
    // 不切 status: tail -f 连上就是 standby, 新行来了仍是 standby, 断了才 error
  }

  function parseStreamMessage(data: string): { text: string; level?: string; line?: number } | null {
    if (opts.parseMessage) {
      return opts.parseMessage(data)
    }
    try {
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.line === 'string') {
          return { text: parsed.line, level: parsed.level, line: parsed.line_num }
        }
        if (typeof parsed.text === 'string') {
          return { text: parsed.text, level: parsed.level }
        }
      }
    } catch {
      // 纯文本
    }
    return { text: data }
  }

  /** 拉末尾 N 行 (初始) 或某行之前 N 行 (懒加载) */
  async function fetchHistory(before?: number): Promise<HistoryResponse | null> {
    const params = new URLSearchParams()
    params.set('lines', '100')
    if (before != null) params.set('before', String(before))
    const url = `${opts.historyUrl}?${params}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      clearTimeout(timer)
      if (res.ok) return await res.json() as HistoryResponse
      return null
    } catch {
      clearTimeout(timer)
      return null
    }
  }

  /** 初始加载: 末尾 100 行 + 开 SSE */
  async function start() {
    const gen = ++generation
    stopped = false
    clearReconnectTimer()
    closeSource()
    lines.value = []
    status.value = 'loading'
    hasMore.value = true
    reconnectAttempt = 0

    const data = await fetchHistory()
    if (gen !== generation) return
    if (data && data.entries.length) {
      data.entries.forEach(e => {
        lines.value.push(makeLine(e.text, e.level, e.line))
      })
      hasMore.value = lines.value.length > 0 && data.entries[0].line > 1
    } else {
      hasMore.value = false
    }
    if (gen !== generation) return
    status.value = 'standby'
    openSSE(gen)
  }

  /** 往上滚懒加载: 在当前最早行之前再拉 100 行, prepend */
  async function loadOlder(el: HTMLElement) {
    if (loadingMore.value || !hasMore.value) return
    const first = lines.value[0]
    if (!first?.line) return
    const gen = generation
    loadingMore.value = true
    // 记录滚动位置 (prepend 后恢复, 避免视图跳动)
    const prevHeight = el.scrollHeight
    const prevTop = el.scrollTop
    const data = await fetchHistory(first.line)
    loadingMore.value = false
    if (gen !== generation) return  // start() 被重新调用, 丢弃旧结果
    if (!data) {
      hasMore.value = false
      return
    }
    // 该页全被过滤掉时, 继续往更早加载 (不终止)
    if (!data.entries.length) {
      if (first.line <= 1) hasMore.value = false
      else loadOlder(el)
      return
    }
    // 标记 prepend 中, 让 LogPanel 的 watch 跳过 scrollToBottom
    prepending.value = true
    const older: LogLine[] = data.entries.map(e => makeLine(e.text, e.level, e.line))
    lines.value = [...older, ...lines.value]
    hasMore.value = older[0]?.line != null && older[0].line > 1
    // 保持滚动位置: 新增高度 = scrollHeight - prevHeight, 加到 scrollTop
    requestAnimationFrame(() => {
      el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
      prepending.value = false
    })
  }

  /** prepend 中标记, LogPanel watch 据此跳过 scrollToBottom */
  const prepending = ref(false)

  /** 由 LogPanel 在 scroll 事件里调用, 传入滚动元素 */
  function onScroll(el: HTMLElement) {
    if (el.scrollTop <= SCROLL_THRESHOLD) {
      loadOlder(el)
    }
  }

  function openSSE(gen: number) {
    closeSource()
    source = new EventSource(opts.streamUrl)
    source.onopen = () => {
      if (gen !== generation) return
      status.value = 'standby'
      reconnectAttempt = 0
    }
    source.onmessage = (e) => {
      if (gen !== generation) return
      appendLine(parseStreamMessage(e.data))
    }
    source.onerror = () => {
      if (gen !== generation) return
      if (source?.readyState === EventSource.CLOSED) {
        if (!stopped) {
          status.value = 'error'
          scheduleReconnect(gen)
        }
      }
    }
  }

  function scheduleReconnect(gen: number) {
    if (stopped || gen !== generation) return
    if (reconnectAttempt >= MAX_RECONNECT) return
    reconnectAttempt++
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttempt - 1), 30000)
    reconnectTimer = setTimeout(() => {
      if (gen !== generation || stopped) return
      openSSE(gen)
    }, delay)
  }

  function closeSource() {
    if (source) {
      source.onopen = null
      source.onmessage = null
      source.onerror = null
      source.close()
      source = null
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function stop() {
    stopped = true
    generation++
    clearReconnectTimer()
    closeSource()
    status.value = 'standby'
  }

  function clear() {
    lines.value = []
  }

  onUnmounted(stop)

  return { lines, status, hasMore, loadingMore, prepending, start, stop, clear, onScroll }
}
