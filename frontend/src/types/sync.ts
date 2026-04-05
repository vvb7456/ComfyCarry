// ── Sync Data Types ───────────────────────────────────────────

export interface StorageInfo {
  used?: number
  total?: number
  free?: number
  trashed?: number
  error?: string
}

export interface RemoteField {
  key: string
  label: string
  type?: 'text' | 'password' | 'select' | 'textarea'
  required?: boolean
  default?: string
  placeholder?: string
  options?: string[]
  help?: string
}

export interface RemoteTypeDef {
  label: string
  icon?: string
  oauth?: boolean
  fields?: RemoteField[]
}

export interface Remote {
  name: string
  type: string
  display_name?: string
  icon?: string
  has_auth?: boolean
}

export interface SyncRule {
  id: string
  name: string
  direction: 'pull' | 'push'
  remote: string
  remote_path: string
  local_path: string
  method: 'copy' | 'sync' | 'move'
  trigger: 'manual' | 'deploy' | 'watch'
  enabled: boolean
  filters?: string[] | string
}

export interface SyncTemplate {
  id?: string
  name: string
  direction: 'pull' | 'push'
  method: 'copy' | 'sync' | 'move'
  trigger: 'manual' | 'deploy' | 'watch'
  local_path?: string
  remote_path?: string
  description?: string
  filters?: string[]
  watch_interval?: number
}

export interface SyncSettings {
  min_age: number
  watch_interval: number
}

// ── API Responses ─────────────────────────────────────────────

export interface SyncStatusResponse {
  worker_running: boolean
  pm2_status?: string
  log_lines?: Array<{ ts: string; level: string; key: string; params?: Record<string, unknown> }>
  rules: SyncRule[]
  templates: SyncTemplate[]
  settings?: SyncSettings
}

export interface RemotesResponse {
  remotes: Remote[]
}

export interface StorageResponse {
  storage: Record<string, StorageInfo>
}

export interface RemoteTypesResponse {
  types: Record<string, RemoteTypeDef>
}

export interface RulesSaveResponse {
  ok?: boolean
  rules?: SyncRule[]
  message?: string
  error?: string
}

export interface BrowseResponse {
  ok?: boolean
  dirs?: string[]
  error?: string
}

export interface RcloneConfigResponse {
  config: string
  exists: boolean
}

export interface ApiOkResponse {
  ok?: boolean
  message?: string
  error?: string
}
