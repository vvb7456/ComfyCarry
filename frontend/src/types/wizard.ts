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
  params: Record<string, unknown>
}

export interface WizardConfig {
  image_type: string
  password: string
  tunnel_mode: '' | 'public' | 'custom'
  cf_api_token: string
  cf_domain: string
  cf_subdomain: string
  public_tunnel_subdomain?: string
  rclone_config_method: 'skip' | 'file' | 'manual' | 'base64_env'
  rclone_config_value: string
  civitai_token: string
  plugins: string[]
  install_fa2: boolean
  install_sa2: boolean
  ssh_password: string
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
  /** Runtime-only: SSH password syncs with dashboard password */
  ssh_pw_sync?: boolean
}

// ── Plugins ──────────────────────────────────────────────────

export interface PluginInfo {
  url: string
  name: string
  required?: boolean
}

// ── Sync Templates (from backend SYNC_RULE_TEMPLATES) ───────

export interface SyncTemplate {
  id: string
  name: string
  direction: 'pull' | 'push'
  remote_path: string
  local_path: string
  method: 'copy' | 'move'
  trigger: 'deploy' | 'watch' | 'manual'
  watch_interval?: number
  filters?: string[]
}

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
  icon: string
  oauth?: boolean
  fields: RemoteFieldDef[]
}

// ── Detected Remote (from POST /api/setup/preview_remotes) ──

export interface DetectedRemote {
  name: string
  type: string
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
  level: 'info' | 'warn' | 'error' | 'output'
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
  rclone_has_env?: boolean
  public_tunnel?: boolean
}

export interface SetupState {
  completed: boolean
  current_step: number
  image_type: string
  password: string
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
  ssh_password?: string
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
  has_rclone_config: boolean

  // LLM fields (saved via /api/setup/save)
  llm_provider?: string
  llm_api_key?: string
  llm_base_url?: string
  llm_model?: string

  // Runtime-only fields (from import)
  _imported_sync_rules?: boolean
  _imported_sync_rules_count?: number
}
