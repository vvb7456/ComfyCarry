<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useToast } from '@/composables/useToast'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import { useSystemStats } from '@/composables/useSystemStats'
import { useAppStore } from '@/stores/app'
import { useGenerateQueueStore } from '@/stores/generateQueue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import DashboardHero from '@/components/dashboard/DashboardHero.vue'
import DashboardTasks from '@/components/dashboard/DashboardTasks.vue'
import DashboardServices from '@/components/dashboard/DashboardServices.vue'
import DashboardGallery from '@/components/dashboard/DashboardGallery.vue'
import DashboardDiagnostics from '@/components/dashboard/DashboardDiagnostics.vue'
import type {
  OverviewData,
  ActivityData,
  ServiceEntry,
  DashboardState,
} from '@/types/dashboard'

defineOptions({ name: 'DashboardPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const app = useAppStore()
const queueStore = useGenerateQueueStore()

// ── State ─────────────────────────────────────────────────────────────
const data = ref<OverviewData | null>(null)
const activity = ref<ActivityData | null>(null)
const initialLoading = ref(true)
const refreshing = ref(false)
const startingComfy = ref(false)
// ComfyUI 启动/重启下发时刻 (0 = 无待确认启动)。下发后 dashboardState 固定为
// starting, 直到拿到不早于该时刻发起的 overview 快照, 避免旧 stopped 闪回。
const pendingComfyStartAt = ref(0)
let pendingComfyStartTimer: ReturnType<typeof setTimeout> | null = null

function markPendingComfyStart() {
  pendingComfyStartAt.value = Date.now()
  if (pendingComfyStartTimer) clearTimeout(pendingComfyStartTimer)
  pendingComfyStartTimer = setTimeout(() => { pendingComfyStartAt.value = 0 }, 120_000)
}

// 服务行动作提交期间的状态 (loading/disabled 由 DashboardDiagnostics 消费)
const actingSvc = ref<{ name: string; action: string } | null>(null)

// 组件卸载后不再执行的延迟任务 (启动反馈轮询等)
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()
function later(fn: () => void, ms: number) {
  const id = setTimeout(() => {
    pendingTimers.delete(id)
    fn()
  }, ms)
  pendingTimers.add(id)
}

// ── Real-time system metrics ──────────────────────────────────────────
const { stats: sysStats } = useSystemStats()

// ── Exec tracker for real-time progress ───────────────────────────────
const tracker = useExecTracker()
const execState = computed(() => tracker.state.value)

// ── SSE for ComfyUI execution events ──────────────────────────────────
const sse = useComfySSE(tracker, {
  onEvent(event) {
    if (event.type === 'execution_done' || event.type === 'execution_error' || event.type === 'execution_interrupted') {
      loadActivity()
      queueStore.loadHistory()
      loadOverview()
    }
  },
})

// ── Fetch Overview & Activity ─────────────────────────────────────────
let overviewAppliedAt = 0
async function loadOverview() {
  const requestedAt = Date.now()
  const d = await get<OverviewData>('/api/overview', { silent: true })
  if (d) {
    // 乱序响应保护: 迟到的旧快照不能覆盖新快照
    if (requestedAt >= overviewAppliedAt) {
      overviewAppliedAt = requestedAt
      data.value = d
      if (pendingComfyStartAt.value && requestedAt >= pendingComfyStartAt.value) pendingComfyStartAt.value = 0
    }
  }
  initialLoading.value = false
}

async function loadActivity() {
  const d = await get<ActivityData>('/api/activity', { silent: true })
  if (d) {
    activity.value = d
  }
}

async function refreshAll() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await Promise.all([
      loadOverview(),
      loadActivity(),
      queueStore.loadHistory(),
    ])
  } finally {
    refreshing.value = false
  }
}

async function startComfyUI() {
  if (startingComfy.value) return
  startingComfy.value = true
  try {
    const res = await post('/api/comfyui/restart')
    if (res) {
      // 重启必定中断当前执行, 立即清掉旧执行态, 不等 ws_disconnected 事件
      tracker.reset()
      markPendingComfyStart()
      toast(t('dashboard.actions.starting'), 'info')
      later(() => {
        loadOverview()
        loadActivity()
      }, 2000)
    }
  } finally {
    later(() => {
      startingComfy.value = false
    }, 4000)
  }
}

async function svcAction(name: string, action: string) {
  if (actingSvc.value) return
  actingSvc.value = { name, action }
  let res
  if (name === 'sync-worker') {
    res = await post(`/api/sync/worker/${action}`)
  } else {
    res = await post(`/api/services/${name}/${action}`)
  }
  if (!res) {
    actingSvc.value = null
    return
  }
  toast(t('dashboard.services.action_sent', { action }), 'info')
  later(() => {
    actingSvc.value = null
    loadOverview()
  }, 2000)
}

// ── Auto Refresh ──────────────────────────────────────────────────────
// Dual timer: 5s for fast activity data (tasks/downloads), 15s for slow overview data (PM2/services/system)
const activityRefresh = useAutoRefresh(loadActivity, 5000)
const overviewRefresh = useAutoRefresh(loadOverview, 15000)

onMounted(() => {
  sse.start()
  activityRefresh.start()
  overviewRefresh.start()
})

onUnmounted(() => {
  sse.stop()
  if (pendingComfyStartTimer) clearTimeout(pendingComfyStartTimer)
  for (const id of pendingTimers) clearTimeout(id)
  pendingTimers.clear()
})

// ── Computed Properties for Subcomponents ─────────────────────────────
const tunnelUrls = computed(() => {
  const tObj = data.value?.tunnel
  if (!tObj) return {} as Record<string, string>
  const all = { ...(tObj.urls || {}) }
  if (tObj.public?.urls) Object.assign(all, tObj.public.urls)
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => !['comfycarry', 'ssh', 'dashboard'].includes(k.toLowerCase()))
  )
})

const comfyUrl = computed(() => {
  const tunnel = tunnelUrls.value['comfyui'] || tunnelUrls.value['ComfyUI'] || ''
  if (tunnel) return tunnel
  if (!data.value?.comfyui?.online) return ''
  const port = data.value.comfyui.port || 8188
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${port}`
})

const jupyterUrl = computed(() => {
  const tunnel = tunnelUrls.value['jupyter'] || tunnelUrls.value['JupyterLab'] || ''
  if (tunnel) return tunnel
  if (!data.value?.jupyter?.online || !data.value.jupyter.port) return ''
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${data.value.jupyter.port}`
})

const appVersion = computed(() => {
  const v = data.value?.version?.version || app.version
  if (!v) return ''
  return v.startsWith('v') ? v : `v${v}`
})

const comfyuiVersion = computed(() => {
  return data.value?.comfyui?.version || ''
})

const dashboardState = computed<DashboardState>(() => {
  if (initialLoading.value && !data.value) return 'loading'
  if (!data.value) return 'unavailable'

  const comfy = data.value.comfyui
  const pm2 = (comfy?.pm2_status || '').toLowerCase()

  if (['errored', 'error', 'failed'].includes(pm2)) {
    return 'fault'
  }
  // 启动/重启已下发但快照尚未更新: 保持启动中, 避免旧 stopped 闪回
  if (pendingComfyStartAt.value) {
    return 'starting'
  }
  if (!comfy?.online && (pm2 === 'online' || pm2 === 'starting' || pm2 === 'launching')) {
    return 'starting'
  }
  if (!comfy?.online) {
    return 'stopped'
  }

  const isExecuting = !!execState.value
  const queuePending = activity.value?.comfyui?.queue_pending || 0

  if (isExecuting || queuePending > 0) {
    return 'busy'
  }

  return 'ready'
})

const pendingQueueCount = computed(() => {
  return activity.value?.comfyui?.queue_pending || 0
})

const activeDownloads = computed(() => {
  return activity.value?.downloads?.active?.slice(0, 2) || []
})

const isComfyBusy = computed(() => dashboardState.value === 'busy')

const comfyuiSvcStatusTone = computed<'running' | 'stopped' | 'loading' | 'error'>(() => {
  switch (dashboardState.value) {
    case 'fault':
      return 'error'
    case 'starting':
      return 'loading'
    case 'stopped':
      return 'stopped'
    case 'busy':
    case 'ready':
      return 'running'
    default:
      return 'stopped'
  }
})

const comfyuiSvcStatusText = computed(() => {
  switch (dashboardState.value) {
    case 'fault':
      return t('dashboard.services.error')
    case 'starting':
      return t('dashboard.services.starting')
    case 'stopped':
      return t('dashboard.services.stopped')
    case 'busy':
      return t('dashboard.services.generating')
    case 'ready':
      return t('dashboard.services.online')
    default:
      return t('dashboard.services.stopped')
  }
})

const jupyterSvcStatusTone = computed<'running' | 'stopped' | 'loading' | 'error'>(() => {
  const j = data.value?.jupyter
  if (!j) return 'stopped'
  if (j.online) return 'running'
  const pm2 = (j.pm2_status || '').toLowerCase()
  if (['starting', 'launching'].includes(pm2)) return 'loading'
  if (['errored', 'error', 'failed'].includes(pm2)) return 'error'
  return 'stopped'
})

const jupyterSvcStatusText = computed(() => {
  const j = data.value?.jupyter
  if (!j) return t('dashboard.services.stopped')
  if (j.online) return t('dashboard.services.online')
  const pm2 = (j.pm2_status || '').toLowerCase()
  if (['starting', 'launching'].includes(pm2)) return t('dashboard.services.starting')
  if (['errored', 'error', 'failed'].includes(pm2)) return t('dashboard.services.error')
  return t('dashboard.services.stopped')
})

const syncSvcStatusTone = computed<'running' | 'stopped' | 'loading' | 'error'>(() => {
  const s = data.value?.sync
  if (!s) return 'stopped'
  if (s.worker_running) return 'running'
  return 'stopped'
})

const syncSvcStatusText = computed(() => {
  const s = data.value?.sync
  if (!s) return t('dashboard.services.stopped')
  if (s.worker_running) {
    return t('dashboard.services.sync_running')
  }
  return t('dashboard.services.stopped')
})

const tunnelSvcStatusTone = computed<'running' | 'stopped' | 'loading' | 'error'>(() => {
  const tObj = data.value?.tunnel
  if (!tObj) return 'stopped'
  const st = (tObj.effective_status || '').toLowerCase()
  if (st === 'online' || st === 'running') return 'running'
  if (st === 'connecting' || st === 'launching' || st === 'starting') return 'loading'
  if (st === 'offline' || st === 'error' || st === 'failed') return 'error'
  return 'stopped'
})

const tunnelConfigured = computed(() => {
  const tObj = data.value?.tunnel
  if (!tObj) return false
  return tObj.effective_status !== 'unconfigured' && tObj.effective_status !== 'disabled'
})

const tunnelSvcStatusText = computed(() => {
  const tObj = data.value?.tunnel
  if (!tObj) return t('dashboard.services.not_configured')
  const st = (tObj.effective_status || '').toLowerCase()
  if (st === 'online' || st === 'running') return t('dashboard.services.online')
  if (st === 'connecting' || st === 'launching' || st === 'starting') return t('dashboard.services.connecting')
  if (st === 'offline') return t('dashboard.services.offline')
  if (st === 'error' || st === 'failed') return t('dashboard.services.error')
  if (st === 'unconfigured' || !tunnelConfigured.value) return t('dashboard.services.not_configured')
  return t('dashboard.services.stopped')
})

const svcOrder = ['comfy', 'cf-tunnel', 'jupyter', 'sync-worker', 'dashboard']

// 蓝绿切换后活跃 cloudflared 进程名会在 cf-tunnel / cf-tunnel-next 之间轮换,
// 两者归一化到同一"隧道槽位", 但保留进程真实名 (服务行动作按真实名下发)。
function isTunnelName(name: string): boolean {
  return name === 'cf-tunnel' || name === 'cf-tunnel-next'
}

function orderSlot(name: string): string {
  return isTunnelName(name) ? 'cf-tunnel' : name
}

const orderedServices = computed(() => {
  const raw = data.value?.services as ServiceEntry[] | { services?: ServiceEntry[] } | undefined
  const svcs: ServiceEntry[] = Array.isArray(raw) ? raw : raw?.services || []
  const map = new Map<string, ServiceEntry>()
  for (const s of svcs) {
    const slot = orderSlot(s.name)
    if (!map.has(slot)) map.set(slot, s)
  }
  const result = svcOrder.map((n) => map.get(n)).filter((s): s is ServiceEntry => !!s)
  svcs.forEach((s) => {
    if (!svcOrder.includes(orderSlot(s.name))) result.push(s)
  })
  if (!map.has('cf-tunnel') && data.value?.tunnel) {
    const tStatus = data.value.tunnel.effective_status
    result.splice(1, 0, {
      name: 'cf-tunnel',
      status: tStatus === 'online' ? 'online' : (tStatus === 'connecting' ? 'launching' : 'stopped'),
      uptime: '-',
      cpu: '-',
      memory: '-',
      restarts: 0,
    })
  }
  if (!map.has('sync-worker') && data.value?.sync) {
    result.splice(3, 0, {
      name: 'sync-worker',
      status: data.value.sync.worker_running ? 'online' : 'stopped',
      uptime: '-',
      cpu: '-',
      memory: '-',
      restarts: 0,
    })
  }
  return result
})

const onlineServiceCount = computed(() => {
  return orderedServices.value.filter((s) => s.status?.toLowerCase() === 'online').length
})

const totalServiceCount = computed(() => {
  return orderedServices.value.length
})
</script>

<template>
  <div class="page-body">
    <!-- ── Full-Width Page Header Row (Left: Page Title, Right: Refresh Button) ── -->
    <div class="page-header-row">
      <div class="page-title-wrap">
        <button
          type="button"
          class="mobile-menu-btn"
          :aria-label="app.mobileSidebarOpen ? 'Close menu' : 'Open menu'"
          @click="app.toggleMobileSidebar()"
        >
          <MsIcon name="menu" />
        </button>
        <h1 class="page-title">{{ t('dashboard.title') }}</h1>
      </div>

      <!-- Right-aligned refresh tool button -->
      <div class="page-header-row__spacer"></div>
      <BaseButton
        variant="ghost"
        size="sm"
        icon-only
        :disabled="refreshing"
        :aria-label="t('dashboard.refresh')"
        :title="t('dashboard.refresh')"
        @click="refreshAll"
      >
        <MsIcon name="refresh" :class="{ 'dash-spin': refreshing }" />
      </BaseButton>
    </div>

    <!-- ── Constrained Centered Content Container ── -->
    <div class="dash-container">
      <!-- ── Section 0: Open Hero Section ── -->
      <DashboardHero
        :dashboard-state="dashboardState"
        :app-version="appVersion"
        :comfyui-version="comfyuiVersion"
        :exec-state="execState"
        :pending-queue-count="pendingQueueCount"
        :comfy-url="comfyUrl"
        :starting-comfy="startingComfy"
        :refreshing="refreshing"
        :initial-loading="initialLoading"
        :sys-stats="sysStats"
        @start-comfy-u-i="startComfyUI"
        @refresh-all="refreshAll"
      />

      <!-- ── Section 1: 实时任务 (Real-time Tasks) ── -->
      <DashboardTasks
        :initial-loading="initialLoading"
        :activity="activity"
        :exec-state="execState"
        :elapsed="tracker.elapsed.value"
        :active-downloads="activeDownloads"
      />

      <!-- ── Section 2: 基础服务 (Infrastructure Services) ── -->
      <DashboardServices
        :initial-loading="initialLoading"
        :data="data"
        :dashboard-state="dashboardState"
        :is-comfy-busy="isComfyBusy"
        :starting-comfy="startingComfy"
        :comfy-url="comfyUrl"
        :jupyter-url="jupyterUrl"
        :tunnel-configured="tunnelConfigured"
        :comfyui-svc-status-tone="comfyuiSvcStatusTone"
        :comfyui-svc-status-text="comfyuiSvcStatusText"
        :jupyter-svc-status-tone="jupyterSvcStatusTone"
        :jupyter-svc-status-text="jupyterSvcStatusText"
        :sync-svc-status-tone="syncSvcStatusTone"
        :sync-svc-status-text="syncSvcStatusText"
        :tunnel-svc-status-tone="tunnelSvcStatusTone"
        :tunnel-svc-status-text="tunnelSvcStatusText"
        @start-comfy-u-i="startComfyUI"
      />

      <!-- ── Section 3: 最近生成 (Gallery) ── -->
      <DashboardGallery />

      <!-- ── Section 4: 状态与环境 (Diagnostics) ── -->
      <DashboardDiagnostics
        :initial-loading="initialLoading"
        :data="data"
        :sys-stats="sysStats"
        :ordered-services="orderedServices"
        :online-service-count="onlineServiceCount"
        :total-service-count="totalServiceCount"
        :acting="actingSvc"
        @svc-action="svcAction"
      />
    </div>
  </div>
</template>

<style scoped>
.dash-spin {
  animation: spin 0.8s linear infinite;
}

/* ── Centered Content Container ── */
.dash-container {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding-bottom: var(--sp-6);
}
</style>
