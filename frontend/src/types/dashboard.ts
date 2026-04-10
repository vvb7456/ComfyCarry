// ── Dashboard Data Types ──────────────────────────────────────

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

/** Fast-changing activity data from GET /api/activity (5s poll) */
export interface ActivityData {
  comfyui: {
    online: boolean
    queue_running: number
    queue_pending: number
    executing?: boolean
    exec_start_time?: number
    progress?: { value: number; max: number }
  }
  downloads: {
    active_count: number
    active: DownloadTask[]
    queue_count: number
  }
  sync: {
    worker_running: boolean
    last_log_lines: Array<string | SyncLogEntry>
  }
}
