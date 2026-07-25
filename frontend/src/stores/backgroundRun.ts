import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'

export interface BackgroundStopReason {
  code: string
  detail: string
}

export interface BackgroundRunPolicy {
  max_iterations?: number
  min_free_disk_gb?: number
}

interface BackgroundRunResponse {
  state: 'idle' | 'running'
  iteration: number
  max_iterations: number
  started_at: number | null
  stop_reason: BackgroundStopReason | null
}

const POLL_INTERVAL_MS = 5000
const API_BASE = '/api/generate/background'

/**
 * 手动停止后的「静默窗」。
 *
 * 停止会让后端 interrupt 当前 prompt, ComfyUI 随即发 execution_interrupted;
 * 而 /stop 的响应一回来本地 state 就已经是 idle 了 —— 两者谁先到是竞态,
 * 单靠 `state === 'running'` 守卫会时灵时不灵。用一个时间窗兜住这段。
 */
const STOP_QUIET_MS = 3000

export const useBackgroundRunStore = defineStore('backgroundRun', () => {
  const { get, post } = useApiFetch()

  const state = ref<'idle' | 'running'>('idle')
  const iteration = ref(0)
  const maxIterations = ref(0)
  const startedAt = ref<number | null>(null)
  const stopReason = ref<BackgroundStopReason | null>(null)

  let pollTimer: ReturnType<typeof setInterval> | null = null

  function apply(resp: BackgroundRunResponse) {
    state.value = resp.state
    iteration.value = resp.iteration
    maxIterations.value = resp.max_iterations
    startedAt.value = resp.started_at
    stopReason.value = resp.stop_reason
  }

  async function refresh() {
    const d = await get<BackgroundRunResponse>(API_BASE)
    if (d) apply(d)
  }

  async function start(payload: Record<string, unknown>, policy: BackgroundRunPolicy) {
    const d = await post<BackgroundRunResponse>(`${API_BASE}/start`, { payload, policy })
    if (d) apply(d)
  }

  /** 最近一次手动停止的时刻; 仅供 recentlyStopped() 判窗, 不需要响应式 */
  let stoppedAt = 0

  /** 是否处于停止后的静默窗内 —— 供 SSE 侧决定要不要抑制 toast */
  function recentlyStopped() {
    return Date.now() - stoppedAt < STOP_QUIET_MS
  }

  async function stop() {
    stoppedAt = Date.now()
    const d = await post<BackgroundRunResponse>(`${API_BASE}/stop`)
    if (d) apply(d)
  }

  async function dismiss() {
    const d = await post<BackgroundRunResponse>(`${API_BASE}/dismiss`)
    if (d) apply(d)
  }

  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      if (document.hidden) return
      refresh()
    }, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  watch(state, (s) => {
    if (s === 'running') startPolling()
    else stopPolling()
  })

  function onVisibilityChange() {
    if (!document.hidden) refresh()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  function dispose() {
    stopPolling()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  return {
    state,
    iteration,
    maxIterations,
    startedAt,
    stopReason,
    refresh,
    start,
    stop,
    dismiss,
    dispose,
    recentlyStopped,
  }
})
