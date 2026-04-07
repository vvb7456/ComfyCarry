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
import TokenChip from '@/components/generate/TokenChip.vue'
import AutoCompleteList from '@/components/generate/AutoCompleteList.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'TokenInput' })

const props = withDefaults(defineProps<{
  tokens: PromptToken[]
  showTranslation?: boolean
  translatingIds?: Set<string>
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
  // Comma → commit
  if (val.includes(',')) {
    const parts = val.split(',').map(s => s.trim()).filter(Boolean)
    for (const part of parts) {
      emit('add', part)
    }
    clearInput()
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

function focusInput() {
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

// ── Drag & Drop ────────────────────────────────────────────────
function onChipDragStart(id: string) {
  dragSourceId.value = id
}

function onChipDragEnd() {
  dragSourceId.value = null
  dragOverIndex.value = -1
}

function onContainerDragOver(e: DragEvent) {
  e.preventDefault()
  if (!dragSourceId.value) return
  // Find closest chip to determine drop index
  const chips = containerRef.value?.querySelectorAll('.token-chip')
  if (!chips) return
  let closestIdx = props.tokens.length
  let closestDist = Infinity
  chips.forEach((chip, idx) => {
    const rect = (chip as HTMLElement).getBoundingClientRect()
    const center = rect.left + rect.width / 2
    const dist = Math.abs(e.clientX - center)
    if (dist < closestDist) {
      closestDist = dist
      closestIdx = e.clientX < center ? idx : idx + 1
    }
  })
  dragOverIndex.value = closestIdx
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
        @click="emit('translate-all')"
      >
        <MsIcon name="translate" size="xs" color="none" />
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
