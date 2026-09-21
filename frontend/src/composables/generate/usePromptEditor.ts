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

const RE_EMBEDDING = /^embedding:.+/i
const RE_WILDCARD = /^__[^_].*__$/
const RE_TEMPLATE = /\{[^}]*\|[^}]*\}|\$\{[^}]+\}/

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
function isBracketPair(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? ''
    if (ch === '\\' && i + 1 < s.length && '(){}'.includes(s[i + 1] ?? '')) {
      i++
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0 && i !== s.length - 1) return false
    }
  }
  return depth === 0
}

function parseWeight(raw: string): ParsedWeight {
  let s = raw.trim()

  if (s.startsWith('\\(') || s.endsWith('\\)')) {
    return { inner: s, weight: 1.0, bracketType: 'none', bracketDepth: 0, explicitWeight: false }
  }

  let roundDepth = 0
  while (s.startsWith('(') && s.endsWith(')') && isBracketPair(s)) {
    roundDepth++
    s = s.slice(1, -1).trim()
  }
  if (roundDepth > 0) {
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
    return {
      inner: s,
      weight: 1.0,
      bracketType: 'round',
      bracketDepth: roundDepth,
      explicitWeight: false,
    }
  }

  return { inner: s, weight: 1.0, bracketType: 'none', bracketDepth: 0, explicitWeight: false }
}

export function splitPromptTokens(prompt: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let i = 0; i < prompt.length; i++) {
    const ch = prompt[i] ?? ''
    if (ch === '\\' && i + 1 < prompt.length && '(){}|'.includes(prompt[i + 1] ?? '')) {
      i++
      continue
    }
    if (ch === '{' || ch === '(') {
      depth++
    } else if ((ch === '}' || ch === ')') && depth > 0) {
      depth--
    } else if ((ch === ',' || ch === '，') && depth === 0) {
      const seg = prompt.slice(start, i).trim()
      if (seg) parts.push(seg)
      start = i + 1
    }
  }

  const last = prompt.slice(start).trim()
  if (last) parts.push(last)

  return parts
}

function classifyToken(text: string): TokenType {
  if (/^BREAK$/i.test(text)) return 'break'
  if (RE_EMBEDDING.test(text)) return 'embedding'
  if (RE_WILDCARD.test(text)) return 'wildcard'
  if (RE_TEMPLATE.test(text)) return 'template'
  return 'raw' // default; caller upgrades to 'tag' if library match found
}

function formatWeight(w: number): string {
  const s = w.toFixed(2)
  return s.replace(/\.?0+$/, '') || '0'
}

export function buildRaw(token: PromptToken): string {
  if (token.type === 'break') return 'BREAK'

  if (token.type === 'embedding' || token.type === 'wildcard' || token.type === 'template') {
    const depth = Math.max(0, token.bracketDepth)
    if (depth === 0 && token.weight === 1.0) return token.tag
    let s = token.weight !== 1.0 ? `${token.tag}:${formatWeight(token.weight)}` : token.tag
    const layers = Math.max(depth, token.weight !== 1.0 ? 1 : 0)
    for (let i = 0; i < layers; i++) s = `(${s})`
    return s
  }

  const { tag, weight, bracketDepth } = token
  const depth = Math.max(0, bracketDepth)

  // No brackets → plain tag (weight must be 1.0 by invariant)
  if (depth === 0) return tag

  let s = weight !== 1.0 ? `${tag}:${formatWeight(weight)}` : tag
  for (let i = 0; i < depth; i++) s = `(${s})`
  return s
}

export function serializeToken(token: PromptToken): string {
  if (!token.enabled || !token.raw || token.pending) return ''
  return token.raw
}

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
  setTokenTranslation(id: string, translate: string): void
  updateTokenTag(id: string, newTag: string): void
  enrichTokens(resolved: Record<string, { color: string; translate: string }>): void
}

export function usePromptEditor(): UsePromptEditorReturn {
  const tokens = ref<PromptToken[]>([])

function parse(prompt: string): PromptToken[] {
    if (!prompt.trim()) {
      tokens.value = []
      return tokens.value
    }

    const parts = splitPromptTokens(prompt)
    const result: PromptToken[] = []

    for (const part of parts) {
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
        if (!parsed.inner) continue
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

  function serialize(): string {
    return tokens.value
      .filter(t => !t.pending)
      .map(serializeToken)
      .filter(Boolean)
      .join(', ')
  }

  /** Serialize only enabled tokens (for display in parent textarea). */
  function serializeEnabled(): string {
    return tokens.value
      .filter(t => t.enabled && !t.pending)
      .map(serializeToken)
      .filter(Boolean)
      .join(', ')
  }

  function extractDisabled(): DisabledTokenSnapshot[] {
    return tokens.value
      .map((t, i) => ({ token: t, index: i }))
      .filter(({ token }) => !token.enabled && !token.pending)
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

  function injectDisabled(disabled: DisabledTokenSnapshot[]): void {
    if (!disabled.length) return
    const sorted = [...disabled].sort((a, b) => a.index - b.index)
    const arr = [...tokens.value]
    for (const d of sorted) {
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

  function addToken(text: string, type: TokenType = 'raw', color?: string, translate?: string): void {
    if (!text.trim()) return

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

  function setTokenTranslation(id: string, translate: string): void {
    const token = tokens.value.find(t => t.id === id)
    if (token) token.translate = translate
  }

  function updateTokenTag(id: string, newText: string): void {
    const token = tokens.value.find(t => t.id === id)
    if (!token) return
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
    token.translate = undefined
    token.groupColor = undefined
  }

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
    setTokenTranslation,
    updateTokenTag,
    enrichTokens,
  }
}
