<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'UsageBar' })

const props = withDefaults(defineProps<{
  percent: number
  baseColor?: string
  warning?: number
  danger?: number
}>(), {
  baseColor: 'var(--green)',
  warning: 70,
  danger: 90,
})

const clampedPercent = computed(() => {
  const value = Number.isFinite(props.percent) ? props.percent : 0
  return Math.max(0, Math.min(100, value))
})

const fillColor = computed(() => {
  if (clampedPercent.value >= props.danger) return 'var(--red)'
  if (clampedPercent.value >= props.warning) return 'var(--amber)'
  return props.baseColor
})
</script>

<template>
  <div class="usage-bar" :aria-valuenow="Math.round(clampedPercent)" aria-valuemin="0" aria-valuemax="100" role="progressbar">
    <div class="usage-bar-fill" :style="{ width: clampedPercent + '%', background: fillColor }"></div>
  </div>
</template>

<style scoped>
.usage-bar {
  height: 6px;
  background: var(--bg);
  border-radius: 3px;
  overflow: hidden;
}

.usage-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width .5s ease, background-color .2s ease;
}
</style>
