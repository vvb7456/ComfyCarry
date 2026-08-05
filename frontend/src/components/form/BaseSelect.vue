<script lang="ts">
/** 单个选项的取值类型。BaseSelect 是泛型组件, 调用点各自推断 T。 */
export type SelectValue = string | number | boolean

export interface SelectOption {
  value: SelectValue
  label: string
  disabled?: boolean
  /** 分组标题。相邻的同 group 选项归为一组，在组首渲染一个不可点击的分组头 */
  group?: string
  /** 右侧次要小字，如 "已装" / "5.16 GB" */
  hint?: string
  /** 选项前缀图片 URL (品牌 logo 等); 与 icon 二选一, logo 优先 */
  logo?: string
  /** 选项前缀 MsIcon 图标名 (无 logo 素材时的后备) */
  icon?: string
}
</script>

<script setup lang="ts" generic="T extends SelectValue | SelectValue[] = SelectValue">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFloating, autoUpdate, offset, flip, shift, size as floatingSize } from '@floating-ui/vue'
import MsIcon from '../ui/MsIcon.vue'

defineOptions({ name: 'BaseSelect' })

const props = withDefaults(defineProps<{
  /** Current value (v-model). Array when `multiple` is on. */
  modelValue: T
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
  /** Optional upper bound for the dropdown option list (in px). */
  maxListHeight?: number
  /**
   * Multi-select. modelValue becomes an array; the panel stays open on pick and
   * each row gets a checkbox. Trigger shows "A, B" or "N selected" past `maxTagText`.
   */
  multiple?: boolean
  /** Trigger text when nothing is selected in multiple mode (falls back to placeholder) */
  allText?: string
  /** Show "N selected" instead of a label list once this many are picked (default 2) */
  maxTagText?: number
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
  multiple: false,
  allText: '',
  maxTagText: 2,
})

const { t } = useI18n({ useScope: 'global' })

const emit = defineEmits<{
  'update:modelValue': [value: T]
  'change': [value: T]
}>()

/** Current selection as an array, regardless of mode — the one shape all logic uses. */
const selectedValues = computed<SelectValue[]>(() => {
  if (props.multiple) {
    return Array.isArray(props.modelValue) ? props.modelValue : []
  }
  return props.modelValue === undefined || props.modelValue === null
    ? []
    : [props.modelValue as SelectValue]
})

function isSelected(v: SelectValue): boolean {
  return selectedValues.value.includes(v)
}

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
        const availableMax = Math.max(80, availableHeight - searchH)
        const max = props.maxListHeight == null
          ? availableMax
          : Math.min(Math.max(80, props.maxListHeight), availableMax)
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
    const grp = (rec as Record<string, unknown>).group
    const hnt = (rec as Record<string, unknown>).hint
    const lgo = (rec as Record<string, unknown>).logo
    const ico = (rec as Record<string, unknown>).icon
    return {
      value: rec[props.valueKey] ?? rec.value ?? rec.id ?? rec.name ?? '',
      label: String(rec[props.labelKey] || rec.label || rec.name || rec.display_name || rec[props.valueKey] || ''),
      disabled: !!(rec as Record<string, unknown>).disabled,
      group: typeof grp === 'string' ? grp : undefined,
      hint: typeof hnt === 'string' ? hnt : undefined,
      logo: typeof lgo === 'string' ? lgo : undefined,
      icon: typeof ico === 'string' ? ico : undefined,
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

type RenderRow =
  | { kind: 'group', label: string, key: string }
  | { kind: 'option', opt: SelectOption, idx: number }

const renderRows = computed<RenderRow[]>(() => {
  const rows: RenderRow[] = []
  let prevGroup: string | undefined
  filteredOptions.value.forEach((opt, idx) => {
    if (opt.group && opt.group !== prevGroup) {
      rows.push({ kind: 'group', label: opt.group, key: `g:${opt.group}` })
    }
    rows.push({ kind: 'option', opt, idx })
    prevGroup = opt.group
  })
  return rows
})

/** 当前选中项 (单选) —— trigger 上的 logo / icon 取自它 */
const selectedOption = computed(() => {
  if (props.multiple || props.displayText) return undefined
  return normalizedOptions.value.find(o => o.value === props.modelValue)
})

const selectedLabel = computed(() => {
  if (props.displayText) return props.displayText
  if (props.multiple) {
    const picked = normalizedOptions.value.filter(o => isSelected(o.value))
    if (picked.length === 0) return props.allText || props.placeholder
    if (picked.length > props.maxTagText) {
      return t('common.n_selected', { count: picked.length })
    }
    return picked.map(o => o.label).join(', ')
  }
  const opt = normalizedOptions.value.find(o => o.value === props.modelValue)
  return opt ? opt.label : props.placeholder
})

const isPlaceholder = computed(() => {
  if (props.displayText) return false
  if (props.multiple) return selectedValues.value.length === 0
  return !normalizedOptions.value.some(o => o.value === props.modelValue)
})

const isSelectedDisabled = computed(() => {
  if (props.multiple) return false
  const opt = normalizedOptions.value.find(o => o.value === props.modelValue)
  return !!opt?.disabled
})

// Reset highlight when filtered list changes
watch(filteredOptions, () => { highlightIdx.value = -1 })

function openPanel() {
  open.value = true
  // Pre-highlight selected item
  const idx = filteredOptions.value.findIndex(o => isSelected(o.value))
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

/** 内部一律按数组算, 对外 emit 时断言回调用点的泛型 T。 */
function emitValue(v: SelectValue | SelectValue[]) {
  emit('update:modelValue', v as T)
  emit('change', v as T)
}

function select(opt: SelectOption) {
  if (opt.disabled) return

  if (props.multiple) {
    // 面板保持打开 —— 多选的常见动作是连点几项, 每次关闭再打开会很烦。
    const next = isSelected(opt.value)
      ? selectedValues.value.filter(v => v !== opt.value)
      : [...selectedValues.value, opt.value]
    emitValue(next)
    return
  }

  emitValue(opt.value)
  open.value = false
  // Return focus to trigger
  nextTick(() => triggerRef.value?.focus())
}

/** 清空多选 (触发器上的 × )。 */
function clearAll(e: Event) {
  e.stopPropagation()
  if (props.disabled) return
  emitValue([])
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

/**
 * 面板打开期间在 document 上接管键盘。
 *
 * 不能只依赖模板上 `.base-select` 的 @keydown: openPanel() 会把焦点移进面板
 * (searchable → search input, 否则 → list), 而 teleport 模式下面板挂在 <body>,
 * keydown 的冒泡路径不经过 .base-select —— 方向键/Enter/Esc 会全部失效。
 */
function onTriggerKeydown(e: KeyboardEvent) {
  // 打开期间一律走 document 监听 —— 非 teleport 时事件同样会冒泡到
  // .base-select, 两边都处理会让方向键一次跳两格
  if (open.value) return
  onKeydown(e)
}

function onDocKeydown(e: KeyboardEvent) {
  if (!open.value) return
  const inTrigger = !!triggerRef.value?.contains(e.target as Node)
  const inPanel = !!panelRef.value?.contains(e.target as Node)
  if (!inTrigger && !inPanel) return
  onKeydown(e)
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('keydown', onDocKeydown)
  else document.removeEventListener('keydown', onDocKeydown)
})

onMounted(() => {
  document.addEventListener('click', onClickOutside)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onDocKeydown)
})
</script>

<template>
  <div class="base-select" :class="[
    disabled && 'base-select--disabled',
    open && 'base-select--open',
    fit && 'base-select--fit',
    `base-select--${size}`,
  ]" @keydown="onTriggerKeydown">
    <div ref="triggerRef" class="base-select__trigger" tabindex="0" @click="toggle">
      <img v-if="selectedOption?.logo" :src="selectedOption.logo" class="base-select__logo" alt="">
      <MsIcon v-else-if="selectedOption?.icon" :name="selectedOption.icon" size="sm" />
      <span class="base-select__text text-truncate" :class="{ 'base-select__text--ph': isPlaceholder, 'base-select__text--muted': isSelectedDisabled }">{{ selectedLabel }}</span>
      <button
        v-if="multiple && selectedValues.length > 0 && !disabled"
        class="base-select__clear"
        type="button"
        tabindex="-1"
        :aria-label="t('common.btn.clear')"
        @click="clearAll"
      >
        <MsIcon name="close" size="xs" />
      </button>
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
            <template v-for="row in renderRows" :key="row.kind === 'group' ? row.key : String(row.opt.value)">
              <div v-if="row.kind === 'group'" class="base-select__group">{{ row.label }}</div>
              <div
                v-else
                class="base-select__item"
                :class="{
                  'base-select__item--sel': isSelected(row.opt.value),
                  'base-select__item--hl': row.idx === highlightIdx,
                  'base-select__item--disabled': row.opt.disabled,
                }"
                :role="multiple ? 'menuitemcheckbox' : 'option'"
                :aria-checked="multiple ? isSelected(row.opt.value) : undefined"
                @click="select(row.opt)"
                @mouseenter="highlightIdx = row.idx"
              >
                <MsIcon
                  v-if="multiple"
                  class="base-select__check"
                  :name="isSelected(row.opt.value) ? 'check_box' : 'check_box_outline_blank'"
                  size="sm"
                />
                <img v-if="row.opt.logo" :src="row.opt.logo" class="base-select__logo" alt="">
                <MsIcon v-else-if="row.opt.icon" :name="row.opt.icon" size="sm" />
                <span class="base-select__item-label text-truncate">{{ row.opt.label }}</span>
                <span v-if="row.opt.hint" class="base-select__hint">{{ row.opt.hint }}</span>
              </div>
            </template>
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
.base-select__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
}
.base-select__clear:hover {
  background: var(--bg3);
  color: var(--t2);
}
.base-select__check {
  flex-shrink: 0;
  color: var(--t3);
}
.base-select__item--sel .base-select__check {
  color: var(--ac);
}
.base-select--fit {
  width: fit-content !important;
  /* 宽度基线见 css/forms.css */
  min-width: var(--ctl-w-sm);
  max-width: var(--ctl-w-md);
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
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: .85rem;
  color: var(--t1);
}
/* 选项 / trigger 上的品牌 logo */
.base-select__logo {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex-shrink: 0;
}
.base-select__item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ── Group header ── */
.base-select__group {
  padding: 6px 10px 3px;
  font-size: .68rem;
  font-weight: 600;
  color: var(--t3);
  text-transform: none;
  letter-spacing: .02em;
  border-top: 1px solid var(--bd);
  margin-top: 2px;
  user-select: none;
  cursor: default;
}
.base-select__group:first-child { border-top: none; margin-top: 0; }
.base-select__hint {
  flex: none;
  font-size: .68rem;
  color: var(--t3);
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
  /* 面板 teleport 到 body 后与 BaseModal 的遮罩 (z-index 1000) 同层,
     必须显式抬高 —— scoped 的 .base-select__panel z-index 管不到这里。 */
  z-index: 9999;
}
.base-select__panel--teleported .base-select__list {
  max-height: var(--bs-list-max, 200px);
  overflow-y: auto;
  padding: 4px;
  outline: none;
}
.base-select__panel--teleported .base-select__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: .82rem;
  color: var(--t1);
}
.base-select__panel--teleported .base-select__logo {
  width: 16px; height: 16px; object-fit: contain; flex-shrink: 0;
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
