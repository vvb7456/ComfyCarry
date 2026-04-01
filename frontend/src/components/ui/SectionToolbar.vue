<script setup lang="ts">
defineOptions({ name: 'SectionToolbar' })
</script>

<template>
  <div class="section-toolbar">
    <div v-if="$slots.start" class="section-toolbar-start">
      <slot name="start" />
    </div>
    <div v-if="$slots.end" class="section-toolbar-end">
      <slot name="end" />
    </div>
  </div>
</template>

<style scoped>
.section-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.section-toolbar-start {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  flex-wrap: wrap;
  min-width: 0;
}

.section-toolbar-end {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.section-toolbar-end {
  margin-left: auto;
}

@media (max-width: 720px) {
  .section-toolbar-start,
  .section-toolbar-end {
    width: 100%;
  }

  .section-toolbar-end {
    margin-left: 0;
    justify-content: flex-start;
  }
}

/* Utility: toolbar status text — apply class="toolbar-status" to slot content */
:slotted(.toolbar-status) {
  font-size: var(--text-sm);
  color: var(--t2);
  white-space: nowrap;
}
</style>
