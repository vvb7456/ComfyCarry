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

export interface InstalledPlugin {
  cnrId: string
  dirName: string
  title: string
  description: string
  repository: string
  author: string
  stars: number
  ver: string
  activeVersion: string
  cnrLatest: string
  enabled: boolean
  updateState: boolean
}

export interface PluginData {
  id: string
  dirName: string
  title: string
  description: string
  repository: string
  author: string
  stars: number
  ver: string
  activeVersion: string
  cnrLatest: string
  registryVersion: string
  enabled: boolean
  installed: boolean
  updateState: boolean
  lastUpdate: string
}

export type PluginStatusFilter = 'all' | 'installed' | 'not-installed' | 'update' | 'disabled'
export type PluginSortBy = 'stars' | 'update' | 'name'
export type AvailablePluginsResponse = Record<string, PluginInfo> | { node_packs: Record<string, PluginInfo> }

// ── API Responses ─────────────────────────────────────────────

/** 文案走 key + params (plugins.py 的 _err / _ok), 用 utils/apiError.ts 渲染 */
export interface PluginActionResponse {
  ok?: boolean
  message_key?: string
  message_params?: Record<string, unknown>
  error_key?: string
  error_params?: Record<string, unknown>
}

export interface QueueStatusResponse {
  is_processing?: boolean
  total_count?: number
  done_count?: number
}

export interface UpdateCheckResponse {
  has_updates?: boolean
}

// ── 待重启变更集 (pending_restart) ────────────────────────────

export type PendingRestartChange = 'added' | 'removed' | 'changed'

export interface PendingRestartPack {
  /** custom_nodes 目录名 (installed 列表的键) */
  id: string
  change: PendingRestartChange
  cnr_id?: string
  aux_id?: string
}

export interface PendingRestartResponse {
  needs_restart?: boolean
  packs?: PendingRestartPack[]
}

// ── Manager 队列事件 (bridge 转发的 cm-queue-status) ─────────

export interface CMQueueStatusData {
  status?: 'in_progress' | 'done'
  /** ui_id — 提交操作时前端生成的 uuid */
  target?: string
  ui_target?: string
  /** ui_id → 'success' | 'skip' | 错误原文 */
  nodepack_result?: Record<string, string>
  model_result?: Record<string, string>
  total_count?: number
  done_count?: number
}
