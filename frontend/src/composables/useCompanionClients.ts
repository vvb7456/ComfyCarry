import { ref, onUnmounted, type Ref } from 'vue'
import { useApiFetch } from './useApiFetch'
import type { CompanionClient, CompanionServeStatus, CompanionClientsResponse } from '@/types/sync'
import type { TunnelData } from '@/types/tunnel'

/**
 * Companion 桌面客户端状态轮询。
 * - 间隔 20s 轮询 GET /api/companion/clients
 * - 「地址」栏不显示后端构造的 dav_url (面板先于 tunnel 启动时会固化本地地址),
 *   改取 /api/tunnel/status 的主域名 (与 Tunnel/SSH 页一致)。
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

  /** 从 tunnel status 提取主域名 (面板入口 URL)。 */
  function pickHostUrl(t: TunnelData | null): string {
    if (!t) return ''
    const all = { ...(t.urls || {}) }
    if (t.public?.urls) Object.assign(all, t.public.urls)
    // dashboard / comfycarry 是面板主域名 key
    for (const key of ['dashboard', 'comfycarry']) {
      for (const k of Object.keys(all)) {
        if (k.toLowerCase() === key) return all[k]
      }
    }
    // 回退: 任意非内部服务的 url
    for (const [k, v] of Object.entries(all)) {
      if (!['ssh', 'jupyter', 'jupyterlab', 'comfyui'].includes(k.toLowerCase())) return v
    }
    return ''
  }

  async function fetchClients() {
    loading.value = true
    try {
      const [d, td] = await Promise.all([
        get<CompanionClientsResponse>('/api/companion/clients'),
        get<TunnelData>('/api/tunnel/status'),
      ])
      if (d) {
        clients.value = d.clients || []
        serve.value = d.serve || null
      }
      davUrl.value = pickHostUrl(td || null)
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
