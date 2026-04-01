<script setup lang="ts">
/**
 * ChipSelect — Chip/tag filter with optional row-collapse.
 *
 * Collapse design:
 *   Collapsed: show chips that fit in N rows. The last visible position is
 *   replaced by a "+X 更多" chip (same style as other chips) if the full chip
 *   at that position won't fit alongside the toggle. Click to expand.
 *   Expanded: show ALL chips + a "收起" chip appended at the end. Click to collapse.
 *   Both toggle chips are regular inline flex items — no sticky/absolute positioning.
 *
 * Measurement: a hidden measurer container (same width, visibility:hidden)
 * renders all chips + a toggle placeholder. On mount + resize we scan offsetTop
 * to find row breaks, then compute visibleCount. The visible container only
 * renders that many chips. The two containers are independent — no feedback loops.
 */
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import Spinner from './Spinner.vue'

export interface ChipOption {
  value: string
  label: string
  count?: number | string
}

const props = withDefaults(defineProps<{
  options: ChipOption[]
  modelValue: string | string[]
  multiple?: boolean
  allOption?: string
  collapsedRows?: number
  maxHeight?: string
  loading?: boolean
}>(), {
  multiple: false,
  allOption: '',
  collapsedRows: 0,
  loading: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]]
}>()

const { t } = useI18n({ useScope: 'global' })

/* ── Selection ── */
const selectedSet = computed(() => {
  const v = props.modelValue
  return new Set(Array.isArray(v) ? v : v ? [v] : [])
})

const isAllActive = computed(() => {
  if (!props.allOption) return false
  return props.multiple
    ? (props.modelValue as string[]).length === 0
    : props.modelValue === ''
})

function selectAll() {
  emit('update:modelValue', props.multiple ? [] : '')
}

function toggleChip(value: string) {
  if (props.multiple) {
    const arr = [...(props.modelValue as string[])]
    const idx = arr.indexOf(value)
    if (idx >= 0) arr.splice(idx, 1); else arr.push(value)
    emit('update:modelValue', arr)
  } else {
    emit('update:modelValue', value)
  }
}

/* ── Collapse ── */
const expanded = ref(false)
const collapsible = computed(() => props.collapsedRows > 0)
const rootRef = ref<HTMLElement>()
const measurerRef = ref<HTMLElement>()
const visibleCount = ref(Infinity)

function measure() {
  if (!collapsible.value) { visibleCount.value = Infinity; return }
  if (!measurerRef.value) return // expanded — keep last value

  const el = measurerRef.value
  const kids = el.children as HTMLCollectionOf<HTMLElement>
  if (kids.length === 0) { visibleCount.value = Infinity; return }

  // Layout: [allChip?] [chip0 .. chipN-1] [togglePlaceholder]
  const offset = props.allOption ? 1 : 0
  const toggleEl = kids[kids.length - 1]
  const toggleW = toggleEl.offsetWidth

  // Detect row number (1-based) for each option chip
  let row = 0, prevTop = -1
  const rows: number[] = []
  for (let i = offset; i < kids.length - 1; i++) {
    const t = kids[i].offsetTop
    if (t !== prevTop) { row++; prevTop = t }
    rows.push(row)
  }

  const maxRow = props.collapsedRows

  // All fit?
  if (!rows.length || rows[rows.length - 1] <= maxRow) {
    visibleCount.value = Infinity
    return
  }

  // Find first chip on row > maxRow
  let firstOver = rows.length
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] > maxRow) { firstOver = i; break }
  }

  // Walk back from firstOver to find where toggle fits on the same row
  const cw = el.clientWidth
  const gap = 5
  let cut = firstOver
  while (cut > 0) {
    const chip = kids[offset + cut - 1]
    if (chip.offsetLeft + chip.offsetWidth + gap + toggleW <= cw) break
    cut--
  }

  visibleCount.value = Math.max(cut, 1)
}

let ro: ResizeObserver | null = null

onMounted(() => {
  nextTick(measure)
  if (rootRef.value) {
    ro = new ResizeObserver(() => { if (!expanded.value) nextTick(measure) })
    ro.observe(rootRef.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())

watch(() => props.options, () => nextTick(measure), { flush: 'post' })
watch(expanded, (v) => { if (!v) nextTick(measure) })

const hasOverflow = computed(() => collapsible.value && visibleCount.value < props.options.length)
const overflowN = computed(() => props.options.length - visibleCount.value)

const displayOptions = computed(() => {
  if (!collapsible.value || expanded.value) return props.options
  return props.options.slice(0, visibleCount.value)
})

/* ── Formatting ── */
function fmt(c: number | string) {
  return typeof c === 'string' ? c : c > 1000 ? (c / 1000).toFixed(1) + 'k' : String(c)
}
</script>

<template>
  <div ref="rootRef" class="chip-select-root">
    <!-- Hidden measurer -->
    <div
      v-if="collapsible && !expanded"
      ref="measurerRef"
      class="chip-select chip-select--measurer"
      aria-hidden="true"
    >
      <span v-if="allOption" class="chip-select__chip">{{ allOption }}</span>
      <span v-for="o in options" :key="'m-' + o.value" class="chip-select__chip">
        {{ o.label }}<span v-if="o.count != null" class="chip-select__count">{{ fmt(o.count) }}</span>
      </span>
      <span class="chip-select__chip chip-select__chip--toggle">{{ t('common.chip_more', { n: options.length }) }}</span>
    </div>

    <!-- Visible container -->
    <div
      class="chip-select"
      :style="expanded && maxHeight ? { maxHeight, overflowY: 'auto' } : undefined"
    >
      <!-- Loading spinner when no options yet -->
      <template v-if="loading && !options.length">
        <span class="chip-select__loading"><Spinner size="sm" /></span>
      </template>

      <span
        v-if="allOption && !(loading && !options.length)"
        class="chip-select__chip"
        :class="{ 'chip-select__chip--active': isAllActive }"
        @click="selectAll"
      >{{ allOption }}</span>

      <span
        v-for="o in displayOptions"
        :key="o.value"
        class="chip-select__chip"
        :class="{ 'chip-select__chip--active': selectedSet.has(o.value) }"
        @click="toggleChip(o.value)"
      >
        {{ o.label }}<span v-if="o.count != null" class="chip-select__count">{{ fmt(o.count) }}</span>
      </span>

      <!-- "+N 更多" — same style as chips, replaces last overflowing chip -->
      <span
        v-if="hasOverflow && !expanded"
        class="chip-select__chip chip-select__chip--toggle"
        @click="expanded = true"
      >{{ t('common.chip_more', { n: overflowN }) }}</span>

      <!-- "收起" — same style as chips, appended after all chips -->
      <span
        v-if="hasOverflow && expanded"
        class="chip-select__chip chip-select__chip--toggle"
        @click="expanded = false"
      >{{ t('common.chip_collapse') }}</span>
    </div>
  </div>
</template>

<style scoped>
.chip-select-root {
  position: relative;
}

.chip-select {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 8px;
  background: var(--bg-in);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  min-height: 38px;
}

.chip-select--measurer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  visibility: hidden;
  pointer-events: none;
  z-index: -1;
}

.chip-select__chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  background: rgba(124, 92, 252, .12);
  border: 1px solid rgba(124, 92, 252, .2);
  border-radius: 4px;
  font-size: .75rem;
  font-weight: 500;
  color: var(--ac);
  cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
  white-space: nowrap;
  user-select: none;
}

.chip-select__chip:hover {
  background: rgba(124, 92, 252, .22);
}

.chip-select__chip--active {
  background: var(--ac);
  color: #fff;
  border-color: var(--ac);
}

.chip-select__chip--toggle {
  background: transparent;
  border-color: var(--bd);
  color: var(--t3);
}

.chip-select__chip--toggle:hover {
  background: var(--bg3);
  color: var(--t2);
  border-color: var(--bd-f);
}

.chip-select__count {
  font-size: .65rem;
  color: var(--t3);
  margin-left: 2px;
}

.chip-select__chip--active .chip-select__count {
  color: rgba(255, 255, 255, .7);
}

.chip-select--measurer .chip-select__chip {
  cursor: default;
}

.chip-select__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 22px;
}
</style>
