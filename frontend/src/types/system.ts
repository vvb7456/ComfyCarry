// ── System Metrics Types (from /api/system/stats) ─────────────

export interface GpuInfo {
  index: number
  name: string
  util: number
  mem_used: number
  mem_total: number
  mem_free: number
  temp: number
  power: number
  power_limit: number
}

export interface SystemStats {
  ts: number
  gpu: GpuInfo[]
  cpu: {
    percent: number
    cores: number
    freq?: Record<string, number>
    load: Record<string, number>
  }
  memory: {
    percent: number
    used: number
    total: number
    available: number
  }
  disk: {
    percent: number
    used: number
    free: number
    total: number
    path: string
  }
  network?: {
    bytes_sent: number
    bytes_recv: number
    packets_sent: number
    packets_recv: number
  }
  uptime?: string
}
