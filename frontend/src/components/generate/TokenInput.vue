<script setup lang="ts">
/**
 * TokenInput — Composite token editor.
 *
 * Layout: flex-wrap container of TokenChip + trailing <input>.
 * Features:
 *   - Comma or Enter commits input text as chip
 *   - Backspace on empty input selects/deletes last chip
 *   - Autocomplete dropdown (debounced, keyboard navigable)
 *   - Toolbar below: favorites/history, clear all, clear disabled, translate all
 *   - Drag & drop reorder chips
 *   - IME-safe (compositionstart/compositionend guard)
 */
import { ref, computed, nextTick, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PromptToken, BracketType } from '@/types/prompt-library'
import type { AutocompleteDisplayItem } from '@/composables/generate/useAutoComplete'
import { useAutoComplete } from '@/composables/generate/useAutoComplete'
import { splitPromptTokens } from '@/composables/generate/usePromptEditor'
import TokenChip from '@/components/generate/TokenChip.vue'
import AutoCompleteList from '@/components/generate/AutoCompleteList.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'TokenInput' })

const props = withDefaults(defineProps<{
  tokens: PromptToken[]
  showTranslation?: boolean
  translatingIds?: Set<string>
  translateAllBusy?: boolean
  autocompleteLimit?: number
}>(), {
  showTranslation: true,
  autocompleteLimit: 20,
})

const emit = defineEmits<{
  add: [text: string]
  'add-break': []
  remove: [id: string]
  toggle: [id: string]
  'update:weight': [id: string, weight: number]
  'update:bracket': [id: string, type: BracketType, depth: number]
  'update:tag': [id: string, newTag: string]
  translate: [id: string]
  'translate-all': []
  move: [fromIndex: number, toIndex: number]
  'clear-all': []
  'clear-disabled': []
  history: []
  'open-embedding': []
  'open-wildcard': []
  'select-autocomplete': [item: AutocompleteDisplayItem]
}>()

const { t } = useI18n({ useScope: 'global' })

const inputRef = ref<HTMLInputElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const selectedChipId = ref<string | null>(null)
const composing = ref(false) // IME guard
const dragOverIndex = ref(-1)
const dragSourceId = ref<string | null>(null)
const lastEnterTime = ref(0) // for double-Enter BREAK detection

// ── Autocomplete ───────────────────────────────────────────────
const existingTags = computed(() => props.tokens.map(t => t.tag))
const acLimit = computed(() => props.autocompleteLimit)
const ac = useAutoComplete(existingTags, acLimit)

// Compute autocomplete dropdown position based on input element
const acPosition = ref<Record<string, string>>({})

function updateAcPosition() {
  if (!inputRef.value) return
  const rect = inputRef.value.getBoundingClientRect()
  acPosition.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.bottom}px`,
  }
}

// ── Input handling ─────────────────────────────────────────────
function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  updateAcPosition()
  // Don't process during IME composition
  if (composing.value) {
    ac.query.value = val
    return
  }
  // Depth-aware comma handling:
  //   - top-level commas (depth 0 for both {} and ()) = split & commit
  //   - commas inside {}/() = literal text, don't split
  if (val.includes(',')) {
    // Single-pass scan: track depth for {} and (), find top-level commas
    let depth = 0
    let lastTopComma = -1
    let hasTopLevelComma = false

    for (let i = 0; i < val.length; i++) {
      const ch = val[i]
      if (ch === '{' || ch === '(') depth++
      else if ((ch === '}' || ch === ')') && depth > 0) depth--
      else if (ch === ',' && depth === 0) {
        hasTopLevelComma = true
        lastTopComma = i
      }
    }

    if (!hasTopLevelComma) {
      // All commas inside structures ({}/()) — don't split
      ac.query.value = val
      return
    }

    if (depth === 0) {
      // Balanced + has top-level comma → split and commit all
      const parts = splitPromptTokens(val)
      for (const part of parts) emit('add', part)
      clearInput()
      return
    }

    // Unbalanced tail — commit prefix up to last top-level comma, keep rest
    const prefix = val.slice(0, lastTopComma)
    const suffix = val.slice(lastTopComma + 1).trimStart()
    const parts = splitPromptTokens(prefix)
    for (const part of parts) emit('add', part)
    if (inputRef.value) inputRef.value.value = suffix
    ac.query.value = suffix
    return
  }
  ac.query.value = val
}

function onKeydown(e: KeyboardEvent) {
  if (composing.value) return

  // Autocomplete navigation
  if (ac.visible.value) {
    if (e.key === 'ArrowDown') { e.preventDefault(); ac.moveDown(); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); ac.moveUp(); return }
    if (e.key === 'Tab') {
      e.preventDefault()
      const item = ac.confirm()
      if (item) {
        emit('select-autocomplete', item)
        clearInput()
        return
      }
      // No active item — fall through to commitInput
      commitInput()
      return
    }
    if (e.key === 'Escape') { e.stopPropagation(); ac.dismiss(); return }
  }

  // Enter → commit current input or double-Enter → BREAK
  if (e.key === 'Enter') {
    e.preventDefault()
    const now = Date.now()
    const inputEmpty = !inputRef.value?.value.trim()
    if (inputEmpty && now - lastEnterTime.value < 400) {
      // Double-Enter on empty input → add BREAK
      emit('add-break')
      lastEnterTime.value = 0
      return
    }
    lastEnterTime.value = now
    commitInput()
    return
  }

  // Backspace on empty → select/delete last chip; on nearly empty → dismiss autocomplete
  if (e.key === 'Backspace') {
    const val = inputRef.value?.value ?? ''
    if (!val) {
      e.preventDefault()
      ac.dismiss()
      if (selectedChipId.value) {
        emit('remove', selectedChipId.value)
        selectedChipId.value = null
      } else if (props.tokens.length > 0) {
        selectedChipId.value = props.tokens[props.tokens.length - 1].id
      }
      return
    }
    // Will become empty after this Backspace — proactively dismiss
    if (val.length === 1) {
      ac.dismiss()
    }
    return
  }

  // Any other key clears chip selection
  if (selectedChipId.value) {
    selectedChipId.value = null
  }
}

function commitInput() {
  const val = inputRef.value?.value.trim()
  if (val) {
    emit('add', val)
  }
  clearInput()
}

function clearInput() {
  if (inputRef.value) inputRef.value.value = ''
  ac.reset()
}

function focusInput(e?: MouseEvent) {
  // Don't steal focus from inline chip edit inputs
  if (e && (e.target as HTMLElement)?.closest('.chip-edit-input')) return
  inputRef.value?.focus()
}

// ── Autocomplete selection ─────────────────────────────────────
function onAcSelect(item: AutocompleteDisplayItem) {
  emit('select-autocomplete', item)
  clearInput()
  nextTick(focusInput)
}

// ── IME composition guards ─────────────────────────────────────
function onCompositionStart() { composing.value = true }
function onCompositionEnd(e: Event) {
  composing.value = false
  // Process composed text through autocomplete
  const val = (e.target as HTMLInputElement).value
  ac.query.value = val
}

// ── Drag & Drop (row-aware with visual indicator) ──────────────

interface ChipInfo { idx: number; rect: DOMRect }
interface ChipRow { chips: ChipInfo[]; top: number; bottom: number }

const dropIndicatorStyle = ref<Record<string, string>>({ display: 'none' })

/**
 * Group chips into visual rows based on their Y position.
 * Chips within ROW_TOLERANCE px vertically are on the same row.
 */
function buildRowMap(chipEls: Element[]): ChipRow[] {
  const ROW_TOLERANCE = 8
  const rows: ChipRow[] = []
  chipEls.forEach((el, idx) => {
    const rect = (el as HTMLElement).getBoundingClientRect()
    const existing = rows.find(r => Math.abs(r.top - rect.top) <= ROW_TOLERANCE)
    if (existing) {
      existing.chips.push({ idx, rect })
      existing.bottom = Math.max(existing.bottom, rect.bottom)
    } else {
      rows.push({ chips: [{ idx, rect }], top: rect.top, bottom: rect.bottom })
    }
  })
  return rows.sort((a, b) => a.top - b.top)
}

/** Find which row the cursor Y is over. */
function findRow(rows: ChipRow[], y: number): ChipRow {
  for (let i = 0; i < rows.length; i++) {
    const midBottom = i < rows.length - 1
      ? (rows[i].bottom + rows[i + 1].top) / 2
      : Infinity
    if (y < midBottom) return rows[i]
  }
  return rows[rows.length - 1]
}

/** Within a row, find the insert index based on cursor X. */
function findIndexInRow(row: ChipRow, x: number): number {
  let bestIdx = row.chips[row.chips.length - 1].idx + 1 // default: after last
  let bestDist = Infinity
  for (const c of row.chips) {
    const center = c.rect.left + c.rect.width / 2
    const dist = Math.abs(x - center)
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = x < center ? c.idx : c.idx + 1
    }
  }
  return bestIdx
}

/** Compute drop indicator position — thin vertical line between chips. */
function updateIndicator(rows: ChipRow[], dropIdx: number) {
  // Find the chip at dropIdx (or the one before it)
  const allChips = rows.flatMap(r => r.chips)
  if (allChips.length === 0) { dropIndicatorStyle.value = { display: 'none' }; return }

  let refRect: DOMRect
  let left: number

  if (dropIdx <= 0) {
    // Before first chip
    refRect = allChips[0].rect
    left = refRect.left - 2
  } else if (dropIdx >= allChips.length) {
    // After last chip
    refRect = allChips[allChips.length - 1].rect
    left = refRect.right + 2
  } else {
    // Between two chips — use the right edge of previous
    const prev = allChips.find(c => c.idx === dropIdx - 1)
    const next = allChips.find(c => c.idx === dropIdx)
    if (prev && next) {
      // If on same row, place between them; if different rows, use next's left
      if (Math.abs(prev.rect.top - next.rect.top) < 8) {
        left = (prev.rect.right + next.rect.left) / 2
        refRect = prev.rect
      } else {
        refRect = next.rect
        left = refRect.left - 2
      }
    } else {
      refRect = (next ?? prev ?? allChips[0]).rect
      left = next ? refRect.left - 2 : refRect.right + 2
    }
  }

  dropIndicatorStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${refRect!.top}px`,
    height: `${refRect!.height}px`,
    width: '2px',
    background: 'var(--ac)',
    borderRadius: '1px',
    pointerEvents: 'none',
    zIndex: '10000',
  }
}

function onChipDragStart(id: string) {
  dragSourceId.value = id
}

function onChipDragEnd() {
  dragSourceId.value = null
  dragOverIndex.value = -1
  dropIndicatorStyle.value = { display: 'none' }
}

function onContainerDragOver(e: DragEvent) {
  e.preventDefault()
  if (!dragSourceId.value || !containerRef.value) return
  const chipEls = Array.from(containerRef.value.querySelectorAll('.token-chip'))
  if (!chipEls.length) return

  const rows = buildRowMap(chipEls)
  const row = findRow(rows, e.clientY)
  const dropIdx = findIndexInRow(row, e.clientX)

  dragOverIndex.value = dropIdx
  updateIndicator(rows, dropIdx)
}

function onContainerDrop(e: DragEvent) {
  e.preventDefault()
  if (!dragSourceId.value) return
  const fromIdx = props.tokens.findIndex(t => t.id === dragSourceId.value)
  let toIdx = dragOverIndex.value
  if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
    if (toIdx > fromIdx) toIdx--
    emit('move', fromIdx, toIdx)
  }
  dragSourceId.value = null
  dragOverIndex.value = -1
  dropIndicatorStyle.value = { display: 'none' }
}

// ── Cleanup ────────────────────────────────────────────────────
onUnmounted(() => { ac.reset() })
</script>

<template>
  <div class="token-input-wrap">
    <!-- Chip container + trailing input -->
    <div
      ref="containerRef"
      class="token-input"
      @click="focusInput"
      @dragover="onContainerDragOver"
      @drop="onContainerDrop"
    >
      <template v-for="token in tokens" :key="token.id">
        <TokenChip
          :token="token"
          :selected="token.id === selectedChipId"
          :show-translation="showTranslation"
          :translating="translatingIds?.has(token.id) ?? false"
          :dragging="!!dragSourceId"
          @remove="emit('remove', $event)"
          @toggle="emit('toggle', $event)"
          @update:weight="(id, w) => emit('update:weight', id, w)"
          @update:bracket="(id, type, depth) => emit('update:bracket', id, type, depth)"
          @update:tag="(id, tag) => emit('update:tag', id, tag)"
          @translate="emit('translate', $event)"
          @drag-start="onChipDragStart"
          @drag-end="onChipDragEnd"
        />
      </template>

      <input
        ref="inputRef"
        class="token-text-input"
        type="text"
        :placeholder="tokens.length === 0 ? t('prompt-library.editor.placeholder') : ''"
        autocomplete="off"
        @input="onInput"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      />

      <!-- Autocomplete dropdown -->
      <AutoCompleteList
        :items="ac.results.value"
        :active-index="ac.activeIndex.value"
        :query="ac.query.value"
        :visible="ac.visible.value"
        :show-translation="showTranslation"
        :position-style="acPosition"
        @select="onAcSelect"
      />
    </div>

    <!-- Drop position indicator (teleported so fixed positioning works) -->
    <Teleport to="body">
      <div
        v-if="dragSourceId"
        class="drop-indicator"
        :style="dropIndicatorStyle"
      />
    </Teleport>

    <!-- Toolbar -->
    <div class="token-toolbar">
      <button class="token-tool-btn" disabled @click="emit('history')">
        <MsIcon name="bookmark" size="xs" color="none" />
        <span class="tool-label">{{ t('prompt-library.toolbar.favorites') }}</span>
      </button>
      <button class="token-tool-btn" disabled @click="emit('history')">
        <MsIcon name="history" size="xs" color="none" />
        <span class="tool-label">{{ t('prompt-library.toolbar.history') }}</span>
      </button>

      <span class="tool-sep" />

      <button class="token-tool-btn" @click="emit('open-embedding')">
        <MsIcon name="link" size="xs" color="none" />
        <span class="tool-label">{{ t('prompt-library.toolbar.embedding') }}</span>
      </button>
      <button class="token-tool-btn" @click="emit('open-wildcard')">
        <MsIcon name="shuffle" size="xs" color="none" />
        <span class="tool-label">{{ t('generate.prompt.tools.wildcard') }}</span>
      </button>

      <span class="tool-spacer" />

      <button class="token-tool-btn" @click="emit('clear-disabled')">
        <MsIcon name="remove_circle" size="xs" color="none" />
        <span class="tool-label">{{ t('prompt-library.toolbar.clear_disabled') }}</span>
      </button>
      <button class="token-tool-btn token-tool-btn--danger" @click="emit('clear-all')">
        <MsIcon name="delete" size="xs" color="none" />
        <span class="tool-label">{{ t('prompt-library.toolbar.clear_all') }}</span>
      </button>

      <button
        v-if="showTranslation"
        class="token-tool-btn"
        :disabled="translateAllBusy"
        @click="emit('translate-all')"
      >
        <Spinner v-if="translateAllBusy" size="xs" />
        <MsIcon v-else name="translate" size="xs" color="none" />
        <span class="tool-label">{{ t('prompt-library.toolbar.translate_all') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── Container ── */
.token-input-wrap {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  overflow: hidden;
  transition: border-color .15s;
}
.token-input-wrap:focus-within {
  border-color: var(--ac);
}

.token-input {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 4px;
  padding: 8px;
  height: 180px;
  overflow-y: auto;
  background: var(--bg-in);
  cursor: text;
}

/* ── Trailing text input ── */
.token-text-input {
  flex: 1;
  min-width: 80px;
  height: 28px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--t1);
  font-size: var(--text-base);
  font-family: inherit;
}
.token-text-input::placeholder {
  color: var(--t3);
  opacity: .6;
}

/* ── Toolbar ── */
.token-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  background: var(--bg2);
  border-top: 1px solid var(--bd);
  flex-shrink: 0;
}

.token-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--t2);
  font-size: var(--text-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: color .15s, background .15s;
}
.token-tool-btn:hover {
  color: var(--t1);
  background: var(--bg3);
}
.token-tool-btn:disabled {
  opacity: .4;
  cursor: not-allowed;
}
.token-tool-btn:disabled:hover {
  color: var(--t2);
  background: transparent;
}
.token-tool-btn--danger:hover {
  color: var(--red);
}

.tool-label {
  font-size: var(--text-sm);
  font-weight: 500;
}
.tool-spacer {
  flex: 1;
}
.tool-sep {
  width: 1px;
  height: 16px;
  background: var(--bd);
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .tool-label { display: none; }
}
</style>

<!-- Drop indicator is Teleported to body — needs global styles -->
<style>
.drop-indicator {
  transition: left .05s, top .05s;
  box-shadow: 0 0 6px var(--ac);
}
</style>
