import { ref, onUnmounted } from 'vue'

export type GateState = 'checking' | 'ready' | 'offline' | 'starting' | 'error'

/**
 * ComfyUI online detection gate.
 * Polls /api/comfyui/status when not ready (5s interval).
 * Uses plain fetch to avoid toast spam on expected failures.
 *
 * States:
 * - checking: initial state, first check in progress
 * - ready:    ComfyUI is running and responding
 * - starting: PM2 process is online but HTTP not yet responding
 * - offline:  PM2 process is not running
 * - error:    Cannot reach Dashboard API at all
 */
export function useComfyGate() {
  const state = ref<GateState>('checking')
  let timer: ReturnType<typeof setInterval> | null = null

  async function checkNow(): Promise<void> {
    try {
      const res = await fetch('/api/comfyui/status')
      if (res.ok) {
        const data = await res.json()
        if (data.online) {
          state.value = 'ready'
        } else if (data.pm2_status === 'online') {
          // PM2 process running but ComfyUI HTTP not ready yet
          state.value = 'starting'
        } else {
          state.value = 'offline'
        }
      } else {
        state.value = 'error'
      }
    } catch {
      state.value = 'error'
    }

    // Auto-manage polling based on state
    if (state.value !== 'ready') {
      if (!timer) timer = setInterval(checkNow, 5000)
    } else {
      if (timer) { clearInterval(timer); timer = null }
    }
  }

  function stopPolling() {
    if (timer) { clearInterval(timer); timer = null }
  }

  onUnmounted(stopPolling)

  return { state, checkNow, stopPolling }
}
