<script setup lang="ts">
import BaseCard from '@/components/ui/BaseCard.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'OptionCard' })

const props = withDefaults(defineProps<{
  selected?: boolean
  disabled?: boolean
  locked?: boolean
  title?: string
  description?: string
  icon?: string
  iconColor?: string
}>(), {
  selected: false,
  disabled: false,
  locked: false,
})

const emit = defineEmits<{
  toggle: []
}>()

function onClick() {
  if (props.disabled || props.locked) return
  emit('toggle')
}
</script>

<template>
  <BaseCard
    density="roomy"
    class="option-card"
    :class="{
      'option-card--selected': selected || locked,
      'option-card--disabled': disabled,
      'option-card--locked': locked,
    }"
    :interactive="false"
    @click="onClick"
  >
    <!-- checkmark indicator -->
    <span
      v-if="selected || locked"
      class="option-card__check"
      :class="{ 'option-card__check--locked': locked }"
    >
      <span class="ms" style="font-size: 14px;">check</span>
    </span>

    <div v-if="icon || title || $slots.title" class="option-card__header">
      <MsIcon v-if="icon" :name="icon" size="sm" :style="iconColor ? { color: iconColor } : undefined" />
      <span class="option-card__title">
        <slot name="title">{{ title }}</slot>
      </span>
      <span v-if="$slots.badge" class="option-card__badge">
        <slot name="badge" />
      </span>
    </div>

    <p v-if="description || $slots.description" class="option-card__desc">
      <slot name="description">{{ description }}</slot>
    </p>

    <div v-if="$slots.default" class="option-card__body">
      <slot />
    </div>
  </BaseCard>
</template>

<style scoped>
.option-card {
  position: relative;
  border: 2px solid transparent;
  transition: border-color .2s;
  cursor: pointer;
}

.option-card:hover:not(.option-card--disabled):not(.option-card--locked) {
  border-color: var(--bd-f);
}

.option-card--selected {
  border-color: var(--ac);
  background: color-mix(in srgb, var(--ac) 8%, var(--bg3));
}

.option-card--disabled {
  opacity: .5;
  cursor: not-allowed;
}

.option-card--locked {
  cursor: default;
}

.option-card__check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--ac);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.option-card__check--locked {
  background: var(--t3);
}

.option-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.option-card__title {
  font-weight: 700;
  font-size: .95rem;
}

.option-card__badge {
  margin-left: auto;
}

.option-card__desc {
  font-size: .8rem;
  color: var(--t2);
  margin: 0;
  line-height: 1.5;
}

.option-card__body {
  margin-top: 8px;
}
</style>
