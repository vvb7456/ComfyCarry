<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFloating, autoUpdate, offset, flip, shift, size as floatingSize } from '@floating-ui/vue'
import MsIcon from '../ui/MsIcon.vue'

defineOptions({ name: 'BaseSelect' })

export interface SelectOption {
  value: string | number | boolean
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  /** Current value (v-model) */
  modelValue: string | number | boolean
  /**
   * Options — accepts multiple shapes:
   * - SelectOption[]: canonical {value, label}
   * - string[]: auto-converts to {value: s, label: s}
   * - Record<string, any>[]: uses valueKey/labelKey to map
   */
  options: SelectOption[] | string[] | Record<string, string | number | boolean>[]
  /** Key to extract value from object options */
  valueKey?: string
  /** Key to extract label from object options */
  labelKey?: string
  /** Text shown when no value is selected */
  placeholder?: string
  /** Override display text (ignores current selection) */
  displayText?: string
  /** Enable search input in the dropdown panel */
  searchable?: boolean
  /** Placeholder text for the search input */
  searchPlaceholder?: string
  /** Text shown when search yields no results */
  emptyText?: string
  /** Whether the select is disabled */
  disabled?: boolean
  /** Visual size: 'default' matches form-input, 'sm' for toolbars */
  size?: 'default' | 'sm'
  /** When true, width shrinks to fit content instead of 100% */
  fit?: boolean
  /** When true, dropdown panel is teleported to body (for use inside overflow containers) */
  teleport?: boolean
}>(), {
  valueKey: 'value',
  labelKey: 'label',
  placeholder: '',
  displayText: '',
  searchable: false,
  searchPlaceholder: '',
  emptyText: '',
  disabled: false,
  size: 'default',
  fit: false,
  teleport: false,
})

const { t } = useI18n({ useScope: 'global' })

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
  'change': [value: string | number | boolean]
}>()

const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const open = ref(false)
const search = ref('')
const highlightIdx = ref(-1)

// ── Floating UI positioning ──────────────────────────────────
// When teleport is on, use fixed strategy so the panel escapes any
// overflow:hidden / clipping ancestor. When off, absolute is fine
// because the panel is a direct child of .base-select (position: relative).
const { floatingStyles, isPositioned, placement } = useFloating(triggerRef, panelRef, {
  open,
  placement: 'bottom-start',
  strategy: props.teleport ? 'fixed' : 'absolute',
  middleware: [
    offset(4),
    flip({ padding: 8 }),
    shift({ padding: 8 }),
    floatingSize({
      padding: 8,
      apply({ availableHeight, elements }) {
        // Clamp the list max-height to the available viewport space
        const searchH = props.searchable ? 36 : 0
        const max = Math.max(80, availableHeight - searchH)
        elements.floating.style.setProperty('--bs-list-max', `${max}px`)
      },
    }),
  ],
  whileElementsMounted: autoUpdate,
})

/**
 * When teleported to <body>, CSS `min-width: 100%` would resolve against the
 * body (full viewport) instead of the trigger. We must set it inline to match
 * the trigger's actual width. Non-teleported panels use CSS `min-width: 100%`
 * which correctly resolves to the .base-select parent width.
 */
const panelStyle = computed(() => {
  if (!props.teleport) return floatingStyles.value
  const tw = triggerRef.value?.offsetWidth
  return {
    ...floatingStyles.value,
    minWidth: tw ? `${tw}px` : undefined,
  }
})

/** Normalize any option shape to SelectOption[] */
const normalizedOptions = computed<SelectOption[]>(() => {
  return (props.options as unknown[]).map((o) => {
    if (typeof o === 'string') return { value: o, label: o }
    if (typeof o === 'number') return { value: o, label: String(o) }
    const rec = o as Record<string, string | number | boolean>
    return {
      value: rec[props.valueKey] ?? rec.value ?? rec.id ?? rec.name ?? '',
      label: String(rec[props.labelKey] || rec.label || rec.name || rec.display_name || rec[props.valueKey] || ''),
      disabled: !!(rec as Record<string, unknown>).disabled,
    }
  })
})

/** Options after search filter (when searchable) */
const filteredOptions = computed(() => {
  if (!props.searchable || !search.value) return normalizedOptions.value
  const q = search.value.toLowerCase()
  return normalizedOptions.value.filter(o =>
    String(o.label).toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q)
  )
})

const selectedLabel = computed(() => {
  if (props.displayText) return props.displayText
  const opt = normalizedOptions.value.find(o => o.value === props.modelValue)
  return opt ? opt.label : props.placeholder
})

const isPlaceholder = computed(() => {
  if (props.displayText) return false
  return !normalizedOptions.value.some(o => o.value === props.modelValue)
})

const isSelectedDisabled = computed(() => {
  const opt = normalizedOptions.value.find(o => o.value === props.modelValue)
  return !!opt?.disabled
})

// Reset highlight when filtered list changes
watch(filteredOptions, () => { highlightIdx.value = -1 })

function openPanel() {
  open.value = true
  // Pre-highlight selected item
  const idx = filteredOptions.value.findIndex(o => o.value === props.modelValue)
  highlightIdx.value = idx >= 0 ? idx : 0
  if (props.searchable) {
    search.value = ''
    nextTick(() => searchRef.value?.focus())
  } else {
    nextTick(() => listRef.value?.focus())
  }
}

function toggle() {
  if (props.disabled) return
  if (open.value) { open.value = false } else { openPanel() }
}

function select(opt: SelectOption) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  emit('change', opt.value)
  open.value = false
  // Return focus to trigger
  nextTick(() => triggerRef.value?.focus())
}

function onKeydown(e: KeyboardEvent) {
  const opts = filteredOptions.value
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      openPanel()
    }
    return
  }
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      highlightIdx.value = (highlightIdx.value + 1) % opts.length
      scrollToHighlighted()
      break
    case 'ArrowUp':
      e.preventDefault()
      highlightIdx.value = (highlightIdx.value - 1 + opts.length) % opts.length
      scrollToHighlighted()
      break
    case 'Enter':
      e.preventDefault()
      if (highlightIdx.value >= 0 && highlightIdx.value < opts.length && !opts[highlightIdx.value].disabled) {
        select(opts[highlightIdx.value])
      }
      break
    case 'Escape':
      e.preventDefault()
      open.value = false
      triggerRef.value?.focus()
      break
  }
}

function scrollToHighlighted() {
  nextTick(() => {
    listRef.value?.querySelector('.base-select__item--hl')?.scrollIntoView({ block: 'nearest' })
  })
}

function onClickOutside(e: MouseEvent) {
  if (triggerRef.value && !triggerRef.value.contains(e.target as Node)) {
    // For teleported panels, also check if click is inside the panel
    if (panelRef.value?.contains(e.target as Node)) return
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
})
</script>

<template>
  <div class="base-select" :class="[
    disabled && 'base-select--disabled',
    open && 'base-select--open',
    fit && 'base-select--fit',
    `base-select--${size}`,
  ]" @keydown="onKeydown">
    <div ref="triggerRef" class="base-select__trigger" tabindex="0" @click="toggle">
      <span class="base-select__text text-truncate" :class="{ 'base-select__text--ph': isPlaceholder, 'base-select__text--muted': isSelectedDisabled }">{{ selectedLabel }}</span>
      <MsIcon name="expand_more" size="sm" color="var(--t3)" />
    </div>
    <Teleport to="body" :disabled="!teleport">
      <Transition name="bs-fade">
        <div
          v-if="open"
          ref="panelRef"
          class="base-select__panel"
          :class="{ 'base-select__panel--teleported': teleport }"
          :style="panelStyle"
          :data-placement="placement"
        >
          <!-- Search input (when searchable) -->
          <input
            v-if="searchable"
            ref="searchRef"
            type="text"
            v-model="search"
            :placeholder="searchPlaceholder"
            class="base-select__search"
            @click.stop
          />
          <div ref="listRef" class="base-select__list" tabindex="-1">
            <div v-if="filteredOptions.length === 0" class="base-select__empty">{{ emptyText || t('common.no_matches') }}</div>
            <div
              v-for="(opt, idx) in filteredOptions"
              :key="String(opt.value)"
              class="base-select__item text-truncate"
              :class="{
                'base-select__item--sel': opt.value === modelValue,
                'base-select__item--hl': idx === highlightIdx,
                'base-select__item--disabled': opt.disabled,
              }"
              @click="select(opt)"
              @mouseenter="highlightIdx = idx"
            >
              {{ opt.label }}
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.base-select {
  position: relative;
  width: 100%;
}
.base-select--fit {
  width: fit-content !important;
  min-width: 140px;
}
.base-select--disabled {
  opacity: .55;
  pointer-events: none;
}

/* ── Trigger ── */
.base-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  font-size: .85rem;
  font-family: inherit;
  border-radius: 6px;
  border: 1px solid var(--bd);
  background: var(--bg);
  color: var(--t1);
  cursor: pointer;
  transition: border-color .15s;
  box-sizing: border-box;
}
.base-select--default .base-select__trigger { padding: 8px 12px; }
.base-select--sm .base-select__trigger {
  padding: 4px 8px;
  font-size: .82rem;
  min-height: 28px;
  border-radius: 4px;
}
.base-select__trigger:hover,
.base-select--open .base-select__trigger {
  border-color: var(--ac);
}

.base-select__text {
  flex: 1;
  min-width: 0;
}
.base-select__text--ph { color: var(--t3); }
.base-select__text--muted { color: var(--t3); opacity: .7; }

/* ── Panel ── */
/* Position is handled by floatingStyles (inline). Only visual properties here. */
.base-select__panel {
  min-width: 100%;
  width: max-content;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.25);
  z-index: 9999;
  overflow: hidden;
}

/* ── Search input ── */
.base-select__search {
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-bottom: 1px solid var(--bd);
  background: var(--bg);
  color: var(--t1);
  font-size: .85rem;
  outline: none;
  box-sizing: border-box;
}

/* ── List ── */
.base-select__list {
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  outline: none;
}

/* ── Item ── */
.base-select__item {
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: .85rem;
  color: var(--t1);
}
.base-select--sm .base-select__item {
  padding: 4px 8px;
  font-size: .82rem;
}
.base-select__item:hover,
.base-select__item--hl { background: var(--bg3); }
.base-select__item--sel { color: var(--ac); font-weight: 500; }
.base-select__item--disabled {
  opacity: .45;
  cursor: default;
  pointer-events: none;
}

/* ── Empty state ── */
.base-select__empty {
  padding: 12px 10px;
  text-align: center;
  color: var(--t3);
  font-size: .82rem;
}

/* ── Transition ── */
.bs-fade-enter-active, .bs-fade-leave-active { transition: opacity .12s; }
.bs-fade-enter-from, .bs-fade-leave-to { opacity: 0; }
</style>

<!-- Global styles for teleported panel (escapes scoped context) -->
<style>
.base-select__panel--teleported {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.25);
  overflow: hidden;
}
.base-select__panel--teleported .base-select__list {
  max-height: var(--bs-list-max, 200px);
  overflow-y: auto;
  padding: 4px;
  outline: none;
}
.base-select__panel--teleported .base-select__item {
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: .82rem;
  color: var(--t1);
}
.base-select__panel--teleported .base-select__item:hover,
.base-select__panel--teleported .base-select__item--hl { background: var(--bg3); }
.base-select__panel--teleported .base-select__item--sel { color: var(--ac); font-weight: 500; }
.base-select__panel--teleported .base-select__empty {
  padding: 12px 10px;
  text-align: center;
  color: var(--t3);
  font-size: .82rem;
}
</style>
