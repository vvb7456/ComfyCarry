// ── Token System ──────────────────────────────────────────────

export type TokenType = 'tag' | 'raw' | 'embedding' | 'wildcard' | 'template' | 'break'
export type BracketType = 'round' | 'none'

export interface PromptToken {
  id: string
  raw: string
  tag: string
  type: TokenType
  weight: number
  bracketType: BracketType
  bracketDepth: number
  explicitWeight: boolean
  enabled: boolean
  translate?: string
  groupColor?: string
}

// ── Tag Library ───────────────────────────────────────────────

export interface PromptGroup {
  id: number
  name: string
  translate: string
  color: string
  is_nsfw: number
}

export interface PromptSubgroup {
  id: number
  name: string
  translate: string
  color: string
  group_id: number
}

export interface PromptTag {
  id: number
  text: string
  translate: string
  color: string
  subgroup_id: number
}

export interface PromptSubgroupTree extends PromptSubgroup {
  tags: PromptTag[]
}

export interface PromptGroupTree extends PromptGroup {
  subgroups: PromptSubgroupTree[]
}

// ── Autocomplete ──────────────────────────────────────────────

export interface AutocompleteItem {
  text: string
  desc: string
  color: string
  source: 'library' | 'danbooru'
  score: number
  hot?: number
}

// ── History / Favorites ───────────────────────────────────────

export type HistoryType = 'all' | 'history' | 'favorite'

export interface PromptHistoryItem {
  id: number
  positive: string
  negative: string
  name: string
  is_favorite: number
  created_at: number
}

export interface PromptHistoryPage {
  items: PromptHistoryItem[]
  total: number
  page: number
  size: number
}

// ── Translation ───────────────────────────────────────────────

export interface TranslateResult {
  translate: string
  provider: string
  from_db: boolean
  error?: string
}

export interface TranslateWordResult {
  translate: string
  from_db: boolean
}

export interface TranslateProvidersResult {
  providers: string[]
  default_chain: string[]
}

// ── Library Status ────────────────────────────────────────────

export interface PromptLibraryStatus {
  initialized: boolean
  groups: number
  tags: number
  danbooru: number
  history: number
}

// ── Init / Import ─────────────────────────────────────────────

export interface InitSourceStatus {
  available: boolean
  download_url: string | null
  initialized: boolean
  groups: number
  tags: number
  danbooru: number
  history: number
}

export interface ImportResult {
  success: boolean
  prompt_groups: number
  prompt_subgroups: number
  prompt_tags: number
  danbooru_tags: number
}

// ── Editor Settings ───────────────────────────────────────────

export interface PromptEditorSettings {
  show_translation: boolean
  show_nsfw: boolean
  normalize_comma: boolean
  normalize_period: boolean
  normalize_bracket: boolean
  normalize_underscore: boolean
  comma_close_autocomplete: boolean
  escape_bracket: boolean
  autocomplete_limit: number
  translate_provider: string
  // 后端附加的只读字段
  translate_providers?: string[]
  translate_default_chain?: string[]
}

// ── API Response Wrappers ─────────────────────────────────────

export interface PromptLibraryDataResponse<T> {
  data: T
}

export interface PromptLibraryErrorResponse {
  error: string
}
