<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue'
import ChipSelect, { type ChipOption } from '@/components/ui/ChipSelect.vue'
import BaseSelect, { type SelectOption } from '@/components/form/BaseSelect.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'CivitaiFilterPopover' })

const props = withDefaults(defineProps<{
  types: string[]
  baseModels: string[]
  typeOptions: ChipOption[]
  baseModelOptions: ChipOption[]
  /** 排序 (与类型/基模同为 API 检索参数, 统一收进本面板) */
  sort: string
  sortOptions: SelectOption[]
  disabled?: boolean
  exactMode?: boolean
}>(), {
  disabled: false,
  exactMode: false,
})

const emit = defineEmits<{
  apply: [types: string[], baseModels: string[], sort: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const draftTypes = ref<string[]>([])
const draftBaseModels = ref<string[]>([])
const draftSort = ref(props.sort)
const baseModelQuery = ref('')

const { floatingStyles } = useFloating(trigger, panel, {
  open,
  placement: 'bottom-start',
  strategy: 'fixed',
  middleware: [offset(5), flip({ padding: 8 }), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
})

const selectedCount = computed(() => props.types.length + props.baseModels.length)
const draftHasSelection = computed(() => draftTypes.value.length > 0 || draftBaseModels.value.length > 0)
const draftChanged = computed(() => {
  const same = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set(b).size && a.every(v => b.includes(v))
  return !same(draftTypes.value, props.types) || !same(draftBaseModels.value, props.baseModels) || draftSort.value !== props.sort
})
const filteredBaseModelOptions = computed(() => {
  const query = baseModelQuery.value.trim().toLocaleLowerCase()
  if (!query) return props.baseModelOptions
  // Keep selected chips visible while searching so a selected value can always
  // be removed without first clearing the search field.
  const selected = new Set(draftBaseModels.value)
  return props.baseModelOptions.filter(option =>
    selected.has(option.value) || option.label.toLocaleLowerCase().includes(query),
  )
})
const triggerLabel = computed(() => {
  if (props.exactMode) return t('models.civitai.exact_mode')
  return selectedCount.value
    ? `${t('models.civitai.filter_button')} · ${selectedCount.value}`
    : t('models.civitai.filter_button')
})

function syncDraft() {
  draftTypes.value = [...props.types]
  draftBaseModels.value = [...props.baseModels]
  draftSort.value = props.sort
}

function toggle() {
  if (props.disabled || props.exactMode) return
  open.value = !open.value
  if (open.value) {
    syncDraft()
    void nextTick(() => {
      document.addEventListener('pointerdown', onDocumentPointerDown)
      document.addEventListener('keydown', onDocumentKeydown)
    })
  } else {
    removeDocumentListeners()
  }
}

function removeDocumentListeners() {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
}

function close() {
  open.value = false
  baseModelQuery.value = ''
  removeDocumentListeners()
}

function apply() {
  emit('apply', [...draftTypes.value], [...draftBaseModels.value], draftSort.value)
  close()
}

function clearFilters() {
  draftTypes.value = []
  draftBaseModels.value = []
  // Clear is an immediate action, but intentionally leaves the popover open
  // so the user can see the reset state and choose another combination.
  // 排序不算筛选条件, 清除时保留。
  emit('apply', [], [], draftSort.value)
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (root.value?.contains(target) || panel.value?.contains(target)) return
  // 豁免: 排序 BaseSelect teleport 到 <body> 的下拉面板,
  // 点击其选项不应触发外层 popover 的 outside-close
  if (target instanceof Element && target.closest('.base-select__panel--teleported')) return
  close()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  close()
}

watch(() => [props.types, props.baseModels, props.sort], syncDraft, { deep: true })
watch(() => props.exactMode, (exact) => { if (exact) close() })
onBeforeUnmount(removeDocumentListeners)
</script>

<template>
  <div ref="root" class="civitai-filter">
    <button
      ref="trigger"
      type="button"
      class="civitai-filter__trigger"
      :class="{ 'is-active': selectedCount > 0 }"
      :disabled="disabled || exactMode"
      :title="exactMode ? t('models.civitai.filter_exact_disabled') : triggerLabel"
      :aria-label="exactMode ? t('models.civitai.filter_exact_disabled') : triggerLabel"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <MsIcon name="filter_alt" />
      <span class="civitai-filter__trigger-label app-toolbar__label">{{ triggerLabel }}</span>
      <MsIcon name="expand_more" class="civitai-filter__trigger-caret" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="civitai-filter__panel"
        :style="floatingStyles"
        role="dialog"
        :aria-label="t('models.civitai.filter_button')"
      >
        <div class="civitai-filter__header">
          <div class="civitai-filter__title">{{ t('models.civitai.filter_button') }}</div>
          <div class="civitai-filter__actions">
            <button
              type="button"
              class="civitai-filter__clear"
              :disabled="!draftHasSelection"
              @click="clearFilters"
            >
              {{ t('models.civitai.filter_clear') }}
            </button>
            <button
              type="button"
              class="civitai-filter__apply"
              :disabled="!draftChanged"
              @click="apply"
            >
              {{ t('models.civitai.filter_apply') }}
            </button>
          </div>
        </div>
        <div class="civitai-filter__content">
          <div class="civitai-filter__section">
            <div class="civitai-filter__label">{{ t('models.civitai.filter_sort') }}</div>
            <BaseSelect
              v-model="draftSort"
              :options="sortOptions"
              size="sm"
              teleport
            />
          </div>
          <div class="civitai-filter__section">
            <div class="civitai-filter__label">{{ t('models.civitai.filter_type') }}</div>
            <ChipSelect
              v-model="draftTypes"
              :options="typeOptions"
              multiple
            />
          </div>
          <div class="civitai-filter__section">
            <div class="civitai-filter__label">{{ t('models.civitai.filter_base_model') }}</div>
            <input
              v-model="baseModelQuery"
              type="search"
              class="civitai-filter__search"
              :placeholder="t('models.civitai.filter_search_base_model')"
              :aria-label="t('models.civitai.filter_base_model')"
            />
            <ChipSelect
              v-model="draftBaseModels"
              :options="filteredBaseModelOptions"
              multiple
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.civitai-filter {
  position: relative;
  flex: 0 0 auto;
}

.civitai-filter__trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  /* 与 toolbar input (36px) 同高: 筛选入口是 Civitai 的主控件之一 */
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--bd);
  border-radius: var(--input-radius, 6px);
  background: var(--bg);
  color: var(--t2);
  font: inherit;
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: pointer;
}

.civitai-filter__trigger:hover:not(:disabled) {
  border-color: var(--bd-f);
  color: var(--t1);
}

.civitai-filter__trigger.is-active {
  border-color: var(--bd-f);
  background: var(--bg3);
  color: var(--t1);
}

.civitai-filter__trigger:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.civitai-filter__panel {
  z-index: var(--z-float);
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 16px));
  max-height: min(620px, calc(100vh - 24px));
  padding: 0;
  border: 1px solid var(--bd);
  border-radius: var(--input-radius, 6px);
  background: var(--bg2);
  box-shadow: 0 8px 24px rgb(0 0 0 / 22%);
  overflow: hidden;
}

.civitai-filter__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex: 0 0 auto;
  padding: 10px 12px;
  border-bottom: 1px solid var(--bd);
  background: var(--bg2);
}

.civitai-filter__title {
  color: var(--t1);
  font-size: var(--text-sm);
  font-weight: 600;
}

.civitai-filter__content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
}

.civitai-filter__section {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
}

.civitai-filter__label {
  color: var(--t2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.civitai-filter__section :deep(.chip-select-root) {
  min-width: 0;
}

.civitai-filter__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.civitai-filter__actions button {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 5px;
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.civitai-filter__clear {
  border: 1px solid var(--bd);
  background: transparent;
  color: var(--t2);
}

.civitai-filter__clear:hover:not(:disabled) {
  border-color: var(--bd-f);
  color: var(--t1);
}

.civitai-filter__apply {
  border: 1px solid color-mix(in srgb, var(--ac) 65%, var(--bg3));
  background: color-mix(in srgb, var(--ac) 65%, var(--bg3));
  color: #fff;
}

.civitai-filter__apply:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ac) 80%, var(--bg3));
  background: color-mix(in srgb, var(--ac) 80%, var(--bg3));
}

.civitai-filter__actions button:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.civitai-filter__search {
  width: 100%;
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--bd);
  border-radius: var(--input-radius, 6px);
  background: var(--bg-in);
  color: var(--t1);
  font: inherit;
  font-size: var(--text-sm);
}

.civitai-filter__search:focus {
  outline: none;
  border-color: var(--ac);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac) 18%, transparent);
}

/* 工具栏窄屏 (<600px): label 由 AppToolbar 通用契约隐藏,
   这里去掉展开箭头并 ghost 化 (对齐收缩态的 BaseButton 纯图标规格) */
@container toolbar (max-width: 600px) {
  .civitai-filter__trigger {
    min-width: 42px;
    padding-inline: 0;
    justify-content: center;
    border-color: transparent;
    background: transparent;
  }

  .civitai-filter__trigger-caret {
    display: none;
  }
}
</style>
