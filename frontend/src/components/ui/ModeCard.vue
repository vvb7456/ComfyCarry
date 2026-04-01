<script setup lang="ts">
import BaseCard from '@/components/ui/BaseCard.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

const props = withDefaults(defineProps<{
  icon?: string
  iconColor?: string
  title?: string
  description?: string
  selected?: boolean
  active?: boolean
  activeLabel?: string
  clickable?: boolean
  disabled?: boolean
}>(), {
  icon: '',
  iconColor: '',
  title: '',
  description: '',
  selected: false,
  active: false,
  activeLabel: '',
  clickable: true,
  disabled: false,
})

const emit = defineEmits<{
  click: []
}>()

function onClick() {
  if (props.disabled || !props.clickable) return
  emit('click')
}
</script>

<template>
  <BaseCard
    density="roomy"
    class="mode-card"
    :class="{
      selected: props.selected && !props.disabled,
      active: props.active,
      'mode-card--clickable': props.clickable && !props.disabled,
      'mode-card--disabled': props.disabled,
    }"
    :interactive="false"
    @click="onClick"
  >
    <div class="mode-card-header">
      <MsIcon v-if="props.icon" :name="props.icon" size="md" :style="props.iconColor ? { color: props.iconColor } : undefined" />
      <span class="mode-title">
        <slot name="title">{{ props.title }}</slot>
      </span>
      <span v-if="props.active && props.activeLabel" class="mode-badge">{{ props.activeLabel }}</span>
    </div>
    <p v-if="props.description || $slots.description" class="mode-desc">
      <slot name="description">{{ props.description }}</slot>
    </p>
    <div v-if="$slots.default" class="mode-meta">
      <slot />
    </div>
  </BaseCard>
</template>

<style scoped>
.mode-card {
  border: 2px solid transparent;
  transition: border-color .2s;
}

.mode-card--clickable {
  cursor: pointer;
}

.mode-card--clickable:hover {
  border-color: var(--bd-f);
}

.mode-card--disabled {
  opacity: .5;
  cursor: not-allowed;
  pointer-events: none;
}

.mode-card.selected {
  border-color: var(--ac);
}

.mode-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.mode-title {
  font-weight: 700;
  font-size: var(--mode-title-size, 1rem);
}

.mode-badge {
  font-size: .65rem;
  background: color-mix(in srgb, var(--green) 18%, transparent);
  color: var(--green);
  border: 1px solid color-mix(in srgb, var(--green) 42%, transparent);
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 600;
}

.mode-desc {
  font-size: var(--mode-desc-size, .82rem);
  color: var(--t3);
  margin: 0 0 8px 0;
  line-height: 1.5;
}

.mode-meta {
  font-size: .75rem;
  color: var(--t3);
}
</style>
