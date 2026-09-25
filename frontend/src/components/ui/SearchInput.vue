<script setup lang="ts">
import { ref, useSlots } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'SearchInput' })

const { t } = useI18n({ useScope: 'global' })
const model = defineModel<string>({ default: '' })
const slots = useSlots()

const props = withDefaults(defineProps<{
  placeholder?: string
  loading?: boolean
  full?: boolean
  /** 锁定搜索入口 (输入框、清空、回车、提交按钮一并禁用) */
  disabled?: boolean
}>(), {
  placeholder: '',
  loading: false,
  full: false,
  disabled: false,
})

const emit = defineEmits<{
  search: [query: string]
}>()

const inputRef = ref<HTMLInputElement>()

function submit() {
  if (props.disabled) return
  emit('search', model.value.trim())
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (!props.disabled) submit()
  }
}

function onClear() {
  if (props.disabled) return
  model.value = ''
  emit('search', '')
  focus()
}

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="search-input" :class="{ 'search-input--full': full, 'search-input--disabled': disabled }">
    <input
      ref="inputRef"
      v-model="model"
      type="text"
      class="search-input__field"
      :placeholder="placeholder || t('common.search_hint')"
      :disabled="disabled"
      @keydown="onKeydown"
    >
    <button
      type="button"
      v-if="model"
      class="search-input__clear"
      tabindex="-1"
      :disabled="disabled"
      :aria-label="t('common.btn.clear')"
      :title="t('common.btn.clear')"
      @click="onClear"
    >
      <MsIcon name="close" size="xs" />
    </button>

    <div v-if="slots.inline" class="search-input__divider" />
    <slot name="inline" />

    <button
      type="button"
      class="search-input__submit"
      :aria-label="t('common.btn.search')"
      :title="t('common.btn.search')"
      :disabled="loading || disabled"
      @click="submit"
    >
      <MsIcon v-if="!loading" name="search" />
      <span v-else class="search-input__spinner" />
    </button>
  </div>
</template>

<style scoped>
.search-input {
  display: inline-flex;
  align-items: center;
  /* 宽度基线见 css/forms.css。用 lg 而非 md —— 这里要能粘 CivitAI 链接。 */
  flex: 1 1 var(--ctl-w-lg);
  min-width: 0;
  max-width: var(--ctl-w-lg);
  border: 1px solid var(--bd);
  background: var(--bg);
  border-radius: var(--input-radius, 6px);
  transition: border-color .15s;
}

.search-input:focus-within {
  border-color: var(--ac);
  box-shadow: 0 0 0 3px var(--acg);
}

.search-input--full {
  width: 100%;
  flex: 1;
  max-width: none;
}

.search-input__field {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  padding: 8px 12px;
  font-size: var(--input-font, .85rem);
  font-family: inherit;
  color: var(--t1);
  outline: none;
}

.search-input__field::placeholder {
  color: var(--t3);
}

.search-input--disabled {
  opacity: .6;
  cursor: not-allowed;
}

.search-input--disabled .search-input__field {
  cursor: not-allowed;
}

.search-input__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
  padding: 0;
  margin-right: 2px;
}

.search-input__clear:hover {
  background: var(--bg3);
  color: var(--t2);
}

.search-input__divider {
  width: 1px;
  height: 20px;
  background: var(--bd);
  flex-shrink: 0;
  margin: 0 2px;
}

.search-input__submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: stretch;
  /* 图标宽度即可 —— min-width:100px + padding:0 32px 在 toolbar 里
     宽得离谱, 与同排 size="sm" 的下拉完全不协调。 */
  width: 34px;
  padding: 0;
  border: none;
  border-radius: 0 calc(var(--input-radius, 6px) - 1px) calc(var(--input-radius, 6px) - 1px) 0;
  background: var(--ac);
  color: #fff;
  cursor: pointer;
  transition: opacity .15s;
}

.search-input__submit:hover:not(:disabled) {
  opacity: .85;
}

.search-input__submit:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.search-input__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, .3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: search-spin .6s linear infinite;
}

@keyframes search-spin {
  to { transform: rotate(360deg); }
}
</style>
