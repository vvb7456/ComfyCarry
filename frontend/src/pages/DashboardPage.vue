<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useToast } from '@/composables/useToast'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import StatusDot from '@/components/ui/StatusDot.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import type { OverviewData, SyncLogEntry, ServiceEntry } from '@/types/dashboard'

defineOptions({ name: 'DashboardPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()


const data = ref<OverviewData | null>(null)
const loading = ref(true)

// Exec tracker for real-time progress
const tracker = useExecTracker()
const sseActive = ref(false)
const sse = useComfySSE(tracker, {
  onEvent(evt) {
    if (evt.type === 'status') loadOverview()
  }
})

async function loadOverview() {
  const d = await get<OverviewData>('/api/overview')
  if (d) {
    data.value = d
    loading.value = false
  }
}

const refresh = useAutoRefresh(loadOverview, 5000)

onMounted(async () => {
  await loadOverview()
  refresh.start({ immediate: false })
  sse.start()
})

onUnmounted(() => {
  refresh.stop()
  sse.stop()
})

// Helpers
function fmtBytes(b: number) {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i]
}

// GPU memory from overview API is already in MiB (nvidia-smi --nounits)
function fmtMB(mb: number) {
  if (!mb) return '0 MiB'
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GiB'
  return mb.toFixed(0) + ' MiB'
}

// Services from overview: memory is bytes, cpu is %, uptime is ms timestamp
function fmtSvcMem(bytes: number | string) {
  if (bytes === '-' || bytes === undefined || bytes === null) return '-'
  const n = Number(bytes)
  if (!n) return '0'
  return fmtBytes(n)
}

function fmtSvcCpu(cpu: number | string) {
  if (cpu === '-' || cpu === undefined || cpu === null) return '-'
  return Number(cpu).toFixed(1) + '%'
}

function fmtSvcUptime(uptime: number | string) {
  if (uptime === '-' || !uptime) return '-'
  const ms = Number(uptime)
  if (!ms) return '-'
  // uptime from pm2 is a timestamp (ms since start), convert to duration
  const secs = Math.floor((Date.now() - ms) / 1000)
  if (secs < 0) return '-'
  if (secs < 60) return secs + 's'
  if (secs < 3600) return Math.floor(secs / 60) + 'm'
  if (secs < 86400) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    return m > 0 ? h + 'h' + m + 'm' : h + 'h'
  }
  return Math.floor(secs / 86400) + 'd'
}

function fmtPct(n: number | undefined) {
  return (n ?? 0).toFixed(1) + '%'
}

// Tunnel URLs for status bar links
const tunnelUrls = computed(() => {
  const t = data.value?.tunnel
  if (!t) return {} as Record<string, string>
  const all = { ...(t.urls || {}) }
  if (t.public?.urls) Object.assign(all, t.public.urls)
  // exclude internal services
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => !['comfycarry', 'ssh', 'dashboard'].includes(k.toLowerCase()))
  )
})

const comfyUrl = computed(() => tunnelUrls.value['comfyui'] || tunnelUrls.value['ComfyUI'] || '')
const jupyterUrl = computed(() => tunnelUrls.value['jupyter'] || tunnelUrls.value['JupyterLab'] || '')

// Services ordered display
const svcOrder = ['comfy', 'cf-tunnel', 'jupyter', 'sync-worker', 'dashboard']
const orderedServices = computed(() => {
  // API returns { services: [...] } not [...] directly
  const raw = data.value?.services as ServiceEntry[] | { services?: ServiceEntry[] } | undefined
  const svcs: ServiceEntry[] = Array.isArray(raw) ? raw : (raw?.services || [])
  const map = Object.fromEntries(svcs.map((s) => [s.name, s]))
  const result = svcOrder.map(n => map[n]).filter(Boolean)
  // Add any not in order list
  svcs.forEach((s) => { if (!svcOrder.includes(s.name)) result.push(s) })
  // Virtual sync-worker row from sync data if not in PM2 list
  if (!map['sync-worker'] && data.value?.sync) {
    const syncOn = data.value.sync.worker_running
    result.splice(3, 0, {
      name: 'sync-worker',
      status: syncOn ? 'online' : 'stopped',
      uptime: '-',
      cpu: '-',
      memory: '-',
      restarts: 0,
    })
  }
  return result
})

async function svcAction(name: string, action: string) {
  let d
  if (name === 'sync-worker') {
    d = await post(`/api/sync/worker/${action}`)
  } else {
    d = await post(`/api/services/${name}/${action}`)
  }
  if (!d) return
  toast(t('dashboard.services.action_sent', { action }), 'info')
  setTimeout(loadOverview, 2000)
}

function svcStatusColor(st: string) {
  const tone = svcStatusTone(st)
  if (tone === 'running') return 'var(--green)'
  if (tone === 'loading') return 'var(--amber)'
  if (tone === 'error') return 'var(--red)'
  return 'var(--t3)'
}

function svcStatusTone(st: string) {
  if (!st) return 'stopped'
  if (['online', 'running'].includes(st)) return 'running'
  if (['starting', 'launching', 'connecting'].includes(st)) return 'loading'
  if (['errored', 'error', 'failed'].includes(st)) return 'error'
  return 'stopped'
}

function svcStatusLabel(st: string) {
  const key = String(st || '').toLowerCase()
  if (['online', 'running'].includes(key)) return t('dashboard.status.online')
  if (['starting', 'launching', 'connecting'].includes(key)) return t('dashboard.status.starting')
  if (['errored', 'error', 'failed'].includes(key)) return t('dashboard.status.offline')
  if (['stopped', 'stop', 'offline'].includes(key)) return t('dashboard.status.offline')
  return st || '-'
}

function formatSyncActivityLog(line: string | SyncLogEntry | undefined) {
  if (!line) return ''
  if (typeof line === 'string') return line
  const key = line.key || ''
  const params = line.params || {}
  if (!key) return ''
  const i18nKey = `sync.log.${key}`
  const translated = t(i18nKey, params)
  const text = translated === i18nKey ? key : translated
  return line.ts ? `${line.ts} ${text}` : text
}

const latestSyncLogLine = computed(() => {
  const lines = data.value?.sync?.last_log_lines || []
  if (!lines.length) return ''
  return formatSyncActivityLog(lines[lines.length - 1])
})

// Exec progress for activity feed
const execState = computed(() => tracker.state.value)

// Queue badge class: red if heavy (>5), amber if busy, muted if idle
const queueBadgeClass = computed(() => {
  const d = data.value?.comfyui
  if (!d) return 'muted'
  const total = (d.queue_running || 0) + (d.queue_pending || 0)
  if (total > 5) return 'red'
  if (total > 0) return 'amber'
  return 'muted'
})

// Tunnel badge class and text
const tunnelBadgeClass = computed(() => {
  const s = data.value?.tunnel?.effective_status
  if (s === 'online') return 'green'
  if (s === 'connecting') return 'amber'
  if (s === 'offline') return 'red'
  return 'muted'
})
const tunnelStatusText = computed(() => {
  const s = data.value?.tunnel?.effective_status
  if (s === 'online') return t('dashboard.status.online')
  if (s === 'connecting') return t('dashboard.status.connecting')
  if (s === 'offline') return t('dashboard.status.offline')
  return t('dashboard.status.not_configured')
})
</script>

<template>
  <PageHeader icon="dashboard" :title="t('dashboard.title')" />

  <div class="page-body">
    <!-- Status Bar -->
    <div class="status-bar" v-if="data">
      <!-- ComfyUI -->
      <a v-if="comfyUrl && data.comfyui.online" :href="comfyUrl" target="_blank" class="status-badge green" :title="t('dashboard.status_bar.open_comfyui')">
        <MsIcon name="palette" /> ComfyUI
        <span class="badge-sub">v{{ data.comfyui.version || '?' }}</span>
        {{ t('dashboard.status.online') }}
        <MsIcon name="open_in_new" size="xs" />
      </a>
      <span v-else-if="data.comfyui.online" class="status-badge green">
        <MsIcon name="palette" /> ComfyUI
        <span class="badge-sub">v{{ data.comfyui.version || '?' }}</span>
        {{ t('dashboard.status.online') }}
      </span>
      <span v-else-if="data.comfyui.pm2_status === 'online'" class="status-badge amber">
        <MsIcon name="palette" /> ComfyUI <span class="badge-sub">{{ t('dashboard.status.starting') }}</span>
      </span>
      <span v-else class="status-badge red">
        <MsIcon name="palette" /> ComfyUI <span class="badge-sub">{{ t('dashboard.status.offline') }}</span>
      </span>

      <!-- Uptime -->
      <span v-if="data.comfyui.pm2_uptime" class="status-badge muted">
        <MsIcon name="timer" /> {{ fmtSvcUptime(data.comfyui.pm2_uptime) }}
      </span>

      <!-- Queue -->
      <span v-if="data.comfyui.online" class="status-badge" :class="queueBadgeClass">
        <MsIcon name="assignment" />
        <template v-if="data.comfyui.queue_running || data.comfyui.queue_pending">
          {{ t('dashboard.status_bar.queue_info', { running: data.comfyui.queue_running || 0, pending: data.comfyui.queue_pending || 0 }) }}
        </template>
        <template v-else>{{ t('dashboard.status.queue_idle') }}</template>
      </span>

      <!-- Tunnel -->
      <span class="status-badge" :class="tunnelBadgeClass">
        <MsIcon name="language" /> Tunnel {{ tunnelStatusText }}
      </span>

      <!-- Jupyter -->
      <a v-if="jupyterUrl && data.jupyter.online" :href="jupyterUrl" target="_blank" class="status-badge green" :title="t('dashboard.status_bar.open_jupyter')">
        <MsIcon name="book_2" /> Jupyter {{ t('dashboard.status.running') }}
        <MsIcon name="open_in_new" size="xs" />
      </a>
      <span v-else-if="data.jupyter.online" class="status-badge green">
        <MsIcon name="book_2" /> Jupyter {{ t('dashboard.status.running') }}
      </span>
      <span v-else-if="data.jupyter.pm2_status === 'stopped' || data.jupyter.pm2_status === 'errored'" class="status-badge red">
        <MsIcon name="book_2" /> Jupyter {{ t('dashboard.status.offline') }}
      </span>

      <!-- Sync -->
      <span v-if="data.sync.worker_running" class="status-badge green">
        <MsIcon name="cloud_sync" /> Sync {{ t('dashboard.status.running') }}
      </span>
      <span v-else-if="data.sync.rules_count" class="status-badge muted">
        <MsIcon name="cloud_sync" /> {{ t('dashboard.status_bar.sync_not_started') }}
      </span>
    </div>

    <!-- Metrics Section Title -->
    <SectionHeader v-if="data?.system" icon="monitoring">{{ t('dashboard.metrics.title') }}</SectionHeader>

    <!-- Metrics Grid -->
    <div class="metrics-grid" v-if="data?.system">
      <!-- GPU cards -->
      <div v-for="(gpu, i) in data.system.gpu" :key="i" class="metric-card">
        <div class="metric-header">
          <span class="metric-icon"><MsIcon name="memory" /></span>
          <span class="metric-label">{{ gpu.name || 'GPU' }}</span>
        </div>
        <div class="metric-main">
          <span class="metric-value">{{ fmtPct(gpu.util) }}</span>
          <span class="metric-unit">GPU</span>
        </div>
        <UsageBar :percent="gpu.mem_total > 0 ? ((gpu.mem_used || 0) / gpu.mem_total * 100) : 0" />
        <div class="metric-details">
          <span>VRAM {{ gpu.mem_used || 0 }}MB / {{ gpu.mem_total || 0 }}MB</span>
          <span v-if="gpu.temp" :style="{ color: gpu.temp > 85 ? 'var(--red)' : gpu.temp > 70 ? 'var(--amber)' : 'var(--t3)' }">{{ gpu.temp }}°C</span>
          <span v-if="gpu.power">{{ Math.round(gpu.power) }}W / {{ gpu.power_limit ? Math.round(gpu.power_limit) + 'W' : '-' }}</span>
        </div>
      </div>

      <!-- CPU -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-icon"><MsIcon name="developer_board" /></span>
          <span class="metric-label">CPU</span>
        </div>
        <div class="metric-main">
          <span class="metric-value">{{ fmtPct(data.system.cpu.percent) }}</span>
          <span class="metric-unit">{{ data.system.cpu.cores || '?' }} cores</span>
        </div>
        <UsageBar :percent="data.system.cpu.percent" />
        <div class="metric-details">
          <span>Load {{ data.system.cpu.load?.['1m']?.toFixed(1) ?? '?' }}</span>
        </div>
      </div>

      <!-- Memory -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-icon"><MsIcon name="memory" color="#a78bfa" /></span>
          <span class="metric-label">{{ t('dashboard.metrics.memory') }}</span>
        </div>
        <div class="metric-main">
          <span class="metric-value">{{ fmtPct(data.system.memory.percent) }}</span>
        </div>
        <UsageBar :percent="data.system.memory.percent" />
        <div class="metric-details">{{ fmtBytes(data.system.memory.used) }} / {{ fmtBytes(data.system.memory.total) }}</div>
      </div>

      <!-- Disk -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-icon"><MsIcon name="hard_drive_2" /></span>
          <span class="metric-label">{{ t('dashboard.metrics.disk') }} {{ data.system.disk.path }}</span>
        </div>
        <div class="metric-main">
          <span class="metric-value">{{ fmtPct(data.system.disk.percent) }}</span>
          <span class="metric-unit">{{ fmtBytes(data.system.disk.free) }} {{ t('dashboard.metrics.free') }}</span>
        </div>
        <UsageBar :percent="data.system.disk.percent" />
        <div class="metric-details">{{ fmtBytes(data.system.disk.used) }} / {{ fmtBytes(data.system.disk.total) }}</div>
      </div>
    </div>

    <!-- Activity Feed -->
    <SectionHeader icon="trending_up">{{ t('dashboard.sections.activity') }}</SectionHeader>
    <div class="activity-feed">
      <!-- Exec progress — always visible (idle placeholder when not executing) -->
      <div class="activity-item activity-executing">
        <div class="activity-content">
          <ComfyProgressBar :state="execState" :elapsed="tracker.elapsed.value" compact />
        </div>
      </div>

      <!-- Active downloads -->
      <div v-for="dl in (data?.downloads?.active || [])" :key="dl.filename" class="activity-item activity-download">
        <div class="activity-icon"><MsIcon name="download" /></div>
        <div class="activity-content">
          <div class="activity-text">
            <span>{{ dl.filename || dl.model_name || t('dashboard.status_bar.downloading') }}</span>
            <span class="activity-meta">{{ dl.progress }}%{{ dl.speed ? ' • ' + dl.speed : '' }}</span>
          </div>
          <div class="activity-progress">
            <div class="activity-progress-fill" :style="{ width: dl.progress + '%' }"></div>
          </div>
        </div>
      </div>
      <div v-if="data?.downloads?.queue_count" class="activity-item">
        <div class="activity-icon"><MsIcon name="queue" /></div>
        <span class="activity-text">{{ t('dashboard.status_bar.downloads_waiting', { count: data.downloads.queue_count }) }}</span>
      </div>

      <!-- Sync worker status -->
      <div v-if="data?.sync?.worker_running && data.sync.watch_rules" class="activity-item">
        <div class="activity-icon"><MsIcon name="cloud" /></div>
        <span class="activity-text">{{ t('dashboard.status_bar.sync_monitoring', { count: data.sync.watch_rules }) }}</span>
      </div>

      <!-- Sync last log line -->
      <div v-if="data?.sync?.last_log_lines?.length" class="activity-item activity-log">
        <div class="activity-icon"><MsIcon name="brush" /></div>
        <span class="activity-text activity-log-line">{{ latestSyncLogLine }}</span>
      </div>

      <!-- Empty -->
      <div v-if="!data?.downloads?.active_count && !(data?.sync?.worker_running && data?.sync?.watch_rules) && !data?.sync?.last_log_lines?.length" class="activity-empty">
        <MsIcon name="check_circle" size="md" />
        <span style="color:var(--t3);font-size:.85rem">{{ t('dashboard.status_bar.all_good') }}</span>
      </div>
    </div>

    <!-- Services Table -->
    <SectionHeader icon="dns">{{ t('dashboard.sections.services') }}</SectionHeader>
    <div class="svc-table-wrap" style="padding:0" v-if="data">
      <table class="svc-table">
        <thead>
          <tr>
            <th>{{ t('dashboard.services.name') }}</th>
            <th>{{ t('dashboard.services.status') }}</th>
            <th>{{ t('dashboard.services.uptime') }}</th>
            <th>CPU</th>
            <th>{{ t('dashboard.metrics.memory') }}</th>
            <th>{{ t('dashboard.services.restarts') }}</th>
            <th>{{ t('dashboard.services.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="svc in orderedServices" :key="svc.name">
            <td><strong>{{ svc.name }}</strong></td>
            <td>
              <StatusDot :status="svcStatusTone(svc.status)" />
              <span class="svc-status" :style="{ color: svcStatusColor(svc.status) }">{{ svcStatusLabel(svc.status) }}</span>
            </td>
            <td>{{ fmtSvcUptime(svc.uptime) }}</td>
            <td>{{ fmtSvcCpu(svc.cpu) }}</td>
            <td>{{ fmtSvcMem(svc.memory) }}</td>
            <td>{{ svc.restarts ?? '-' }}</td>
            <td>
              <div class="svc-actions">
                <template v-if="svc.status === 'online'">
                  <BaseButton variant="danger" size="sm" square :aria-label="t('dashboard.services.stop')" :title="t('dashboard.services.stop')" @click="svcAction(svc.name, 'stop')">
                    <MsIcon name="stop" />
                  </BaseButton>
                  <BaseButton size="sm" square :aria-label="t('dashboard.services.restart')" :title="t('dashboard.services.restart')" @click="svcAction(svc.name, 'restart')">
                    <MsIcon name="refresh" />
                  </BaseButton>
                </template>
                <template v-else>
                  <BaseButton variant="success" size="sm" square :aria-label="t('dashboard.services.start')" :title="t('dashboard.services.start')" @click="svcAction(svc.name, 'start')">
                    <MsIcon name="play_arrow" />
                  </BaseButton>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Environment Info -->
    <SectionHeader icon="info">{{ t('dashboard.sections.environment') }}</SectionHeader>
    <div class="env-info" v-if="data">
      <span v-if="data.comfyui?.version" class="env-tag">ComfyUI {{ data.comfyui.version }}</span>
      <span v-if="data.comfyui?.pytorch_version" class="env-tag">PyTorch {{ data.comfyui.pytorch_version }}</span>
      <span v-if="data.comfyui?.python_version" class="env-tag">Python {{ data.comfyui.python_version.split(' ')[0] }}</span>
      <span v-for="gpu in (data.system?.gpu || [])" :key="gpu.name" class="env-tag">{{ gpu.name }} {{ gpu.mem_total }}MB</span>
      <span v-if="data.system?.cpu?.cores" class="env-tag">{{ data.system.cpu.cores }} CPU cores</span>
      <span v-if="data.system?.memory?.total" class="env-tag">{{ fmtBytes(data.system.memory.total) }} RAM</span>
      <span v-if="data.version?.version" class="env-tag">ComfyCarry {{ data.version.version }}</span>
    </div>

    <!-- Loading state — shown until first data arrives -->
    <LoadingCenter v-if="loading && !data" style="padding:80px 0">
      {{ t('common.status.loading') }}
    </LoadingCenter>
  </div>
</template>

<style scoped>
/* Only Vue-unique styles — global CSS handles everything else */

/* Loading center (replaces old global .loading) */

.badge-sub { font-size: .68rem; opacity: .8; margin-left: 2px; }

/* ── Status Bar ── */
.status-bar { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 18px; background: var(--bg2); border: 1px solid var(--bd); border-radius: var(--r); margin-bottom: 20px; }
.status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 12px; border-radius: 20px; font-size: .78rem; font-weight: 500; }
.status-badge.green { background: rgba(74, 222, 128, .12); color: var(--green); }
.status-badge.amber { background: rgba(251, 191, 36, .12); color: var(--amber); }
.status-badge.red { background: rgba(248, 113, 113, .12); color: var(--red); }
.status-badge.muted { background: rgba(90, 90, 114, .15); color: var(--t2); }
a.status-badge { text-decoration: none; cursor: pointer; transition: filter .15s, box-shadow .15s; }
a.status-badge:hover { filter: brightness(1.15); box-shadow: 0 0 0 1px currentColor; }

/* ── Metric Cards ── */
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 20px; }
.metric-card { background: var(--bg2); border: 1px solid var(--bd); border-radius: var(--r); padding: 16px 18px; transition: border-color .2s; }
.metric-card:hover { border-color: rgba(124, 92, 252, .3); }
.metric-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.metric-icon { font-size: 1rem; }
.metric-label { font-size: .78rem; color: var(--t2); font-weight: 500; }
.metric-main { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.metric-value { font-size: 1.6rem; font-weight: 700; font-family: 'IBM Plex Mono', monospace; }
.metric-unit { font-size: .75rem; color: var(--t3); }
.metric-details { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: .72rem; color: var(--t3); }

/* ── Activity Feed ── */
.activity-feed { background: var(--bg2); border: 1px solid var(--bd); border-radius: var(--r); overflow: hidden; margin-bottom: 20px; }
.activity-item { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-bottom: 1px solid rgba(42, 42, 58, .3); }
.activity-item:last-child { border-bottom: none; }
.activity-item.activity-executing { background: rgba(74, 222, 128, .04); align-items: center; }
.activity-item.activity-executing .activity-icon { margin-top: 0; }
.activity-icon { font-size: 1rem; flex-shrink: 0; }
.activity-icon :deep(.ms) { font-size: 22px; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 22; }
.activity-content { flex: 1; min-width: 0; }
.activity-text { flex: 1; font-size: .85rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.activity-meta { font-size: .75rem; color: var(--t3); margin-left: auto; }
.activity-log-line { font-family: 'IBM Plex Mono', monospace; font-size: .72rem; color: var(--t2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.activity-progress { width: 100%; height: 5px; background: var(--bg); border-radius: 3px; overflow: hidden; margin-top: 6px; position: relative; }
.activity-progress-fill { height: 100%; background: var(--ac); border-radius: 3px; transition: width .3s; }
.activity-empty { padding: 20px; text-align: left; color: var(--t3); font-size: .85rem; }
.activity-empty :deep(.ms) { font-size: 22px; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 22; }

/* ── Environment Info ── */
.env-info { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 18px; background: var(--bg2); border: 1px solid var(--bd); border-radius: var(--r); }
.env-tag { font-size: .7rem; color: var(--t3); padding: 2px 8px; background: var(--bg); border-radius: 4px; border: 1px solid var(--bd); font-family: 'IBM Plex Mono', monospace; }

/* ── Services Table ── */
.svc-table-wrap { overflow-x: auto; margin-bottom: 16px; background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); }
.svc-table { width: 100%; border-collapse: collapse; }
.svc-table th { text-align: left; padding: clamp(10px, 0.9vw, 16px) clamp(14px, 1.2vw, 22px); font-size: .78rem; font-weight: 600; color: var(--t3); text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid var(--bd); }
.svc-table td { padding: clamp(10px, 0.9vw, 16px) clamp(14px, 1.2vw, 22px); border-bottom: 1px solid rgba(42, 42, 58, .3); vertical-align: middle; }
.svc-table tr:hover { background: rgba(124, 92, 252, .03); }
.svc-status { display: inline-flex; align-items: center; gap: 5px; font-size: .82rem; font-weight: 500; }
.svc-actions { display: flex; gap: 4px; }
</style>
