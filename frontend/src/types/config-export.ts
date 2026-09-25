// 后端 /api/settings/export-config 生成的 JSON 结构 (settings.py 逐字段核对),
// 向导导入 (useWizardState.handleImportFile) 与设置页导入共用同一格式。
// 导入按「有则应用」语义逐字段探测, 所有字段可选。

import type { SyncRule } from './sync'

export interface LlmProviderKeys {
  api_key?: string
  base_url?: string
  model?: string
}

/** 收藏模型条目 (civitai_favorites 行, all_versions_json 已反序列化) */
export interface FavoriteExportItem {
  fav_key: string
  model_id: string
  version_id?: string
  name?: string
  model_type?: string
  image_url?: string
  version_name?: string
  base_model?: string
  all_versions?: Array<{ id: number | string; name?: string; baseModel?: string }>
  created_at?: number
}

/** 提示词历史条目 (prompt_history 行, 含软删除标记) */
export interface PromptHistoryExportItem {
  id: number
  positive: string
  negative: string
  name: string
  is_favorite: number
  created_at: number
  is_deleted: number
}

/** 导出的配置文件结构 (_version 缺失即视为非法格式) */
export interface ExportedConfig {
  public_tunnel_subdomain?: string
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
  /** 真正生效的 ComfyUI 启动参数 (--flag value 串) */
  comfyui_args?: string
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
  civitai_nsfw_level?: number
  civitai_nsfw_blur?: boolean
  favorites?: FavoriteExportItem[]
  prompt_history?: PromptHistoryExportItem[]
}
