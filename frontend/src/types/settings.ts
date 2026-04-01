// ── Settings Data Types ───────────────────────────────────────

export interface SettingsResponse {
  civitai_key_set?: boolean
  civitai_key?: string
  api_key?: string
}

export interface PasswordChangeResponse {
  message?: string
  error?: string
}

export interface ApiKeyResponse {
  ok?: boolean
  api_key?: string
  error?: string
}

export interface CivitaiKeyResponse {
  ok?: boolean
  error?: string
}

export interface ReinitializeResponse {
  ok?: boolean
  errors?: string[]
}

// ── LLM Types ─────────────────────────────────────────────────

export interface LlmProvider {
  id: string
  name: string
}

export interface ModelOption {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: number; completion?: number }
}

export interface LlmConfigData {
  provider?: string
  provider_keys?: Record<string, { api_key?: string; model?: string; base_url?: string }>
  base_url?: string
  temperature?: number
  max_tokens?: number
  stream?: boolean
  model?: string
}

export interface LlmProvidersResponse {
  providers?: LlmProvider[]
}

export interface LlmConfigResponse {
  ok?: boolean
  data?: LlmConfigData
}

export interface LlmModelsResponse {
  ok?: boolean
  models?: ModelOption[]
  error?: string
}

export interface LlmTestResponse {
  ok?: boolean
  latency_ms?: number
  response?: string
  error?: string
}
