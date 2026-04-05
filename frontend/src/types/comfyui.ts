// ── ComfyUI Data Types ────────────────────────────────────────

export interface ComfyDevice {
  name: string
  vram_total: number
  vram_free: number
  torch_vram_total: number
  torch_vram_free: number
}

export interface ComfyStatus {
  online: boolean
  pm2_status: string
  system: {
    comfyui_version: string
    python_version: string
    pytorch_version: string
  }
  devices: ComfyDevice[]
  queue_running: number
  queue_pending: number
  pm2_uptime: number
  pm2_restarts: number
  args: string[]
}

export type ParamOption = string | [string, string]

export interface ParamSchema {
  type: string
  label: string
  value: string | number | boolean
  options?: ParamOption[]
  help?: string
  depends_on?: Record<string, string | boolean>
  flag?: string
  flag_map?: Record<string, string>
  flag_prefix?: string
}

// ── API Responses ─────────────────────────────────────────────

export interface ComfyParamsResponse {
  schema?: Record<string, ParamSchema>
  current?: Record<string, string | number | boolean>
}

export interface ComfyParamsSaveResponse {
  ok?: boolean
  error?: string
}

export interface ComfyQueueResponse {
  queue_running?: unknown[]
  queue_pending?: unknown[]
}

export interface ComfyHistoryItem {
  prompt_id: string
  completed?: boolean
  timestamp?: string
  images?: Array<{
    filename: string
    subfolder: string
    type: string
  }>
  [key: string]: unknown
}

export interface ComfyHistoryResponse {
  history?: ComfyHistoryItem[]
}

// ── Version Management ────────────────────────────────────────

export interface ComfyVersionsResponse {
  versions: string[]
  current: string | null
  latest: string | null
  has_git: boolean
}

export interface ComfyVersionSwitchResponse {
  ok: boolean
  message?: string
  error?: string
  warning?: string
  previous?: string
  current?: string
}
