<script setup lang="ts">
import { computed } from 'vue'
import StatusDot from '@/components/ui/StatusDot.vue'

defineOptions({ name: 'HeaderStatusBadge' })

const props = defineProps<{
  running: boolean
  runningLabel: string
  stoppedLabel: string
}>()

const text = computed(() => (props.running ? props.runningLabel : props.stoppedLabel))
const tone = computed(() => (props.running ? 'running' : 'stopped'))
const color = computed(() => (props.running ? 'var(--green)' : 'var(--t3)'))
</script>

<template>
  <span class="header-status-badge" :style="{ color }">
    <StatusDot :status="tone" size="sm" />
    <span class="header-status-badge__text">{{ text }}</span>
  </span>
</template>

<style scoped>
.header-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: .78rem;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: var(--rs);
  background: var(--bg3);
  border: 1px solid var(--bd);
  line-height: 1;
  flex-shrink: 0;
}

.header-status-badge__text {
  display: inline-flex;
  align-items: center;
  min-height: 1em;
}
</style>
