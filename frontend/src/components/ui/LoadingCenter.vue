<script setup lang="ts">
import Spinner from './Spinner.vue'

defineOptions({ name: 'LoadingCenter' })
defineProps<{
  size?: 'sm' | 'md' | 'lg'
}>()
</script>

<template>
  <div class="loading-center">
    <Spinner :size="size" />
    <div v-if="$slots.default" class="loading-center-text">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.loading-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--t2);
}

.loading-center-text {
  font-size: var(--text-sm);
}
</style>
