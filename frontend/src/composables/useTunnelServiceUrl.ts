import { ref } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'

interface TunnelStatusPayload {
  effective_status?: string
  urls?: Record<string, string>
  public?: { urls?: Record<string, string> }
}

/**
 * 读取指定服务（如 'comfyui' / 'jupyter'）的在线隧道访问地址（合并自定义与公共隧道）。
 */
export function useTunnelServiceUrl(serviceKeyword: string) {
  const { get } = useApiFetch()
  const tunnelUrl = ref('')
  const tunnelLoaded = ref(false)
  const keyword = serviceKeyword.toLowerCase()

  async function loadTunnelUrl() {
    try {
      const data = await get<TunnelStatusPayload>('/api/tunnel/status', { silent: true })
      if (data?.effective_status !== 'online') {
        tunnelUrl.value = ''
        return
      }
      const urls: Record<string, string> = { ...(data.urls || {}), ...(data.public?.urls || {}) }
      const hit = Object.entries(urls).find(([name]) => name.toLowerCase().includes(keyword))
      tunnelUrl.value = hit ? hit[1] : ''
    } finally {
      tunnelLoaded.value = true
    }
  }

  return { tunnelUrl, tunnelLoaded, loadTunnelUrl }
}
