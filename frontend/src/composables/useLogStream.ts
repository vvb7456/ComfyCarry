import { ref, onUnmounted, type Ref } from 'vue'

export interface LogLine {
  text: string
  className?: string
  level?: string
}

export type LogStatus = 'loading' | 'standby' | 'live' | 'error'

type RawLogEntry =
  | string
  | {
    text?: string
    line?: string
    level?: string
    className?: string
  }

export interface LogStreamOptions {
  historyUrl: string
  streamUrl: string
  maxLines?: number
  /** Seconds of silence before live → standby (default 5) */
  idleTimeout?: number
  classify?: (line: string) => string
  historyExtract?: (data: unknown) => RawLogEntry[]
  parseMessage?: (data: string) => RawLogEntry | null
}

/**
 * SSE log stream composable.
 * Fetches historical lines then opens an EventSource for real-time logs.
 * Automatically closes on component unmount.
 *
 * Status semantics:
 * - loading  — fetching history / initial connection
 * - standby  — SSE connected, waiting for new logs
 * - live     — actively receiving log messages
 * - error    — connection permanently failed (CLOSED)
 */
export function useLogStream(opts: LogStreamOptions) {
  const lines: Ref<LogLine[]> = ref([])
  const status: Ref<LogStatus> = ref('loading')
  const maxLines = opts.maxLines ?? 500
  const idleMs = (opts.idleTimeout ?? 5) * 1000

  let source: EventSource | null = null
  let generation = 0 // Guard against concurrent start() calls
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let stopped = false // True after explicit stop() — disables auto-reconnect
  const MAX_RECONNECT = 10
  const RECONNECT_BASE_MS = 2000

  function levelToClass(level?: string): string {
    if (!level) return ''
    if (level === 'error') return 'log-error'
    if (level === 'warn' || level === 'warning') return 'log-warn'
    if (level === 'info') return 'log-info'
    return ''
  }

  function normalizeEntry(entry: RawLogEntry | null): LogLine | null {
    if (entry == null) return null

    let text = ''
    let className = ''
    let level = ''

    if (typeof entry === 'string') {
      text = entry
    } else {
      text = typeof entry.line === 'string'
        ? entry.line
        : typeof entry.text === 'string'
          ? entry.text
          : ''
      level = entry.level || ''
      className = entry.className || levelToClass(level)
    }

    if (!text) return null
    if (!className && opts.classify) {
      className = opts.classify(text) || ''
    }

    return { text, className, level }
  }

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (status.value === 'live') status.value = 'standby'
    }, idleMs)
  }

  function addLine(entry: RawLogEntry | null) {
    const normalized = normalizeEntry(entry)
    if (!normalized) return

    lines.value.push(normalized)
    if (lines.value.length > maxLines) {
      lines.value.splice(0, lines.value.length - maxLines)
    }

    if (status.value === 'standby' || status.value === 'loading') {
      status.value = 'live'
    }
    resetIdleTimer()
  }

  function extractHistory(data: unknown): RawLogEntry[] {
    if (opts.historyExtract) {
      return opts.historyExtract(data) || []
    }
    if (Array.isArray(data)) return data
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj?.lines)) return obj.lines
    if (typeof obj?.logs === 'string' && obj.logs.trim()) {
      return obj.logs.split('\n').filter((line: string) => line.trim())
    }
    return []
  }

  function parseStreamMessage(data: string): RawLogEntry | null {
    if (opts.parseMessage) {
      return opts.parseMessage(data)
    }

    try {
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.line === 'string') {
          return {
            line: parsed.line,
            level: typeof parsed.level === 'string' ? parsed.level : undefined,
          }
        }
        if (typeof parsed.text === 'string') {
          return {
            text: parsed.text,
            level: typeof parsed.level === 'string' ? parsed.level : undefined,
          }
        }
      }
    } catch {
      // Fall back to plain-text logs.
    }

    return data
  }

  async function start() {
    const gen = ++generation
    stopped = false
    clearReconnectTimer()
    clearIdleTimer()
    closeSource()
    lines.value = []
    status.value = 'loading'
    reconnectAttempt = 0

    // Load history (with abort controller for timeout)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(opts.historyUrl, { signal: ctrl.signal })
      if (gen !== generation) return // Stale: another start() was called
      if (res.ok) {
        const data = await res.json()
        const history = extractHistory(data)
        history.forEach(addLine)
      }
    } catch { /* ignore history load error or abort */ }
    clearTimeout(timer)

    if (gen !== generation) return // Stale
    openSSE(gen)
  }

  function openSSE(gen: number) {
    closeSource()
    source = new EventSource(opts.streamUrl)
    source.onopen = () => {
      if (gen !== generation) return
      // Transition to standby (waiting for logs) unless already live
      if (status.value !== 'live') status.value = 'standby'
      reconnectAttempt = 0
    }
    source.onmessage = (e) => {
      if (gen !== generation) return
      addLine(parseStreamMessage(e.data))
    }
    source.onerror = () => {
      if (gen !== generation) return
      // Only mark error when browser has given up (CLOSED).
      // CONNECTING means browser is auto-reconnecting — keep current status.
      if (source?.readyState === EventSource.CLOSED) {
        if (!stopped) {
          status.value = 'error'
          scheduleReconnect(gen)
        }
      }
      // readyState === CONNECTING: browser auto-reconnects, no status change
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

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  function stop() {
    stopped = true
    generation++
    clearReconnectTimer()
    clearIdleTimer()
    closeSource()
    status.value = 'standby'
  }

  function clear() {
    lines.value = []
  }

  onUnmounted(stop)

  return { lines, status, start, stop, clear }
}
