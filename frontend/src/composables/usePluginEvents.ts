import { onUnmounted, ref } from 'vue'
import type { CMQueueStatusData } from '@/types/plugins'

/**
 * 订阅 /api/comfyui/events 中 bridge 转发的 ComfyUI-Manager 队列事件
 * (cm_queue_status), 用于插件行级状态跟踪。自动重连, 卸载时关闭。
 *
 * 注意: EventSource 断线重连期间的事件会丢失; 调用方需保留
 * queue_status 轮询的 onIdle 兜底 (清行状态 + 刷列表)。
 */
export function usePluginEvents(onEvent: (data: CMQueueStatusData) => void) {
  const connected = ref(false)
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function start() {
    stop()
    source = new EventSource('/api/comfyui/events')
    source.onopen = () => { connected.value = true }
    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'cm_queue_status') onEvent(event.data ?? {})
      } catch { /* ignore malformed events */ }
    }
    source.onerror = () => {
      connected.value = false
      source?.close()
      source = null
      reconnectTimer = setTimeout(start, 3000)
    }
  }

  function stop() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (source) { source.close(); source = null }
    connected.value = false
  }

  onUnmounted(stop)

  return { connected, start, stop }
}
