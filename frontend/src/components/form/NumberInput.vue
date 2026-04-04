<script setup lang="ts">
import { computed } from 'vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'NumberInput' })

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  spinners?: boolean
  disabled?: boolean
  placeholder?: string
  center?: boolean
}>(), {
  step: 1,
  spinners: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

/* ── auto min-width: ensures the input is always wide enough for max value ── */
const rootStyle = computed(() => {
  const maxLen = Math.max(
    String(props.min ?? 0).length,
    String(props.max ?? props.modelValue).length,
  )
  // ch-based char width + padding-left(12) + padding-right(28 with spinners, 12 without) + border(2)
  const padRight = props.spinners ? 28 : 12
  return { minWidth: `calc(${maxLen}ch + ${12 + padRight + 2}px)` }
})

function countDecimals(n: number): number {
  const s = String(n)
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

function validate(v: number): number {
  // snap to step grid (matching legacy _addValidation behavior)
  v = Math.round(v / props.step) * props.step
  v = +v.toFixed(countDecimals(props.step))
  if (props.min != null) v = Math.max(props.min, v)
  if (props.max != null) v = Math.min(props.max, v)
  return v
}

function onChange(e: Event) {
  const input = e.target as HTMLInputElement
  const raw = parseFloat(input.value)
  if (isNaN(raw)) {
    input.value = String(props.modelValue)
    return
  }
  const val = validate(raw)
  emit('update:modelValue', val)
  // force DOM sync in case validated value differs from typed value
  input.value = String(val)
}

function increment() {
  emit('update:modelValue', validate(props.modelValue + props.step))
}

function decrement() {
  emit('update:modelValue', validate(props.modelValue - props.step))
}
</script>

<template>
    <div class="number-input" :class="{ 'number-input--has-spinners': spinners }" :style="rootStyle">
    <input
      type="number"
      class="number-input__field"
      :class="{ 'number-input__field--center': center }"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :placeholder="placeholder"
      @change="onChange"
    />
    <div v-if="spinners && !disabled" class="number-input__spinners">
      <button type="button" class="number-input__btn" @click="increment">
        <MsIcon name="expand_less" size="xxs" color="none" />
      </button>
      <button type="button" class="number-input__btn" @click="decrement">
        <MsIcon name="expand_more" size="xxs" color="none" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.number-input {
  position: relative;
  display: flex;
}

.number-input__field {
  width: 100%;
  font-size: .85rem;
  font-family: inherit;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--bd);
  background: var(--bg);
  color: var(--t1);
  outline: none;
  transition: border-color .15s;
  -moz-appearance: textfield;
  appearance: textfield;
}

.number-input__field::-webkit-inner-spin-button,
.number-input__field::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.number-input__field:focus {
  border-color: var(--ac);
}

.number-input__field:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.number-input--has-spinners .number-input__field {
  padding-right: 28px;
}

.number-input__field--center {
  text-align: center;
}

/* ── custom spinner buttons ── */
.number-input__spinners {
  position: absolute;
  right: 1px;
  top: 1px;
  bottom: 1px;
  width: 24px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--bd);
  border-radius: 0 6px 6px 0;
  overflow: hidden;
}

.number-input__btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg3);
  border: none;
  color: var(--t2);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.number-input__btn:hover {
  background: var(--bg4);
  color: var(--t1);
}

.number-input__btn + .number-input__btn {
  border-top: 1px solid var(--bd);
}
</style>
