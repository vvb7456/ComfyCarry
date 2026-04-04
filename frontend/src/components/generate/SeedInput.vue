<script setup lang="ts">
import { computed } from 'vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'SeedInput' })

const props = withDefaults(defineProps<{
  modelValue: number
  mode: 'random' | 'fixed'
  disabled?: boolean
}>(), {})

const emit = defineEmits<{
  'update:modelValue': [value: number]
  'update:mode': [mode: 'random' | 'fixed']
}>()

const isRandom = computed(() => props.mode === 'random')

function toggleMode() {
  emit('update:mode', isRandom.value ? 'fixed' : 'random')
}

function onChange(e: Event) {
  const raw = parseInt((e.target as HTMLInputElement).value)
  if (isNaN(raw)) return
  const clamped = Math.max(0, Math.min(4294967295, raw))
  emit('update:modelValue', clamped)
}
</script>

<template>
  <div class="seed-input" :class="{ 'seed-input--disabled': disabled }">
    <input
      type="number"
      class="seed-input__field"
      :class="{ 'seed-input__field--random': isRandom }"
      :value="modelValue"
      :readonly="isRandom"
      :disabled="disabled"
      min="0"
      max="4294967295"
      @change="onChange"
    />
    <button
      type="button"
      class="seed-input__toggle"
      :class="{ 'seed-input__toggle--locked': !isRandom }"
      :disabled="disabled"
      :title="isRandom ? 'Random' : 'Fixed'"
      @click="toggleMode"
    >
      <MsIcon :name="isRandom ? 'casino' : 'lock_open'" size="xs" color="none" />
    </button>
  </div>
</template>

<style scoped>
.seed-input {
  position: relative;
  display: flex;
}

.seed-input--disabled {
  opacity: .55;
  pointer-events: none;
}

.seed-input__field {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  padding-right: 34px;
  font-size: .85rem;
  font-family: inherit;
  border-radius: 6px;
  border: 1px solid var(--bd);
  background: var(--bg);
  color: var(--t1);
  outline: none;
  transition: border-color .15s;
  -moz-appearance: textfield;
  appearance: textfield;
}

.seed-input__field::-webkit-inner-spin-button,
.seed-input__field::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.seed-input__field:focus {
  border-color: var(--ac);
}

.seed-input__field--random {
  color: var(--t3);
}

.seed-input__toggle {
  position: absolute;
  right: 1px;
  top: 1px;
  bottom: 1px;
  width: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg3);
  border: none;
  border-left: 1px solid var(--bd);
  border-radius: 0 6px 6px 0;
  color: var(--t3);
  cursor: pointer;
  transition: color .15s, background .15s;
}

.seed-input__toggle:hover {
  background: var(--bg4);
  color: var(--t1);
}

.seed-input__toggle--locked {
  color: var(--amber);
}

.seed-input__toggle--locked:hover {
  color: var(--amber);
}
</style>
