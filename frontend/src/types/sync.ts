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

/** /api/sync/remote/delete 响应: 删除 remote 时若清理了引用该 remote 的规则, 会带 rules_removed。 */
export interface RemoteDeleteResponse extends ApiOkResponse {
  /** 被一并清理的引用该 remote 的规则数 (0 表示没有规则引用它) */
  rules_removed?: number
}

export interface BrowseResponse {
  ok?: boolean
  dirs?: string[]
  error_key?: string
  error_params?: Record<string, unknown>
}

/**
 * staged 凭据 (browse/mkdir 的可选参数): 凭据不经落盘直接探测远程 ——
 * env 注入 RCLONE_CONFIG_* 由后端执行, 三种来源互斥:
 * - wizard: true → 服务端 setup state 的 wizard_remotes 计划
 * - oauth:  true → 服务端 authorize 会话 (dashboard OAuth 流程)
 * - params: 直传 (dashboard 非 OAuth 流程, 与最终 create 同参)
 */
export interface StagedCreds {
  wizard?: boolean
  oauth?: boolean
  type?: string
  params?: Record<string, string>
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

// ── OAuth 授权会话 (网盘「登录授权」向导, spec §2.2) ──────────

/**
 * 授权会话状态机 (后端 OAuthSessionManager 单例):
 * idle → starting → url_ready → exchanging → done, 失败/超时/取消 → error/idle
 */
export type OAuthPhase = 'idle' | 'starting' | 'url_ready' | 'exchanging' | 'done' | 'error'

/** GET /api/sync/remote/oauth/status 响应 (轮询, 2s) */
export interface OAuthStatusResponse {
  phase: OAuthPhase
  /** phase=url_ready 时的供应商授权页 URL (后端已完成 307 解析, 非容器本机 /auth 链接) */
  provider_url?: string
  /** phase=error 时的原始错误 */
  error?: string
  /** 当前会话的 remote 类型 (409 恢复时判断会话是否属于当前选择的类型) */
  remote_type?: string
}

/**
 * POST /api/sync/remote/oauth/{start,paste,cancel} 响应。
 * 成功: {ok:true, phase:...}; 失败沿用 ApiOkResponse 错误信封。
 * token 永不出现在这些响应里 (spec §2.2 铁律)。
 */
export interface OAuthSessionResponse extends ApiOkResponse {
  phase?: OAuthPhase
}

/** POST /api/sync/remote/create 请求体 — oauth=true 时后端从刚完成的授权会话取 token */
export interface RemoteCreateRequest {
  name: string
  type: string
  params?: Record<string, string>
  /** true = 走 OAuth 会话创建 (token 全程在后端, 前端不经手) */
  oauth?: boolean
  /** true = 同名 remote 原地替换凭据 (规则不受影响); 缺省同名时后端返回 409 */
  overwrite?: boolean
}

/** 驱动器/云端硬盘条目 (GET /api/sync/remote/oauth/drives, spec §3.2) */
export interface OAuthDriveItem {
  id: string
  name: string
  /** OneDrive: personal | business | documentLibrary; Drive: 共享盘为空或省略 */
  type?: string
}

/** GET /api/sync/remote/oauth/drives 响应 */
export interface DrivesResponse extends ApiOkResponse {
  drives?: OAuthDriveItem[]
}

/** POST /api/setup/wizard_remote 请求体 (spec §3.3) */
export interface WizardRemoteRequest {
  name: string
  type: string
  params?: Record<string, string>
  /** true = 同名条目原地替换; 缺省同名时后端返回 400 */
  overwrite?: boolean
}
