<script setup lang="ts">
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'SectionHeader' })

defineProps<{
  icon?: string
  flush?: boolean
  align?: 'left' | 'center'
  withLines?: boolean
}>()
</script>

<template>
  <div
    class="section-header"
    :class="[
      { 'section-header--flush': flush, 'section-header--with-lines': withLines },
      `section-header--align-${align ?? 'left'}`,
    ]"
  >
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

.section-header--align-center {
  justify-content: center;
  text-align: center;
}

.section-header--align-center.section-header--with-lines {
  position: relative;
  gap: var(--sp-4);
}

.section-header--align-center.section-header--with-lines::before,
.section-header--align-center.section-header--with-lines::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--bd);
  max-width: 240px;
}

.section-header--align-center .section-title {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--t1);
}

.section-header--align-center .section-title :deep(.ms) {
  font-size: 26px;
}

.section-header--align-center .section-header__actions {
  margin-left: 0;
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
