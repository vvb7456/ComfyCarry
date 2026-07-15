<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'UsageBar' })

const props = withDefaults(defineProps<{
  percent: number
  baseColor?: string
  warning?: number
  danger?: number
  height?: number
}>(), {
  baseColor: 'var(--green)',
  warning: 70,
  danger: 90,
  height: 6,
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

const barStyle = computed(() => ({
  height: `${props.height}px`,
  borderRadius: `${Math.min(props.height / 2, 6)}px`,
}))
</script>

<template>
  <div
    class="usage-bar"
    :style="barStyle"
    :aria-valuenow="Math.round(clampedPercent)"
    aria-valuemin="0"
    aria-valuemax="100"
    role="progressbar"
  >
    <div
      class="usage-bar-fill"
      :style="{ width: clampedPercent + '%', background: fillColor, borderRadius: barStyle.borderRadius }"
    ></div>
  </div>
</template>

<style scoped>
.usage-bar {
  background: var(--bg);
  overflow: hidden;
}

.usage-bar-fill {
  height: 100%;
  transition: width .5s ease, background-color .2s ease;
}
</style>
