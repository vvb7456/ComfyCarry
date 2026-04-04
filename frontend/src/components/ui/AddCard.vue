<script setup lang="ts">
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'AddCard' })

const props = withDefaults(defineProps<{
  label?: string
  size?: 'compact' | 'default'
  disabled?: boolean
  stretch?: boolean
  fill?: boolean
}>(), {
  size: 'default',
  disabled: false,
  stretch: true,
  fill: true,
})

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

function onClick(event: MouseEvent) {
  if (props.disabled) return
  emit('click', event)
}
</script>

<template>
  <button
    type="button"
    class="add-card"
    :class="[
      `add-card--${props.size}`,
      {
        'add-card--fill': props.fill,
        'add-card--stretch': props.stretch,
        'add-card--disabled': props.disabled,
      },
    ]"
    :disabled="props.disabled"
    @click="onClick"
  >
    <slot name="icon">
      <span class="add-card__icon" aria-hidden="true">
        <MsIcon name="add" size="sm" color="none" />
      </span>
    </slot>
    <span class="add-card__label">
      <slot>{{ props.label }}</slot>
    </span>
  </button>
</template>

<style scoped>
.add-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  appearance: none;
  -webkit-appearance: none;
  padding: 14px 16px;
  min-height: 80px;
  border: 1px dashed color-mix(in srgb, var(--bd) 82%, var(--t3));
  border-radius: var(--r);
  background: color-mix(in srgb, var(--bg3) 68%, transparent);
  color: var(--t3);
  font: inherit;
  font-size: .85rem;
  line-height: 1.35;
  text-align: center;
  cursor: pointer;
  transition: border-color .18s ease, color .18s ease, background .18s ease;
}

.add-card--fill {
  width: 100%;
}

.add-card--compact {
  padding: 10px 14px;
  min-height: 56px;
}

.add-card--stretch {
  align-self: stretch;
  height: 100%;
}

.add-card:hover:not(.add-card--disabled) {
  border-color: color-mix(in srgb, var(--ac) 58%, var(--bd));
  color: color-mix(in srgb, var(--ac) 88%, var(--t2));
  background: color-mix(in srgb, var(--ac) 5%, transparent);
}

.add-card--disabled {
  opacity: .55;
  cursor: not-allowed;
}

.add-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  flex-shrink: 0;
}

.add-card__label {
  min-width: 0;
}
</style>
