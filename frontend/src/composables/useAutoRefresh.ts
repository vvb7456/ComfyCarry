import { ref, onUnmounted } from 'vue'

/**
 * Periodic auto-refresh composable.
 * Automatically stops on component unmount.
 */
export function useAutoRefresh(fn: () => Promise<void>, interval: number) {
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false
  const active = ref(false)

  async function tick() {
    if (running) return
    running = true
    try { await fn() } finally { running = false }
  }

  function start(opts?: { immediate?: boolean }) {
    if (timer) return
    if (opts?.immediate !== false) tick()
    timer = setInterval(tick, interval)
    active.value = true
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    active.value = false
  }

  onUnmounted(stop)

  /** Alias for start — resume after a pause */
  const resume = start
  /** Alias for stop — pause without destroying */
  const pause = stop

  return { active, start, stop, resume, pause }
}
