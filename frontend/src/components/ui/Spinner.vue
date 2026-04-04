<script setup lang="ts">

defineOptions({ name: 'Spinner' })

defineProps<{
  size?: 'sm' | 'md' | 'lg'
}>()
</script>

<template>
  <span class="spinner" :class="`spinner--${size ?? 'md'}`" />
</template>

<style scoped>
.spinner {
  display: inline-block;
  border-radius: 50%;
  border-style: solid;
  border-color: var(--ac) transparent transparent transparent;
  animation: spin .8s linear infinite;
}
.spinner--sm  { width: 16px; height: 16px; border-width: 2px; }
.spinner--md  { width: 24px; height: 24px; border-width: 3px; }
.spinner--lg  { width: 36px; height: 36px; border-width: 4px; }

@keyframes spin { to { transform: rotate(360deg); } }
</style>
