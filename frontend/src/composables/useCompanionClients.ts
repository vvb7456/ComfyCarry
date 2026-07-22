import { ref, onUnmounted, type Ref } from 'vue'
import { useApiFetch } from './useApiFetch'
import type { CompanionClient, CompanionServeStatus, CompanionClientsResponse } from '@/types/sync'

/**
 * Companion 桌面客户端状态轮询。
 * - 间隔 20s 轮询 GET /api/companion/clients
 * - onUnmounted 自动停；只在显式 start/stop 之间运行
 */
export function useCompanionClients(opts?: { pollInterval?: number }) {
  const { get, del } = useApiFetch()

  const clients: Ref<CompanionClient[]> = ref([])
  const serve = ref<CompanionServeStatus | null>(null)
  const davUrl = ref('')
  const loading = ref(false)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const pollMs = opts?.pollInterval ?? 20_000

  async function fetchClients() {
    loading.value = true
    try {
      const d = await get<CompanionClientsResponse>('/api/companion/clients')
      if (d) {
        clients.value = d.clients || []
        serve.value = d.serve || null
        davUrl.value = d.dav_url || ''
      }
    } finally {
      loading.value = false
    }
  }

  function startPolling() {
    stopPolling()
    fetchClients()
    pollTimer = setInterval(fetchClients, pollMs)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /** 忘记客户端 (从面板记录中删除) */
  async function forgetClient(clientId: string): Promise<boolean> {
    const d = await del<{ ok?: boolean; error?: string }>(`/api/companion/clients/${encodeURIComponent(clientId)}`)
    return !!d?.ok
  }

  onUnmounted(stopPolling)

  return {
    clients,
    serve,
    davUrl,
    loading,
    fetchClients,
    forgetClient,
    startPolling,
    stopPolling,
  }
}
