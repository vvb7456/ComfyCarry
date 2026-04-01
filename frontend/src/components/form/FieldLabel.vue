<script setup lang="ts">
defineProps<{
  /** Whether the field is required (shows asterisk) */
  required?: boolean
}>()
</script>

<template>
  <div class="field-label">
    <span class="field-label__text">
      <slot />
      <span v-if="required" class="field-label__req">*</span>
    </span>
    <span v-if="$slots.right" class="field-label__right">
      <slot name="right" />
    </span>
  </div>
</template>

<style scoped>
.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--label-font, .82rem);
  font-weight: 500;
  color: var(--t2);
  line-height: 1.35;
}

.field-label__text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.field-label__req {
  color: var(--red);
  font-weight: 600;
}

.field-label__right {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: .85rem;
  font-weight: 600;
  color: var(--ac);
}
</style>
