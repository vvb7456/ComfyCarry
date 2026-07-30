// ── Sync Data Types ───────────────────────────────────────────

export interface StorageInfo {
  used?: number
  total?: number
  free?: number
  trashed?: number
  /** rclone 原始错误 (不可枚举, 不翻译) */
  error?: string
  /** 可枚举的错误: 前端按 key 翻译, 见 utils/apiError.ts */
  error_key?: string
  error_params?: Record<string, unknown>
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
  oauth?: boolean
  fields?: RemoteField[]
}

export interface Remote {
  name: string
  type: string
  display_name?: string
  has_auth?: boolean
  /** rclone.conf 里的非敏感配置项 (s3 的 provider 用于选品牌 logo) */
  params?: Record<string, string>
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

// ── Companion (桌面客户端) ──────────────────────────────────

export interface CompanionProgress {
  file?: string
  pct?: number
  speed?: number
}

/** 客户端上报的只读规则摘要 */
export interface CompanionRuleSummary {
  name?: string
  source?: string
  local_path?: string
  method?: string
  trigger?: string
  last_result?: string
}

/** rclone serve webdav 进程状态 */
export interface CompanionServeStatus {
  running: boolean
  pid?: number
  addr?: string
  baseurl?: string
  serve_root?: string
}

export interface CompanionClient {
  client_id: string
  hostname: string
  app_version: string
  /** idle | syncing | paused | error */
  status: string
  active_rule_id: string
  progress?: CompanionProgress
  rule_summaries?: CompanionRuleSummary[]
  last_seen: number
  online: boolean
}

export interface CompanionClientsResponse {
  clients: CompanionClient[]
  serve?: CompanionServeStatus
  dav_url?: string
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
  /** 正在执行的 job；本页的进度显示走 useSyncJobs 的独立轮询, 这里仅为契约完整 */
  current_job_id?: string | null
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

export interface RulesSaveResponse extends ApiOkResponse {
  /** 后端规范化 (local_path 转 workspace 根相对、字段校验) 后的规则, 以此为准 */
  rules?: SyncRule[]
}

export interface BrowseResponse {
  ok?: boolean
  dirs?: string[]
  error_key?: string
  error_params?: Record<string, unknown>
}

export interface RcloneConfigResponse {
  config: string
  exists: boolean
}

/**
 * 通用响应信封。文案一律 key + params (后端 sync.py 的 _err / _ok),
 * 用 utils/apiError.ts 的 apiErrorText / apiMessageText 渲染。
 * error / message 是未接 i18n 的其他模块留下的原文字段。
 */
export interface ApiOkResponse {
  ok?: boolean
  message_key?: string
  message_params?: Record<string, unknown>
  error_key?: string
  error_params?: Record<string, unknown>
  message?: string
  error?: string
}
