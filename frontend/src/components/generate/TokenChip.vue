<script setup lang="ts">
/**
 * TokenChip — Single token chip for TokenInput.
 *
 * 5 type styles:
 *   tag       — group color background (double-line with translation)
 *   raw       — grey background
 *   embedding — purple background
 *   wildcard  — blue background
 *   template  — cyan background
 *
 * Features:
 *   - Close button (remove)
 *   - Single click to edit tag text; double-click to toggle disabled
 *   - Hover mini toolbar: bracket controls + weight NumberInput
 *   - Translation line (when showTranslation is on)
 *   - Draggable (HTML5 drag)
 */
import { computed, ref, nextTick, onUnmounted, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PromptToken, BracketType } from '@/types/prompt-library'
import { serializeToken, buildRaw } from '@/composables/generate/usePromptEditor'
import MsIcon from '@/components/ui/MsIcon.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'TokenChip' })

const props = withDefaults(defineProps<{
  token: PromptToken
  selected?: boolean
  showTranslation?: boolean
  draggable?: boolean
  translating?: boolean
  /** Any chip is currently being dragged — hides all mini toolbars */
  dragging?: boolean
}>(), {
  selected: false,
  showTranslation: true,
  draggable: true,
  translating: false,
  dragging: false,
})

const emit = defineEmits<{
  remove: [id: string]
  toggle: [id: string]
  'update:weight': [id: string, weight: number]
  'update:bracket': [id: string, type: BracketType, depth: number]
  'update:tag': [id: string, newTag: string]
  translate: [id: string]
  'drag-start': [id: string, event: DragEvent]
  'drag-end': [event: DragEvent]
}>()

const { t } = useI18n({ useScope: 'global' })

const hovered = ref(false)
const chipEl = ref<HTMLElement | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function onMouseEnter() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
  hoverTimer = setTimeout(() => {
    hovered.value = true
    updateToolbarPos()
    hoverTimer = null
  }, 300)
}
function onMouseLeave() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
  hoverTimer = setTimeout(() => { hovered.value = false; hoverTimer = null }, 120)
}

onUnmounted(() => {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
})

// ── Toolbar position (fixed, above chip) ───────────────────────
// Imperatively updated (not computed) because getBoundingClientRect() is
// not reactive — chip DOM position changes after drag-move don't invalidate a computed.
const toolbarStyle = ref<CSSProperties>({ display: 'none' })

function updateToolbarPos() {
  if (!chipEl.value) { toolbarStyle.value = { display: 'none' }; return }
  const rect = chipEl.value.getBoundingClientRect()
  toolbarStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top - 4}px`,
    transform: 'translateY(-100%)',
    zIndex: 10000,
  }
}

// ── Computed styles ────────────────────────────────────────────
const chipColor = computed(() => {
  const { type, groupColor } = props.token
  if (type === 'tag' && groupColor) return groupColor
  const typeColors: Record<string, string> = {
    embedding: 'var(--purple, #a78bfa)',
    wildcard: 'var(--blue)',
    template: 'var(--cyan)',
  }
  return typeColors[type] || 'var(--t3)'
})

const displayText = computed(() => {
  // Always show the full structured representation (including brackets/weight),
  // even when disabled (serializeToken returns '' for disabled tokens)
  return buildRaw(props.token)
})

const isWeightType = computed(() =>
  props.token.type !== 'break' && props.token.type !== 'template',
)

const hasTranslation = computed(() =>
  props.showTranslation && props.token.translate,
)

const roundDepth = computed(() =>
  props.token.bracketType === 'round' ? props.token.bracketDepth : 0,
)

// ── Bracket helpers ────────────────────────────────────────────
function adjustBracket(type: BracketType, delta: number) {
  const { token } = props
  if (token.bracketType === type) {
    const newDepth = Math.max(0, token.bracketDepth + delta)
    if (newDepth === 0) {
      emit('update:bracket', token.id, 'none', 0)
    } else {
      emit('update:bracket', token.id, type, newDepth)
    }
  } else {
    // Switch type
    emit('update:bracket', token.id, delta > 0 ? type : 'none', delta > 0 ? 1 : 0)
  }
}

function onWeightChange(val: number) {
  emit('update:weight', props.token.id, val)
}

// ── Drag ───────────────────────────────────────────────────────
function onDragStart(e: DragEvent) {
  if (!props.draggable || editing.value) { e.preventDefault(); return }
  hovered.value = false
  e.dataTransfer?.setData('text/plain', props.token.id)
  emit('drag-start', props.token.id, e)
}

function onDragEnd(e: DragEvent) {
  hovered.value = false
  emit('drag-end', e)
}

// ── Inline editing ─────────────────────────────────────────────
const editing = ref(false)
const editInputRef = ref<HTMLInputElement | null>(null)
const chipTextRef = ref<HTMLElement | null>(null)
let clickTimer: ReturnType<typeof setTimeout> | null = null
let pendingClickX: number | null = null

function onTextClick(e: MouseEvent) {
  // Single click → start editing (with delay to allow dblclick to cancel)
  if (clickTimer) return
  pendingClickX = e.clientX
  clickTimer = setTimeout(() => {
    clickTimer = null
    startEditing()
  }, 250)
}

function onTextDblClick(e: Event) {
  // Prevent chip-level dblclick from also firing
  e.stopPropagation()
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
  emit('toggle', props.token.id)
}

function onChipDblClick() {
  // Double click on chip background (non-text area)
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
  emit('toggle', props.token.id)
}

function startEditing() {
  if (!props.token.enabled) return
  // Capture current text element width before switching to input
  const textEl = chipTextRef.value
  const textWidth = textEl?.offsetWidth ?? 60
  editing.value = true
  nextTick(() => {
    if (editInputRef.value) {
      const text = displayText.value
      editInputRef.value.value = text
      editInputRef.value.style.width = `${textWidth}px`
      editInputRef.value.focus()
      // Place cursor at approximate click position instead of selecting all
      if (pendingClickX !== null && textEl) {
        const rect = textEl.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (pendingClickX - rect.left) / rect.width))
        const pos = Math.round(ratio * text.length)
        editInputRef.value.setSelectionRange(pos, pos)
      }
      pendingClickX = null
    }
  })
}

function commitEdit() {
  const val = editInputRef.value?.value.trim()
  editing.value = false
  if (val && val !== displayText.value) {
    emit('update:tag', props.token.id, val)
  }
}

function cancelEdit() {
  editing.value = false
}
</script>

<template>
  <div
    v-if="token.type === 'break'"
    class="token-chip token-chip--break"
    :draggable="draggable"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <span class="chip-top" style="font-weight:600; letter-spacing:.04em; background:color-mix(in srgb, var(--amber) 18%, var(--bg3))">BREAK</span>
    <button class="chip-close" @click.stop="emit('remove', token.id)">
      <MsIcon name="close" size="xxs" color="none" />
    </button>
  </div>
  <div
    v-else
    ref="chipEl"
    class="token-chip"
    :class="{
      'token-chip--disabled': !token.enabled,
      'token-chip--selected': selected,
      'token-chip--editing': editing,
    }"
    :style="{ '--chip-color': chipColor }"
    :draggable="draggable && !editing"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @dblclick="!editing && onChipDblClick()"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <!-- Close button — absolute top-right -->
    <button class="chip-close" @click.stop="emit('remove', token.id)">
      <MsIcon name="close" size="xxs" color="none" />
    </button>

    <!-- Top row: colored bg + tag text -->
    <div class="chip-top">
      <input
        v-if="editing"
        ref="editInputRef"
        class="chip-edit-input"
        @blur="commitEdit"
        @keydown.enter.prevent="commitEdit"
        @keydown.escape.prevent="cancelEdit"
        @dblclick.stop
        @mousedown.stop
      />
      <span v-else ref="chipTextRef" class="chip-text" @click="onTextClick" @dblclick="!editing && onTextDblClick($event)">{{ displayText }}</span>
    </div>

    <!-- Bottom row: translate text or clickable translate action -->
    <div v-if="showTranslation && isWeightType" class="chip-bot">
      <Spinner v-if="translating" size="xs" />
      <span v-else-if="hasTranslation" class="chip-translate-text">{{ token.translate }}</span>
      <span
        v-else
        class="chip-translate-link"
        @click.stop="emit('translate', token.id)"
      >{{ t('prompt-library.chip.translate_action') }}</span>
    </div>

    <!-- Hover mini toolbar (teleported to body) -->
    <Teleport to="body">
      <div
        v-if="hovered && !props.dragging && isWeightType && token.enabled"
        class="chip-toolbar"
        :style="toolbarStyle"
        @mouseenter="onMouseEnter"
        @mouseleave="onMouseLeave"
      >
        <div class="weight-row">
          <span class="weight-label">{{ t('prompt-library.chip.weight') }}</span>
          <NumberInput
            :model-value="token.weight"
            :min="0"
            :max="5"
            :step="0.05"
            :center="true"
            class="weight-input"
            @update:model-value="onWeightChange"
          />
        </div>
        <span class="toolbar-sep" />
        <div class="bracket-group">
          <button class="bracket-btn" @click.stop="adjustBracket('round', -1)">&minus;</button>
          <span class="bracket-value">()</span>
          <button class="bracket-btn" @click.stop="adjustBracket('round', 1)">&plus;</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Chip container (TagBrowser dual-row style) ── */
.token-chip {
  --chip-color: var(--t3);
  position: relative;
  display: inline-flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--chip-color) 30%, var(--bd));
  border-radius: var(--r-sm);
  overflow: hidden;
  cursor: grab;
  user-select: none;
  transition: border-color .12s, transform .1s;
  /* match chip-top bg so no dark gap appears when chip-bot is hidden */
  background: color-mix(in srgb, var(--chip-color) 18%, var(--bg3));
}
.token-chip:hover {
  border-color: color-mix(in srgb, var(--chip-color) 50%, var(--bd));
}

/* ── Break chip ── */
.token-chip--break {
  border-color: color-mix(in srgb, var(--amber) 30%, var(--bd));
}
.token-chip--break:hover {
  border-color: var(--amber);
}

.token-chip--editing {
  cursor: text;
  user-select: text;
}
.token-chip--disabled {
  opacity: .4;
  cursor: pointer;
}
.token-chip--selected {
  border-color: var(--ac);
  box-shadow: 0 0 0 1px var(--ac);
}

/* ── Top row: colored bg + tag text ── */
.chip-top {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px 20px 3px 10px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--t1);
  background: color-mix(in srgb, var(--chip-color) 18%, var(--bg3));
  line-height: 1.4;
}

.chip-text {
  cursor: text;
  word-break: break-all;
  text-align: center;
}

.chip-edit-input {
  border: none;
  outline: none;
  background: color-mix(in srgb, var(--ac) 10%, transparent);
  border-bottom: 1px solid var(--ac);
  color: var(--t1);
  font-size: inherit;
  font-weight: 500;
  font-family: inherit;
  line-height: inherit;
  padding: 0;
  min-width: 2em;
  text-align: center;
}

/* ── Bottom row: translate text or translate button ── */
.chip-bot {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px 3px;
  font-size: var(--text-xs);
  background: var(--bg2);
  border-top: 1px solid color-mix(in srgb, var(--chip-color) 15%, var(--bd));
  line-height: 1.4;
  min-height: 20px;
}

.chip-translate-text {
  color: var(--t2);
  text-align: center;
}

.chip-translate-link {
  color: var(--t3);
  cursor: pointer;
  transition: color .15s;
}
.chip-translate-link:hover {
  color: var(--blue);
  text-decoration: underline;
}

/* ── Close button ── */
.chip-close {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
  flex-shrink: 0;
  transition: color .15s, background .15s;
  z-index: 1;
}
.chip-close:hover {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 15%, transparent);
}

/* ── Hover mini toolbar (teleported to body, position: fixed) ── */
.chip-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-sm);
  box-shadow: var(--sh);
  white-space: nowrap;
}

.bracket-group {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--bd);
  border-radius: var(--r-xs);
  overflow: hidden;
}
.bracket-value {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--t2);
  min-width: 24px;
  text-align: center;
  padding: 0 2px;
  background: var(--bg3);
  line-height: 22px;
}
.bracket-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: var(--bg2);
  color: var(--t2);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, color .15s;
}
.bracket-btn:hover {
  background: var(--ac);
  color: #fff;
  border-color: var(--ac);
}

.weight-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.weight-label {
  font-size: var(--text-xs);
  color: var(--t3);
  white-space: nowrap;
}
.weight-input {
  width: 70px;
}
.toolbar-sep {
  width: 1px;
  height: 18px;
  background: var(--bd);
  flex-shrink: 0;
}
:deep(.weight-input) {
  height: 22px;
}
:deep(.weight-input input) {
  font-size: var(--text-xs);
  padding: 2px 4px;
  height: 22px;
}
:deep(.weight-input .number-input__spinners) {
  top: 0;
  bottom: 0;
  width: 20px;
}
:deep(.weight-input .number-input__btn) {
  font-size: 0;
}
</style>
