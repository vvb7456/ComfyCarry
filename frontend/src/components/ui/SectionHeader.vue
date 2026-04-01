<script setup lang="ts">
import MsIcon from './MsIcon.vue'

defineProps<{
  icon?: string
  flush?: boolean
}>()
</script>

<template>
  <div class="section-header" :class="{ 'section-header--flush': flush }">
    <div class="section-title">
      <MsIcon v-if="icon" :name="icon" />
      <slot />
    </div>
    <div v-if="$slots.actions" class="section-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  margin-bottom: 12px;
}

.section-header--flush {
  margin-top: 0;
}

.section-title {
  font-size: .95rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title :deep(.ms) {
  font-size: 22px;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 22;
}

.section-header__actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  align-items: center;
}
</style>
