// ── Dashboard Data Types ──────────────────────────────────────

export interface GpuInfo {
  name: string
  util: number
  mem_used: number
  mem_total: number
  temp: number
  power: number
  power_limit: number
}

export interface SyncLogEntry {
  ts?: string
  key?: string
  params?: Record<string, unknown>
  level?: string
}

export interface DownloadTask {
  filename: string
  model_name?: string
  progress: number
  speed: string
}

export interface OverviewData {
  comfyui: {
    online: boolean
    version: string
    pm2_status: string
    pm2_uptime: number
    queue_running: number
    queue_pending: number
    pytorch_version: string
    python_version: string
  }
  jupyter: {
    online: boolean
    pm2_status: string
  }
  sync: {
    worker_running: boolean
    rules_count: number
    watch_rules: number
    last_log_lines: Array<string | SyncLogEntry>
  }
  tunnel: {
    effective_status: string
    urls: Record<string, string>
    public?: { urls: Record<string, string> }
  }
  system: {
    gpu: GpuInfo[]
    cpu: { percent: number; cores: number; load: Record<string, number> }
    memory: { percent: number; used: number; total: number }
    disk: { percent: number; used: number; free: number; total: number; path: string }
  }
  downloads: {
    active_count: number
    active: DownloadTask[]
    queue_count: number
  }
  services: Array<{
    name: string
    status: string
    uptime: string
    cpu: string
    memory: string
    restarts: number
  }>
  version: { version: string }
}

export type ServiceEntry = OverviewData['services'][number]
