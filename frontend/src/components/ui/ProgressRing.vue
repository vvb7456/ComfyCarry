<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'ProgressRing' })

const props = withDefaults(defineProps<{
  progress: number
  size?: number
  strokeWidth?: number
}>(), {
  size: 16,
  strokeWidth: 2,
})

const radius = computed(() => (props.size - props.strokeWidth) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const clamped = computed(() => Math.min(Math.max(props.progress || 0, 0), 100))
const dashOffset = computed(() => circumference.value * (1 - clamped.value / 100))
const centered = computed(() => props.size / 2)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="`0 0 ${size} ${size}`"
    class="progress-ring"
    :class="{ 'progress-ring--pulse': clamped >= 100 }"
  >
    <circle
      class="progress-ring__track"
      :cx="centered"
      :cy="centered"
      :r="radius"
      :stroke-width="strokeWidth"
      fill="none"
    />
    <circle
      class="progress-ring__fill"
      :cx="centered"
      :cy="centered"
      :r="radius"
      :stroke-width="strokeWidth"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="dashOffset"
      fill="none"
      stroke-linecap="round"
      :transform="`rotate(-90 ${centered} ${centered})`"
    />
  </svg>
</template>

<style scoped>
.progress-ring {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
.progress-ring__track {
  stroke: var(--bd);
}
.progress-ring__fill {
  stroke: var(--ac);
  transition: stroke-dashoffset .3s ease;
}
.progress-ring--pulse {
  animation: pr-pulse 1.2s ease-in-out infinite;
}
@keyframes pr-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}
</style>
