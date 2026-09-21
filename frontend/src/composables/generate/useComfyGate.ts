import { ref, onUnmounted } from 'vue'

export type GateState = 'checking' | 'ready' | 'offline' | 'starting' | 'error'

/**
 * Uses plain fetch to avoid toast spam on expected failures.
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
