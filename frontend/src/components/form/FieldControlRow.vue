<script setup lang="ts">

defineOptions({ name: 'FieldControlRow' })

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
.field-row > :first-child {
  flex: 1;
  min-width: 0;
}
.field-row > :not(:first-child) {
  flex-shrink: 0;
}
</style>
