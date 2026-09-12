import type { SyncTemplate as SyncTemplateBase, ApiOkResponse } from './sync'

// ── GPU & Image ──────────────────────────────────────────────

export interface GpuInfo {
  name: string
  cuda_cap: string
  vram_gb: number
}

export interface PrebuiltInfo {
  version: string
  torch: string
  cuda_toolkit: string
  fa2: boolean
  build_date: string
}

// ── Wizard Config (submitted to POST /api/setup/deploy) ─────

export interface WizardSyncRule {
  template_id: string
  remote: string
  remote_path: string
}

export interface WizardRemote {
  name: string
  type: string
  /** 凭据只存服务端 (/api/setup/wizard_remote), 前端镜像不含 params */
  params?: Record<string, unknown>
  /** S3 存储桶 (参与规则路径首段; 后端安全投影, 非敏感) */
  bucket?: string
  drive_id?: string
  drive_type?: string
  team_drive?: string
}

/** POST /api/setup/wizard_remote(/delete) 响应: 剥离 params 的安全投影 */
export interface WizardRemotesResponse extends ApiOkResponse {
  wizard_remotes?: WizardRemote[]
}

export interface WizardConfig {
  password: string
  tunnel_mode: '' | 'public' | 'custom'
  cf_api_token: string
  cf_domain: string
  cf_subdomain: string
  public_tunnel_subdomain?: string
  /** 'skip' 无凭据; 'manual' 凭据内联在 wizard_remotes; 'base64' 仅由导入链路透传 (wizard 不产生) */
  rclone_config_method: 'skip' | 'manual' | 'base64'
  rclone_config_value: string
  civitai_token: string
  plugins: string[]
  install_fa2: boolean
  install_sa2: boolean
  ssh_keys: string[]
  wizard_sync_rules: WizardSyncRule[]
  wizard_remotes: WizardRemote[]
  llm_provider: string
  llm_api_key: string
  llm_base_url: string
  llm_model: string
  /** Runtime-only: display method before saveCurrentStep normalizes it */
  _rclone_display_method?: string
  /** Runtime-only: whether sync rules came from import, not wizard UI */
  _imported_sync_rules?: boolean
  /** Runtime-only: count of imported sync rules for summary display */
  _imported_sync_rules_count?: number
  /** Runtime-only: allow SSH login with the dashboard password (default on) */
  ssh_pw_follow?: boolean
}

// ── Plugins ──────────────────────────────────────────────────

export interface PluginInfo {
  url: string
  name: string
  required?: boolean
}

// ── Sync Templates (from backend SYNC_RULE_TEMPLATES) ───────
// 与 sync 页共用同一份定义 —— 两处各写一份时 id / local_path 的可选性和
// method 的取值集合已经漂移过 (wizard 侧漏了 'sync')。
// 向导侧的模板都来自后端常量, 这几个字段必有值, 故在此收窄为必填。

export type SyncTemplate = Required<
  Pick<SyncTemplateBase, 'id' | 'name' | 'direction' | 'method' | 'trigger' | 'remote_path' | 'local_path'>
> & Pick<SyncTemplateBase, 'watch_interval' | 'filters' | 'description'>

// ── Remote Type Definitions (from backend REMOTE_TYPE_DEFS) ─

export interface RemoteFieldDef {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'textarea'
  required?: boolean
  default?: string
  placeholder?: string
  options?: string[]
  help?: string
}

export interface RemoteTypeDef {
  label: string
  oauth?: boolean
  fields: RemoteFieldDef[]
}

// ── LLM ──────────────────────────────────────────────────────

export interface LlmProvider {
  id: string
  name: string
}

export interface LlmModel {
  id: string
  name?: string
}

// ── Deploy SSE Events ────────────────────────────────────────

export interface DeployStep {
  name: string
  status: 'active' | 'done' | 'error'
}

export type DeployStatus = 'idle' | 'deploying' | 'success' | 'error'

export interface DeployDoneEvent {
  type: 'done'
  success: boolean
  msg?: string
  attn_warnings?: string[]
}

export interface DeployLogEvent {
  type: 'log'
  level: 'info' | 'warn' | 'error' | 'success' | 'output'
  msg: string
  time?: string
}

export interface DeployStepEvent {
  type: 'step'
  name: string
  time?: string
}

export type DeploySSEEvent = DeployDoneEvent | DeployLogEvent | DeployStepEvent

// ── Setup State (GET /api/setup/state response) ─────────────

export type DetectedImageType = 'prebuilt' | 'unsupported' | 'unsupported-gpu' | 'no-gpu'

export interface SetupStateEnvVars {
  password?: string
  cf_api_token?: string
  cf_domain?: string
  cf_subdomain?: string
  civitai_token?: string
  rclone_config_method?: string
  public_tunnel?: boolean
}

export interface SetupState {
  password: string
  tunnel_mode?: string
  public_tunnel_subdomain?: string
  cf_api_token: string
  cf_domain: string
  cf_subdomain: string
  rclone_config_method: string
  rclone_config_value: string
  civitai_token: string
  plugins: string[]
  install_fa2: boolean
  install_sa2: boolean
  deploy_started: boolean
  deploy_completed: boolean
  deploy_error: string
  wizard_sync_rules?: WizardSyncRule[]
  wizard_remotes?: WizardRemote[]
  ssh_pw_follow?: boolean
  ssh_keys?: string[]

  // Enriched by the endpoint
  gpu_info: GpuInfo | null
  detected_image_type: string
  prebuilt_info: PrebuiltInfo | null
  plugins_available: PluginInfo[]
  env_vars: SetupStateEnvVars
  active_tunnel_mode?: string
  active_tunnel_urls?: Record<string, string>
  sync_templates: SyncTemplate[]
  remote_type_defs: Record<string, RemoteTypeDef>

  // LLM fields (deploy plan snapshot)
  llm_provider?: string
  llm_api_key?: string
  llm_base_url?: string
  llm_model?: string

  // Runtime-only fields (from import)
  _imported_sync_rules?: boolean
  _imported_sync_rules_count?: number
}
