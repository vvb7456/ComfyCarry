<script setup lang="ts">
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'EmptyState' })

withDefaults(defineProps<{
  icon?: string
  title?: string
  message?: string
  density?: 'default' | 'compact'
}>(), {
  density: 'default',
})
</script>

<template>
  <div :class="['empty-state', `empty-state--${density}`]">
    <slot name="icon">
      <MsIcon v-if="icon" :name="icon" :size="density === 'compact' ? 'md' : 'xl'" class="empty-state__icon" />
    </slot>
    <div v-if="title" class="empty-state__title">{{ title }}</div>
    <div v-if="message" class="empty-state__msg">{{ message }}</div>
    <div v-if="$slots.default" class="empty-state__actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--t3);
  text-align: center;
  gap: var(--sp-2);
}

.empty-state--default { padding: var(--sp-8) var(--sp-4); }
.empty-state--compact { padding: var(--sp-2) 0; }

.empty-state__icon { opacity: .45; }
.empty-state--default .empty-state__icon { margin-bottom: var(--sp-1); }

.empty-state__title { font-size: var(--text-md); font-weight: 500; color: var(--t2); }
.empty-state--compact .empty-state__title { font-size: var(--text-sm); font-weight: 400; color: var(--t3); }

.empty-state__msg { font-size: var(--text-sm); max-width: 420px; }
.empty-state--compact .empty-state__msg { font-size: var(--text-xs); }

.empty-state__actions { margin-top: var(--sp-2); display: flex; gap: var(--sp-2); }
</style>
