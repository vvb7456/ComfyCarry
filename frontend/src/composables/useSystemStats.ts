/**
 * useSystemStats — Shared singleton composable for real-time system metrics.
 *
 * Polls GET /api/system/stats every 3s.
 * Multiple consumers (DashboardPage, ConsoleTab) share one polling loop.
 * Auto-start on first mount, auto-stop when all consumers unmount.
 */
import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import type { GpuInfo, SystemStats } from '@/types/system'

export type { GpuInfo, SystemStats }

const POLL_INTERVAL = 3000

// ── Singleton state ──
const stats = ref<SystemStats | null>(null)
let refCount = 0
let timer: ReturnType<typeof setInterval> | null = null
let fetching = false
// Store api reference from first consumer
let apiFetch: ReturnType<typeof useApiFetch> | null = null

async function poll() {
  if (fetching || !apiFetch) return
  fetching = true
  try {
    const d = await apiFetch.get<SystemStats>('/api/system/stats')
    if (d) stats.value = d
  } finally {
    fetching = false
  }
}

function startPolling(api: ReturnType<typeof useApiFetch>) {
  if (timer) return
  apiFetch = api
  poll()
  timer = setInterval(poll, POLL_INTERVAL)
}

function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  apiFetch = null
}

export function useSystemStats(): { stats: Ref<SystemStats | null> } {
  const api = useApiFetch()

  onMounted(() => {
    if (++refCount === 1) startPolling(api)
  })

  onUnmounted(() => {
    if (--refCount === 0) stopPolling()
  })

  return { stats }
}
