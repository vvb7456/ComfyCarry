<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLogStream } from '@/composables/useLogStream'
import { useSystemStats } from '@/composables/useSystemStats'
import type { ExecState } from '@/composables/useExecTracker'
import LogPanel from '@/components/ui/LogPanel.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import StatCard from '@/components/ui/StatCard.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import Spinner from '@/components/ui/Spinner.vue'
import type { ComfyStatus } from '@/types/comfyui'

defineOptions({ name: 'ConsoleTab' })

const props = defineProps<{
  status: ComfyStatus | null
  execState: ExecState | null
  elapsed: number
}>()

const { t } = useI18n({ useScope: 'global' })

// Real-time system metrics (shared singleton, 3s poll)
const { stats: sysStats } = useSystemStats()

// Card status
const comfyCardStatus = computed<'info' | 'running' | 'stopped' | 'loading' | 'error'>(() => {
  if (!props.status) return 'info'
  if (props.status.online) return props.execState ? 'loading' : 'running'
  if (props.status.pm2_status === 'errored') return 'error'
  if (props.status.pm2_status === 'online') return 'info'
  return 'stopped'
})

// Log stream
const logStream = useLogStream({
  historyUrl: '/api/logs/comfy?lines=200',
  streamUrl: '/api/comfyui/logs/stream',
  classify(line) {
    if (/error|exception|traceback/i.test(line)) return 'log-error'
    if (/warn/i.test(line)) return 'log-warn'
    if (/loaded|model|checkpoint|lora/i.test(line)) return 'log-info'
    return ''
  },
})

onMounted(() => { logStream.start() })
onUnmounted(() => { logStream.stop() })

// Formatters
function fmtUptime(pm2Uptime: number) {
  if (!pm2Uptime) return ''
  const up = Date.now() - pm2Uptime
  const h = Math.floor(up / 3600000)
  const m = Math.floor((up % 3600000) / 60000)
  return `${h}h ${m}m`
}
</script>

<template>
  <!-- Status cards -->
  <div class="stat-grid-wrap">
    <div v-if="!status || !sysStats" class="stat-grid-loading">
      <Spinner size="md" />
    </div>
    <div v-else class="stat-grid">
      <StatCard label="ComfyUI" :status="comfyCardStatus" value-size="sm">
        <template #value>{{ status.online ? (execState ? t('comfyui.status.generating') : t('comfyui.status.idle')) : t('comfyui.status.stopped') }}</template>
        <template #sub v-if="status.online">
          v{{ status.system?.comfyui_version || '?' }} · Python {{ status.system?.python_version || '?' }} · PyTorch {{ status.system?.pytorch_version || '?' }}
        </template>
        <template #sub v-else>PM2: {{ status.pm2_status }}</template>
      </StatCard>

      <StatCard v-for="(gpu, i) in sysStats.gpu" :key="i" :label="gpu.name || 'GPU'">
        <template #value>{{ gpu.util }}%</template>
        <template #sub>
          VRAM: {{ gpu.mem_used }}MB / {{ gpu.mem_total }}MB
          <template v-if="gpu.temp"> · {{ gpu.temp }}°C</template>
          <template v-if="gpu.power"> · {{ Math.round(gpu.power) }}W</template>
        </template>
        <UsageBar :percent="gpu.mem_total > 0 ? (gpu.mem_used / gpu.mem_total * 100) : 0" />
      </StatCard>

      <StatCard v-if="status.pm2_uptime" :label="t('comfyui.console.uptime')" value-size="sm">
        <template #value>{{ fmtUptime(status.pm2_uptime) }}</template>
        <template #sub>{{ t('comfyui.console.restart_count', { count: status.pm2_restarts || 0 }) }}</template>
      </StatCard>
    </div>
  </div>

  <!-- Exec progress bar -->
  <ComfyProgressBar :state="execState" :elapsed="elapsed" />

  <!-- Log -->
  <SectionHeader icon="receipt_long">{{ t('comfyui.console.log_title') }}</SectionHeader>
  <LogPanel :lines="logStream.lines.value" :status="logStream.status.value" />
</template>

<style scoped>
.stat-grid-wrap {
  min-height: 110px;
  margin-bottom: clamp(24px, 2vw, 36px);
}
.stat-grid-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 110px;
}
</style>
