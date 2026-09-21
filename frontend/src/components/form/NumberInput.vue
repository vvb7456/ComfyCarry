<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'NumberInput', inheritAttrs: false })

const { t } = useI18n({ useScope: 'global' })

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

const rootStyle = computed(() => {
  const maxLen = Math.max(
    String(props.min ?? 0).length,
    String(props.max ?? props.modelValue).length,
  )
  const padRight = props.spinners ? 28 : 12
  return { minWidth: `calc(${maxLen}ch + ${12 + padRight + 2}px)` }
})

function countDecimals(n: number): number {
  const s = String(n)
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

function validate(v: number): number {
  const base = props.min ?? 0
  v = Math.round((v - base) / props.step) * props.step + base
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
      v-bind="$attrs"
      type="number"
      class="form-number number-input__field"
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
      <button
        type="button"
        class="number-input__btn"
        :aria-label="t('common.btn.increase')"
        :title="t('common.btn.increase')"
        @click="increment"
      >
        <MsIcon name="expand_less" size="xxs" color="none" />
      </button>
      <button
        type="button"
        class="number-input__btn"
        :aria-label="t('common.btn.decrease')"
        :title="t('common.btn.decrease')"
        @click="decrement"
      >
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

.number-input--has-spinners .number-input__field {
  padding-right: 28px;
}

.number-input__field--center {
  text-align: center;
}

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
