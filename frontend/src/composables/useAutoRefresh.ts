import { ref, onUnmounted } from 'vue'
import { isTunnelSwitchFrozen } from './useTunnelSwitch'

export function useAutoRefresh(fn: () => Promise<void>, interval: number) {
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false
  const active = ref(false)

  async function tick() {
    // 隧道切换期间冻结所有自动刷新 (window.fetch 已被置换, 发请求也只会挂起)
    if (isTunnelSwitchFrozen()) return
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

  const resume = start
  const pause = stop

  return { active, start, stop, resume, pause }
}
