// ── 配置导出/导入文件格式 ────────────────────────────────────
// 后端 /api/settings/export-config 生成的 JSON 结构 (settings.py 逐字段核对),
// 向导导入 (useWizardState.handleImportFile) 与设置页导入共用同一格式。
// 导入按「有则应用」语义逐字段探测, 所有字段可选。

import type { SyncRule } from './sync'

/** LLM provider 凭据 (llm_provider_keys[provider] 的值) */
export interface LlmProviderKeys {
  api_key?: string
  base_url?: string
  model?: string
}

/** 导出的配置文件结构 (_version 缺失即视为非法格式) */
export interface ExportedConfig {
  /** 格式版本, 导入侧以此判定合法性 */
  _version: number
  /** ISO 导出时间 */
  _exported_at?: string
  password?: string
  civitai_token?: string
  install_fa2?: boolean
  install_sa2?: boolean
  rclone_config_base64?: string
  extra_plugins?: string[]
  disabled_default_plugins?: string[]
  sync_rules?: SyncRule[]
  sync_settings?: Record<string, unknown>
  comfyui_params?: Record<string, unknown>
  cf_api_token?: string
  cf_domain?: string
  cf_subdomain?: string
  cf_custom_services?: unknown
  cf_suffix_overrides?: unknown
  api_key?: string
  tunnel_mode?: string
  ssh_keys?: string[]
  ssh_pw_follow?: boolean
  cf_protocol?: string
  llm_provider?: string
  llm_temperature?: number
  llm_max_tokens?: number
  llm_stream?: boolean
  llm_provider_keys?: Record<string, LlmProviderKeys>
  prompt_settings?: Record<string, unknown>
  browsing_level?: number
  blur?: boolean
}