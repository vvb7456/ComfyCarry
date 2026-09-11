import { ref, onUnmounted, type Ref } from 'vue'
import { useApiFetch } from './useApiFetch'
import type { CompanionClient, CompanionServeStatus, CompanionClientsResponse } from '@/types/sync'
import type { TunnelData } from '@/types/tunnel'

/**
 * Companion 桌面客户端状态轮询。
 * - 间隔 20s 轮询 GET /api/companion/clients (后端只返回在线客户端, 不持久化连接记录)
 * - hostUrl 是「面板公网主域名」(与 Tunnel/SSH 页同源), 不含任何路径。客户端拿它 +
 *   面板密码调 POST /api/companion/connect, 由后端回传真正的 WebDAV 地址
 *   (`<域名>/api/companion/dav`)。
 * - 不用 /api/companion/clients 自带的 dav_url: 它是**请求视角**推断的 (优先
 *   X-Forwarded-*, 回退 request.host_url), 面板先于 tunnel 启动或局域网直连时会被
 *   固化成 127.0.0.1, 复制给用户就是错的。
 * - tunnelOnline 取自 tunnel effective_status: 隧道服务未启动 / 在连接中时为 false,
 *   配合 hostUrl 为空即可判定「拿不到公网地址」。
 * - onUnmounted 自动停；只在显式 start/stop 之间运行
 */
export function useCompanionClients(opts?: { pollInterval?: number }) {
  const { get } = useApiFetch()

  const clients: Ref<CompanionClient[]> = ref([])
  const serve = ref<CompanionServeStatus | null>(null)
  const hostUrl = ref('')
  const tunnelOnline = ref(false)
  const loading = ref(false)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const pollMs = opts?.pollInterval ?? 20_000

  /**
   * 从 tunnel status 提取面板公网主域名。
   *
   * 只认服务名 `dashboard` (公共 Tunnel 的注册服务名) 与 `comfycarry` (自定义
   * Tunnel 的默认服务名 `ComfyCarry`), 大小写不敏感。**不做兜底猜测**: 自定义
   * Tunnel 里其它 key 可能是任意子域名服务 (非默认端口会退化成 `Service:<port>`),
   * 猜错等于把别的服务地址当成面板地址复制给用户 —— 取不到就回空, 由调用方降级成
   * 「无法获取连接地址」提示。
   */
  function pickHostUrl(t: TunnelData | null): string {
    if (!t) return ''
    const all = { ...(t.urls || {}) }
    if (t.public?.urls) Object.assign(all, t.public.urls)
    for (const key of ['dashboard', 'comfycarry']) {
      for (const k of Object.keys(all)) {
        if (k.toLowerCase() === key) return all[k]
      }
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
      hostUrl.value = pickHostUrl(td || null)
      tunnelOnline.value = td?.effective_status === 'online'
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

  onUnmounted(stopPolling)

  return {
    clients,
    serve,
    hostUrl,
    tunnelOnline,
    loading,
    fetchClients,
    startPolling,
    stopPolling,
  }
}
