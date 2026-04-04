<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'ProgressBar' })

const props = defineProps<{
  value: number       // current value (e.g. step number)
  max: number         // max value
  executed?: number   // executed nodes
  total?: number      // total nodes
  label?: string      // optional override label
}>()

const pct = computed(() => props.max > 0 ? Math.min(100, (props.value / props.max) * 100) : 0)
const displayLabel = computed(() => {
  if (props.label) return props.label
  if (props.total) return `${props.executed ?? 0} / ${props.total}`
  return `${props.value} / ${props.max}`
})
</script>

<template>
  <div class="progress-bar">
    <div class="progress-bar__track">
      <div
        class="progress-bar__fill"
        :style="{ width: pct + '%' }"
      />
    </div>
    <span class="progress-bar__label">{{ displayLabel }}</span>
  </div>
</template>

<style scoped>
.progress-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.progress-bar__track {
  flex: 1;
  height: 5px;
  background: var(--bg4);
  border-radius: 99px;
  overflow: hidden;
}
.progress-bar__fill {
  height: 100%;
  background: var(--ac);
  border-radius: 99px;
  transition: width .3s ease;
}
.progress-bar__label {
  font-size: var(--text-xs);
  color: var(--t3);
  white-space: nowrap;
  font-family: var(--mono, monospace);
}
</style>
