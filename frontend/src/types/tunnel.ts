// ── Tunnel Data Types ─────────────────────────────────────────

export interface TunnelService {
  name: string
  port: number
  suffix: string
  protocol: string
  custom: boolean
}

export interface TunnelConnection {
  colo_name: string
}

export interface TunnelInfo {
  tunnel_id?: string
  connections?: TunnelConnection[]
}

export interface PublicTunnelInfo {
  random_id?: string
  urls: Record<string, string>
}

export interface TunnelData {
  tunnel_mode: string | null
  configured: boolean
  effective_status: string
  cloudflared: string
  urls: Record<string, string>
  services: TunnelService[]
  tunnel: TunnelInfo
  public?: PublicTunnelInfo
  subdomain: string
  domain: string
  cf_domain?: string
  cf_protocol?: string
}

// ── API Responses ─────────────────────────────────────────────

export interface TunnelConfigResponse {
  api_token?: string
  domain?: string
  subdomain?: string
}

export interface TunnelSubdomainResponse {
  ok?: boolean
  subdomain?: string
}

export interface TunnelCapacityResponse {
  capacity?: {
    active_tunnels: number
    max_tunnels: number
    available: boolean
  }
}

export interface TunnelValidationResponse {
  ok?: boolean
  account_name?: string
  zone_status?: string
  /** 文案走 key + params, 用 utils/apiError.ts 渲染 */
  message_key?: string
  message_params?: Record<string, unknown>
  error_key?: string
  error_params?: Record<string, unknown>
}

export interface TunnelActionResponse {
  ok?: boolean
  error?: string
  error_key?: string
  error_params?: Record<string, unknown>
}
