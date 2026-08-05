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

defineOptions({ name: 'ConsoleSection' })

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

const queueTotal = computed(() => (props.status?.queue_running || 0) + (props.status?.queue_pending || 0))

// Log stream
const { lines: logLines, status: logStatus, hasMore: logHasMore, loadingMore: logLoadingMore, prepending: logPrepending, onScroll: logOnScroll, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/logs/comfy',
  streamUrl: '/api/logs/comfy/stream',
  classify(line) {
    if (/error|exception|traceback/i.test(line)) return 'log-error'
    if (/warn/i.test(line)) return 'log-warn'
    if (/loaded|model|checkpoint|lora/i.test(line)) return 'log-info'
    return ''
  },
})

onMounted(() => { logStart() })
onUnmounted(() => { logStop() })

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
      <StatCard :label="t('comfyui.overview.runtime')" :status="comfyCardStatus" value-size="sm">
        <template #value>{{ status.online ? (execState ? t('comfyui.status.generating') : t('comfyui.status.idle')) : t('comfyui.status.stopped') }}</template>
        <template #sub v-if="status.online">
          {{ t('comfyui.overview.uptime_summary', { uptime: fmtUptime(status.pm2_uptime), count: status.pm2_restarts || 0 }) }}
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

      <StatCard :label="t('comfyui.overview.queue')" :status="queueTotal > 0 ? 'loading' : 'info'" value-size="sm">
        <template #value>{{ queueTotal > 0 ? queueTotal : t('comfyui.overview.queue_idle') }}</template>
        <template #sub>{{ t('comfyui.overview.queue_summary', { running: status.queue_running || 0, pending: status.queue_pending || 0 }) }}</template>
      </StatCard>

      <StatCard :label="t('comfyui.overview.environment')" value-size="sm">
        <template #value>ComfyUI {{ status.system?.comfyui_version || '?' }}</template>
        <template #sub>Python {{ status.system?.python_version || '?' }} · PyTorch {{ status.system?.pytorch_version || '?' }}</template>
      </StatCard>
    </div>
  </div>

  <!-- 只有确有当前任务时才占据页面空间；空闲状态已由运行卡片表达。 -->
  <div v-if="execState" class="execution-block">
    <SectionHeader icon="bolt" flush>{{ t('comfyui.overview.current_execution') }}</SectionHeader>
    <ComfyProgressBar :state="execState" :elapsed="elapsed" />
  </div>

  <!-- Log -->
  <SectionHeader icon="receipt_long">{{ t('comfyui.console.log_title') }}</SectionHeader>
  <LogPanel :lines="logLines" :status="logStatus" :has-more="logHasMore" :loading-more="logLoadingMore" :prepending="logPrepending" :on-scroll="logOnScroll" height="clamp(18rem, 42vh, 32rem)" />
</template>

<style scoped>
.stat-grid-wrap {
  min-height: 7rem;
  margin-bottom: clamp(1rem, 1.5vw, 1.5rem);
}
.stat-grid-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 7rem;
}

.execution-block {
  margin-bottom: var(--sp-5);
}
</style>
