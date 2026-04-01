<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  title?: string
  count?: number
  icon?: string
  suffix?: string
  defaultOpen?: boolean
}>(), {
  defaultOpen: true,
})

const expanded = ref(props.defaultOpen)

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <div class="collapsible-group">
    <div class="collapsible-group__header" @click="toggle">
      <span class="ms collapsible-group__arrow" :class="{ 'collapsible-group__arrow--collapsed': !expanded }">expand_more</span>
      <slot name="header" :expanded="expanded">
        <span v-if="icon" class="ms ms-xs collapsible-group__icon">{{ icon }}</span>
        <span class="collapsible-group__title">{{ title }}</span>
        <span v-if="count != null" class="collapsible-group__count">{{ count }}</span>
        <span v-if="suffix" class="collapsible-group__suffix">{{ suffix }}</span>
      </slot>
      <span class="collapsible-group__right">
        <slot name="title-right" />
      </span>
    </div>
    <div v-show="expanded" class="collapsible-group__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.collapsible-group__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
  font-size: var(--text-base);
  font-weight: 500;
}

.collapsible-group__arrow {
  font-size: 16px;
  transition: transform .2s;
}

.collapsible-group__arrow--collapsed {
  transform: rotate(-90deg);
}

.collapsible-group__icon {
  color: var(--t2);
}

.collapsible-group__title {
  color: var(--t1);
}

.collapsible-group__count {
  font-size: var(--text-sm);
  color: var(--t3);
  font-weight: 400;
}

.collapsible-group__suffix {
  font-size: .72rem;
  color: var(--t3);
  font-weight: 400;
}

.collapsible-group__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.collapsible-group__body {
  padding-top: 2px;
}
</style>
