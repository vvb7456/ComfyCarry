import { ref, onUnmounted } from 'vue'
import { useExecTracker, type ComfyEvent, type EventResult } from './useExecTracker'

export interface ComfySSEOptions {
  /** Called after tracker.handleEvent(). `result` is the return value (contains `finished` on execution end). */
  onEvent?: (event: ComfyEvent, result?: EventResult) => void
  reconnectDelay?: number
}

/**
 * ComfyUI SSE event stream composable.
 * Connects to /api/comfyui/events and delegates to an ExecTracker.
 * Auto-reconnects on error. Auto-closes on component unmount.
 */
export function useComfySSE(
  tracker: ReturnType<typeof useExecTracker>,
  opts: ComfySSEOptions = {},
) {
  const active = ref(false)
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const delay = opts.reconnectDelay ?? 3000

  function start() {
    stop()
    source = new EventSource('/api/comfyui/events')
    source.onopen = () => { active.value = true }
    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        const result = tracker.handleEvent(event)
        opts.onEvent?.(event, result || undefined)
      } catch { /* ignore malformed events */ }
    }
    source.onerror = () => {
      active.value = false
      source?.close()
      source = null
      // Auto-reconnect
      reconnectTimer = setTimeout(start, delay)
    }
  }

  function stop() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (source) { source.close(); source = null }
    active.value = false
  }

  onUnmounted(stop)

  return { active, start, stop }
}
