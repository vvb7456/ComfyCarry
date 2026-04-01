<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: number
  min: number
  max: number
  step?: number
  label?: string
  marks?: number | string[]
  markFormat?: (value: number) => string
  showValue?: boolean
  editable?: boolean
  valueFormat?: (value: number) => string
  disabled?: boolean
}>(), {
  step: 1,
  showValue: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

/* ── helpers ── */

function stepPrecision(): number {
  const s = String(props.step)
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

function defaultFormat(v: number): string {
  return v.toFixed(stepPrecision())
}

function snap(raw: number): number {
  const s = props.step
  const snapped = Math.round((raw - props.min) / s) * s + props.min
  return Math.max(props.min, Math.min(props.max, +snapped.toFixed(stepPrecision())))
}

/* ── computed ── */

const formattedValue = computed(() =>
  props.valueFormat ? props.valueFormat(props.modelValue) : defaultFormat(props.modelValue),
)

const computedMarks = computed<string[] | null>(() => {
  if (!props.marks) return null
  if (Array.isArray(props.marks)) return props.marks
  const n = props.marks
  const fmt = props.markFormat ?? defaultFormat
  const result: string[] = []
  for (let i = 0; i <= n; i++) {
    result.push(fmt(props.min + (props.max - props.min) * i / n))
  }
  return result
})

/* ── slider ── */

function onSlide(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  emit('update:modelValue', v)
}

/* ── editable ── */

const editing = ref(false)
const editRef = ref<HTMLInputElement | null>(null)

async function startEdit() {
  if (!props.editable || props.disabled) return
  editing.value = true
  await nextTick()
  if (editRef.value) {
    // auto-size: chars * ch + padding
    const chars = String(props.modelValue).length
    editRef.value.style.width = `${Math.max(4, chars + 2)}ch`
    editRef.value.focus()
    editRef.value.select()
  }
}

function commitEdit(e: Event) {
  const raw = parseFloat((e.target as HTMLInputElement).value)
  editing.value = false
  if (isNaN(raw)) return
  emit('update:modelValue', snap(raw))
}

function cancelEdit() {
  editing.value = false
}
</script>

<template>
  <div class="range-field" :class="{ 'range-field--disabled': disabled }">
    <div v-if="label || showValue" class="range-field__header">
      <label v-if="label" class="range-field__label">
        {{ label }}
        <slot name="label-append" />
      </label>
      <span
        v-if="showValue"
        class="range-field__value"
        :class="{ 'range-field__value--editable': editable && !disabled }"
        @click="startEdit"
      >
        <input
          v-if="editing"
          ref="editRef"
          type="number"
          class="range-field__edit-input"
          :min="min"
          :max="max"
          :step="step"
          :value="modelValue"
          @blur="commitEdit"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          @keydown.escape="cancelEdit"
        />
        <template v-else>{{ formattedValue }}</template>
      </span>
    </div>

    <input
      type="range"
      class="range-field__slider"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      @input="onSlide"
    />

    <div v-if="computedMarks" class="range-field__marks">
      <span v-for="(m, i) in computedMarks" :key="i">{{ m }}</span>
    </div>
  </div>
</template>

<style scoped>
.range-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.range-field--disabled {
  opacity: .55;
  pointer-events: none;
}

.range-field__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.range-field__label {
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.range-field__value {
  color: var(--ac);
  font-weight: 600;
  font-family: 'IBM Plex Mono', monospace;
  font-size: .78rem;
  min-width: 30px;
  text-align: right;
  padding: 0 4px;
  border-radius: 3px;
  transition: background .15s;
}

.range-field__value--editable {
  cursor: pointer;
}

.range-field__value--editable:hover {
  background: var(--bg3);
}

.range-field__edit-input {
  padding: 0 2px;
  border: 1px solid var(--ac);
  border-radius: 3px;
  background: var(--bg-in);
  color: var(--ac);
  font: inherit;
  text-align: right;
  outline: none;
  -moz-appearance: textfield;
  appearance: textfield;
}

.range-field__edit-input::-webkit-inner-spin-button,
.range-field__edit-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.range-field__slider {
  width: 100%;
  accent-color: var(--ac);
  cursor: pointer;
}

.range-field__marks {
  display: flex;
  justify-content: space-between;
  font-size: .68rem;
  color: var(--t3);
  margin-top: 1px;
}
</style>
