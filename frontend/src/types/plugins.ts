// ── Plugin Data Types ─────────────────────────────────────────

export interface InstalledRaw {
  cnr_id?: string
  aux_id?: string
  ver?: string
  enabled?: boolean
  is_nightly?: boolean
}

export interface PluginInfo {
  title?: string
  description?: string
  repository?: string
  reference?: string
  author?: string
  stars?: number
  installed?: string
  version?: string
  active_version?: string
  cnr_latest?: string
  last_update?: string
  files?: Record<string, unknown>
  state?: string
  'update-state'?: string
  [key: string]: unknown
}

export interface BrowseItem {
  id: string
  _title: string
  _desc: string
  _last_update: string
  title?: string
  description?: string
  repository?: string
  reference?: string
  author?: string
  stars?: number
  state?: string
  installed?: string
  version?: string
}

// ── API Responses ─────────────────────────────────────────────

export interface AvailablePluginsResponse {
  node_packs?: Record<string, PluginInfo>
  [key: string]: unknown
}

export interface PluginActionResponse {
  message?: string
  error?: string
}

export interface QueueStatusResponse {
  is_processing?: boolean
  total_count?: number
  done_count?: number
}

export interface UpdateCheckResponse {
  has_updates?: boolean
}
