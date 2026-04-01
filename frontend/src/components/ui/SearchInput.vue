<script setup lang="ts">
/**
 * SearchInput — network/server search input with inline submit button.
 *
 * Unlike FilterInput (instant local filter), SearchInput conveys "submit to search"
 * semantics via an explicit inline search button. Supports Enter key submission.
 *
 * Layout (flex, no absolute positioning):
 *   [ input (flex:1) | clear? | #inline slot | submit button ]
 *
 * The outer container IS the visual input box (border + bg).
 *
 * Slots:
 *   #inline — Extra controls between clear button and submit (e.g. sort dropdown)
 *
 * Props:
 *   placeholder  — Placeholder text
 *   loading      — Show spinner instead of search icon
 *   full         — width: 100% (default: false, natural inline width)
 */
import { ref, useSlots } from 'vue'
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'SearchInput' })

const model = defineModel<string>({ default: '' })
const slots = useSlots()

const props = withDefaults(defineProps<{
  placeholder?: string
  loading?: boolean
  full?: boolean
}>(), {
  placeholder: 'Search…',
  loading: false,
  full: false,
})

const emit = defineEmits<{
  search: [query: string]
}>()

const inputRef = ref<HTMLInputElement>()

function submit() {
  emit('search', model.value.trim())
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="search-input" :class="{ 'search-input--full': full }">
    <input
      ref="inputRef"
      v-model="model"
      type="text"
      class="search-input__field"
      :placeholder="placeholder"
      @keydown="onKeydown"
    >
    <button
      v-if="model"
      class="search-input__clear"
      tabindex="-1"
      @click="model = ''; emit('search', ''); focus()"
    >
      <MsIcon name="close" class="ms-xs" />
    </button>

    <!-- Inline slot for extra controls (e.g. sort dropdown) -->
    <div v-if="slots.inline" class="search-input__divider" />
    <slot name="inline" />

    <button
      class="search-input__submit"
      :disabled="loading"
      @click="submit"
    >
      <MsIcon v-if="!loading" name="search" class="ms-sm" />
      <span v-else class="search-input__spinner" />
    </button>
  </div>
</template>

<style scoped>
.search-input {
  display: inline-flex;
  align-items: center;
  min-width: 200px;
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
  min-width: 100px;
  padding: 0 32px;
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
