/**
 * usePromptEditor — Token parsing, editing, and serialization composable.
 *
 * Core principle: string is the single source of truth.
 * Tokens are a derived view: parse(string) → tokens → user edits → serialize(tokens) → string.
 *
 * Supports 6 token types:
 *   tag       — matched in tag library / danbooru
 *   raw       — unrecognised plain text (grey passthrough)
 *   embedding — "embedding:xxx" format
 *   wildcard  — "__xxx__" format
 *   template  — contains "{...|...}" or "${...}" syntax
 *   break     — BREAK keyword (forces new conditioning chunk)
 *
 * Weight parsing (tag & raw only):
 *   (tag:1.2) → weight 1.2, round brackets, depth 1
 *   ((tag))   → round brackets, depth 2, weight 1.0
 *
 * Embedding/wildcard weight:
 *   (embedding:name:1.5) → weight 1.5, type 'embedding'
 */
import { ref, type Ref } from 'vue'
import type { PromptToken, TokenType, BracketType } from '@/types/prompt-library'

let _nextId = 0
function uid(): string {
  return `tk_${++_nextId}_${Date.now().toString(36)}`
}

// ── Regex patterns for token type detection ────────────────────
const RE_EMBEDDING = /^embedding:.+/i
const RE_WILDCARD = /^__[^_].*__$/
const RE_TEMPLATE = /\{[^}]*\|[^}]*\}|\$\{[^}]+\}/

// ── Weight / bracket parsing ───────────────────────────────────

interface ParsedWeight {
  inner: string
  weight: number
  bracketType: BracketType
  bracketDepth: number
  explicitWeight: boolean
}

/**
 * Parse bracket wrappers and extract weight.
 *
 * Weight and brackets are independent dimensions:
 *   - weight = the explicit :weight annotation (default 1.0 when absent)
 *   - bracketDepth = number of bracket layers
 *   - ((tag)) → weight 1.0, depth 2 (no :weight annotation)
 *   - (tag:1.5) → weight 1.5, depth 1
 *   - ((tag:1.5)) → weight 1.5, depth 2
 */
function parseWeight(raw: string): ParsedWeight {
  let s = raw.trim()

  // Strip round bracket layers
  let roundDepth = 0
  while (s.startsWith('(') && s.endsWith(')')) {
    roundDepth++
    s = s.slice(1, -1).trim()
  }
  if (roundDepth > 0) {
    // Check for explicit :weight at innermost level
    const colonIdx = s.lastIndexOf(':')
    if (colonIdx > 0) {
      const maybeWeight = parseFloat(s.slice(colonIdx + 1))
      if (!isNaN(maybeWeight)) {
        return {
          inner: s.slice(0, colonIdx).trim(),
          weight: maybeWeight,
          bracketType: 'round',
          bracketDepth: roundDepth,
          explicitWeight: true,
        }
      }
    }
    // No :weight annotation → weight stays 1.0
    return {
      inner: s,
      weight: 1.0,
      bracketType: 'round',
      bracketDepth: roundDepth,
      explicitWeight: false,
    }
  }

  // No brackets
  return { inner: s, weight: 1.0, bracketType: 'none', bracketDepth: 0, explicitWeight: false }
}

// ── Smart comma-split that respects {} and ${} nesting ─────────

/**
 * Split a prompt string on commas, but skip commas inside
 * curly-brace groups ({...}, ${...}) and round-bracket groups
 * ((emphasis), (a, b)) so structural expressions survive intact.
 */
export function splitPromptTokens(prompt: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let i = 0; i < prompt.length; i++) {
    const ch = prompt[i]
    if (ch === '{' || ch === '(') {
      depth++
    } else if ((ch === '}' || ch === ')') && depth > 0) {
      depth--
    } else if (ch === ',' && depth === 0) {
      const seg = prompt.slice(start, i).trim()
      if (seg) parts.push(seg)
      start = i + 1
    }
  }

  // Last segment
  const last = prompt.slice(start).trim()
  if (last) parts.push(last)

  return parts
}

// ── Token type classification ──────────────────────────────────

function classifyToken(text: string): TokenType {
  if (/^BREAK$/i.test(text)) return 'break'
  if (RE_EMBEDDING.test(text)) return 'embedding'
  if (RE_WILDCARD.test(text)) return 'wildcard'
  if (RE_TEMPLATE.test(text)) return 'template'
  return 'raw' // default; caller upgrades to 'tag' if library match found
}

// ── Raw string builder ─────────────────────────────────────────

/**
 * Build the raw string representation of a token from its structured fields.
 *
 * Rules:
 *   depth=0, weight=1.0  → "tag"
 *   depth>0, weight=1.0  → "((tag))" (shorthand)
 *   depth>0, weight≠1.0  → "((tag:1.50))" (innermost has :weight)
 *   depth=0, weight≠1.0  → impossible (updateWeight auto-adds depth=1)
 *
 * Embedding/wildcard/template:
 *   weight=1.0, depth=0 → plain tag   e.g. "embedding:name"
 *   weight≠1.0          → "(tag:1.50)" e.g. "(embedding:name:1.50)"
 *   depth>0             → "((tag))"    respects bracketDepth
 */
export function buildRaw(token: PromptToken): string {
  if (token.type === 'break') return 'BREAK'

  // Embedding/wildcard/template: support bracketDepth and weight
  if (token.type === 'embedding' || token.type === 'wildcard' || token.type === 'template') {
    const depth = Math.max(0, token.bracketDepth)
    if (depth === 0 && token.weight === 1.0) return token.tag
    // Build with :weight at innermost if weight≠1.0
    let s = token.weight !== 1.0 ? `${token.tag}:${token.weight.toFixed(2)}` : token.tag
    const layers = Math.max(depth, token.weight !== 1.0 ? 1 : 0)
    for (let i = 0; i < layers; i++) s = `(${s})`
    return s
  }

  const { tag, weight, bracketDepth } = token
  const depth = Math.max(0, bracketDepth)

  // No brackets → plain tag (weight must be 1.0 by invariant)
  if (depth === 0) return tag

  // Has brackets — build from inside out
  let s = weight !== 1.0 ? `${tag}:${weight.toFixed(2)}` : tag
  for (let i = 0; i < depth; i++) s = `(${s})`
  return s
}

// ── Serialization ──────────────────────────────────────────────

export function serializeToken(token: PromptToken): string {
  if (!token.enabled || !token.raw) return ''
  return token.raw
}

// ── Disabled token snapshot (for persistent storage) ───────────

export interface DisabledTokenSnapshot {
  raw: string
  tag: string
  type: string
  weight: number
  bracketType: string
  bracketDepth: number
  explicitWeight: boolean
  index: number
  translate?: string
  groupColor?: string
}

// ── Main composable ────────────────────────────────────────────

export interface UsePromptEditorReturn {
  tokens: Ref<PromptToken[]>

  parse(prompt: string): PromptToken[]
  serialize(): string
  serializeEnabled(): string
  extractDisabled(): DisabledTokenSnapshot[]
  injectDisabled(disabled: DisabledTokenSnapshot[]): void
  addToken(text: string, type?: TokenType, color?: string, translate?: string): void
  removeToken(id: string): void
  toggleToken(id: string): void
  updateWeight(id: string, weight: number): void
  updateBracket(id: string, bracketType: BracketType, depth: number): void
  moveToken(fromIndex: number, toIndex: number): void
  clearAll(): void
  clearDisabled(): void
  setTokenTranslation(id: string, translate: string): void
  updateTokenTag(id: string, newTag: string): void
  enrichTokens(resolved: Record<string, { color: string; translate: string }>): void
}

export function usePromptEditor(): UsePromptEditorReturn {
  const tokens = ref<PromptToken[]>([])

  /**
   * Parse a comma-separated prompt string into PromptToken[].
   * Token type is initially 'raw' or a special type; callers should
   * upgrade to 'tag' after checking the library.
   */
  function parse(prompt: string): PromptToken[] {
    if (!prompt.trim()) {
      tokens.value = []
      return tokens.value
    }

    const parts = splitPromptTokens(prompt)
    const result: PromptToken[] = []

    for (const part of parts) {
      // Parse weight/brackets first, then classify the inner text.
      // This handles cases like (embedding:name:1.5) correctly:
      //   parseWeight → inner="embedding:name", weight=1.5
      //   classifyToken(inner) → 'embedding'
      const parsed = parseWeight(part)
      const inner = parsed.inner || part
      const type = classifyToken(inner)

      if (type === 'break') {
        result.push({
          id: uid(),
          raw: 'BREAK',
          tag: 'BREAK',
          type: 'break',
          weight: 1.0,
          bracketType: 'none',
          bracketDepth: 0,
          explicitWeight: false,
          enabled: true,
        })
      } else if (type === 'embedding' || type === 'wildcard' || type === 'template') {
        result.push({
          id: uid(),
          raw: part,
          tag: inner,
          type,
          weight: parsed.weight,
          bracketType: parsed.bracketType,
          bracketDepth: parsed.bracketDepth,
          explicitWeight: parsed.explicitWeight,
          enabled: true,
        })
      } else {
        // tag or raw — use already-parsed weight / brackets
        if (!parsed.inner) continue // skip empty tags e.g. ()
        result.push({
          id: uid(),
          raw: part,
          tag: parsed.inner,
          type: 'raw', // caller upgrades to 'tag' if library match
          weight: parsed.weight,
          bracketType: parsed.bracketType,
          bracketDepth: parsed.bracketDepth,
          explicitWeight: parsed.explicitWeight,
          enabled: true,
        })
      }
    }

    tokens.value = result
    return result
  }

  /**
   * Serialize current tokens back to a comma-separated string.
   */
  function serialize(): string {
    return tokens.value
      .map(serializeToken)
      .filter(Boolean)
      .join(', ')
  }

  /** Serialize only enabled tokens (for display in parent textarea). */
  function serializeEnabled(): string {
    return tokens.value
      .filter(t => t.enabled)
      .map(serializeToken)
      .filter(Boolean)
      .join(', ')
  }

  /**
   * Extract disabled tokens as snapshots for persistent storage.
   * Captures position (index) so they can be re-injected at the right spot.
   */
  function extractDisabled(): DisabledTokenSnapshot[] {
    return tokens.value
      .map((t, i) => ({ token: t, index: i }))
      .filter(({ token }) => !token.enabled)
      .map(({ token, index }) => ({
        raw: token.raw,
        tag: token.tag,
        type: token.type,
        weight: token.weight,
        bracketType: token.bracketType,
        bracketDepth: token.bracketDepth,
        explicitWeight: token.explicitWeight,
        index,
        translate: token.translate,
        groupColor: token.groupColor,
      }))
  }

  /**
   * Inject previously-stored disabled tokens back into the token array.
   * Tokens are inserted at their original index (clamped to array length).
   */
  function injectDisabled(disabled: DisabledTokenSnapshot[]): void {
    if (!disabled.length) return
    // Sort by index ascending so sequential insertions naturally shift positions
    const sorted = [...disabled].sort((a, b) => a.index - b.index)
    const arr = [...tokens.value]
    for (const d of sorted) {
      // d.index is the position in the original full array (including disabled);
      // each prior insertion shifts the array, so d.index is used directly.
      const insertAt = Math.min(d.index, arr.length)
      arr.splice(insertAt, 0, {
        id: uid(),
        raw: d.raw,
        tag: d.tag,
        type: d.type as TokenType,
        weight: d.weight,
        bracketType: d.bracketType as BracketType,
        bracketDepth: d.bracketDepth,
        explicitWeight: d.explicitWeight,
        enabled: false,
        translate: d.translate,
        groupColor: d.groupColor,
      })
    }
    tokens.value = arr
  }

  /**
   * Add a new token at the end.
   *
   * When type is 'raw' (default), the text is auto-classified through
   * classifyToken() so special syntax (BREAK, embedding:xxx, __wc__,
   * ${...}) is correctly typed from the start.
   */
  function addToken(text: string, type: TokenType = 'raw', color?: string, translate?: string): void {
    if (!text.trim()) return

    // Auto-classify when caller didn't specify a concrete type
    const parsed = parseWeight(text)
    const inner = parsed.inner || text
    const detected = type === 'raw' ? classifyToken(inner) : type

    if (detected === 'break') {
      tokens.value.push({
        id: uid(),
        raw: 'BREAK',
        tag: 'BREAK',
        type: 'break',
        weight: 1.0,
        bracketType: 'none',
        bracketDepth: 0,
        explicitWeight: false,
        enabled: true,
      })
      return
    }

    const useWeight = detected !== 'template'
    tokens.value.push({
      id: uid(),
      raw: text,
      tag: useWeight ? (parsed.inner || text) : text,
      type: detected,
      weight: useWeight ? parsed.weight : 1.0,
      bracketType: useWeight ? parsed.bracketType : 'none',
      bracketDepth: useWeight ? parsed.bracketDepth : 0,
      explicitWeight: useWeight ? parsed.explicitWeight : false,
      enabled: true,
      groupColor: color,
      translate,
    })
  }

  function removeToken(id: string): void {
    tokens.value = tokens.value.filter(t => t.id !== id)
  }

  function toggleToken(id: string): void {
    const token = tokens.value.find(t => t.id === id)
    if (token) token.enabled = !token.enabled
  }

  function updateWeight(id: string, weight: number): void {
    const token = tokens.value.find(t => t.id === id)
    if (!token) return

    token.weight = Math.round(weight * 100) / 100

    if (token.weight === 1.0) {
      // weight=1.0: if single bracket layer → fully reset; if multi-layer → keep brackets, drop :weight
      if (token.bracketDepth <= 1) {
        token.explicitWeight = false
        token.bracketType = 'none'
        token.bracketDepth = 0
      } else {
        token.explicitWeight = false
      }
    } else {
      // weight≠1.0: must have at least 1 bracket layer
      token.explicitWeight = true
      if (token.bracketDepth === 0) {
        token.bracketType = 'round'
        token.bracketDepth = 1
      }
    }

    token.raw = buildRaw(token)
  }

  function updateBracket(id: string, bracketType: BracketType, depth: number): void {
    const token = tokens.value.find(t => t.id === id)
    if (!token) return

    const newDepth = Math.max(0, depth)
    token.bracketType = bracketType
    token.bracketDepth = newDepth

    // Bracket depth reaches 0 → fully reset (weight forced to 1.0)
    if (newDepth === 0) {
      token.weight = 1.0
      token.explicitWeight = false
      token.bracketType = 'none'
    }

    token.raw = buildRaw(token)
  }

  function moveToken(fromIndex: number, toIndex: number): void {
    const arr = [...tokens.value]
    const [moved] = arr.splice(fromIndex, 1)
    if (moved) {
      arr.splice(toIndex, 0, moved)
      tokens.value = arr
    }
  }

  function clearAll(): void {
    tokens.value = []
  }

  function clearDisabled(): void {
    tokens.value = tokens.value.filter(t => t.enabled)
  }

  function setTokenTranslation(id: string, translate: string): void {
    const token = tokens.value.find(t => t.id === id)
    if (token) token.translate = translate
  }

  function updateTokenTag(id: string, newText: string): void {
    const token = tokens.value.find(t => t.id === id)
    if (!token) return
    // Parse brackets/weight first, then classify the inner text
    const parsed = parseWeight(newText)
    const inner = parsed.inner || newText
    const type = classifyToken(inner)

    if (type === 'break') {
      token.type = 'break'
      token.tag = 'BREAK'
      token.weight = 1.0
      token.bracketType = 'none'
      token.bracketDepth = 0
    } else if (type === 'embedding' || type === 'wildcard' || type === 'template') {
      token.type = type
      token.tag = inner
      token.weight = parsed.weight
      token.bracketType = parsed.bracketType
      token.bracketDepth = parsed.bracketDepth
      token.explicitWeight = parsed.explicitWeight
    } else {
      // Downgrade to 'raw' — caller (onUpdateTag) upgrades to 'tag' if library matches
      token.type = 'raw'
      token.tag = parsed.inner
      token.weight = parsed.weight
      token.bracketType = parsed.bracketType
      token.bracketDepth = parsed.bracketDepth
      token.explicitWeight = parsed.explicitWeight
    }
    token.raw = buildRaw(token)
    // Tag changed — clear stale translation and color
    token.translate = undefined
    token.groupColor = undefined
  }

  /**
   * Enrich parsed tokens with library color and translate data.
   * Upgrades 'raw' tokens to 'tag' type when matched.
   */
  function enrichTokens(resolved: Record<string, { color: string; translate: string }>): void {
    for (const token of tokens.value) {
      if (token.type !== 'raw') continue
      const match = resolved[token.tag]
      if (match) {
        token.type = 'tag'
        token.groupColor = match.color || undefined
        token.translate = match.translate || undefined
      }
    }
  }

  return {
    tokens,
    parse,
    serialize,
    serializeEnabled,
    extractDisabled,
    injectDisabled,
    addToken,
    removeToken,
    toggleToken,
    updateWeight,
    updateBracket,
    moveToken,
    clearAll,
    clearDisabled,
    setTokenTranslation,
    updateTokenTag,
    enrichTokens,
  }
}
