<script setup lang="ts">
</script>

<template>
  <div class="field-row">
    <slot />
  </div>
</template>

<style scoped>
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* First child (usually an input) takes remaining space */
.field-row > :first-child {
  flex: 1;
  min-width: 0;
}
/* Buttons and icons don't shrink */
.field-row > :not(:first-child) {
  flex-shrink: 0;
}
</style>
