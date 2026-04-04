<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'StatusDot' })

type DotStatus =
  | 'running'
  | 'stopped'
  | 'loading'
  | 'error'
  | 'online'
  | 'offline'
  | 'pending'
  | 'connecting'
  | 'starting'
  | 'busy'
  | 'enabled'
  | 'disabled'
  | 'success'
  | 'failed'
  | 'errored'
  | 'idle'

const props = defineProps<{
  status: DotStatus
  size?: 'sm' | 'md'
}>()

const normalizedStatus = computed(() => {
  if (['running', 'online', 'enabled', 'success'].includes(props.status)) return 'running'
  if (['loading', 'pending', 'connecting', 'starting', 'busy'].includes(props.status)) return 'loading'
  if (['error', 'failed', 'errored'].includes(props.status)) return 'error'
  return 'stopped'
})

const colorMap: Record<string, string> = {
  running: 'var(--green)',
  stopped: 'var(--t3)',
  loading: 'var(--amber)',
  error: 'var(--red)',
}
</script>

<template>
  <span
    class="status-dot"
    :class="size === 'sm' ? 'status-dot--sm' : ''"
    :style="{ background: colorMap[normalizedStatus] || 'var(--t3)' }"
  />
</template>

<style scoped>
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot--sm {
  width: 6px;
  height: 6px;
}
</style>
