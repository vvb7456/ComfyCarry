<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLogStream } from '@/composables/useLogStream'
import type { ExecState } from '@/composables/useExecTracker'
import LogPanel from '@/components/ui/LogPanel.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import StatCard from '@/components/ui/StatCard.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import type { ComfyStatus } from '@/types/comfyui'

defineOptions({ name: 'ConsoleTab' })

const props = defineProps<{
  status: ComfyStatus | null
  execState: ExecState | null
  elapsed: number
}>()

const { t } = useI18n({ useScope: 'global' })

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
function fmtBytes(b: number) {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i]
}

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
  <div class="stat-grid" v-if="status">
    <StatCard label="ComfyUI" :status="comfyCardStatus" value-size="sm">
      <template #value>{{ status.online ? (execState ? t('comfyui.status.generating') : t('comfyui.status.idle')) : t('comfyui.status.stopped') }}</template>
      <template #sub v-if="status.online">
        v{{ status.system?.comfyui_version || '?' }} · Python {{ status.system?.python_version || '?' }} · PyTorch {{ status.system?.pytorch_version || '?' }}
      </template>
      <template #sub v-else>PM2: {{ status.pm2_status }}</template>
    </StatCard>

    <StatCard v-for="(dev, i) in status.devices" :key="i" :label="dev.name || 'GPU'">
      <template #value>{{ dev.vram_total > 0 ? (((dev.vram_total - dev.vram_free) / dev.vram_total) * 100).toFixed(0) + '%' : '—' }}</template>
      <template #sub>
        VRAM: {{ fmtBytes(dev.vram_total - dev.vram_free) }} / {{ fmtBytes(dev.vram_total) }} · Torch: {{ fmtBytes(dev.torch_vram_total - dev.torch_vram_free) }}
      </template>
      <UsageBar :percent="dev.vram_total > 0 ? ((dev.vram_total - dev.vram_free) / dev.vram_total * 100) : 0" />
    </StatCard>

    <StatCard v-if="status.pm2_uptime" :label="t('comfyui.console.uptime')" value-size="sm">
      <template #value>{{ fmtUptime(status.pm2_uptime) }}</template>
      <template #sub>{{ t('comfyui.console.restart_count', { count: status.pm2_restarts || 0 }) }}</template>
    </StatCard>
  </div>

  <!-- Exec progress bar -->
  <ComfyProgressBar :state="execState" :elapsed="elapsed" />

  <!-- Log -->
  <SectionHeader icon="receipt_long">{{ t('comfyui.console.log_title') }}</SectionHeader>
  <LogPanel :lines="logStream.lines.value" :status="logStream.status.value" />
</template>
