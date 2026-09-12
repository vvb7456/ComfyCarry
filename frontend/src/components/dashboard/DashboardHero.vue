<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import type { DashboardState } from '@/types/dashboard'
import type { ExecState } from '@/composables/useExecTracker'
import type { SystemStats } from '@/types/system'

defineOptions({ name: 'DashboardHero' })

const props = defineProps<{
  dashboardState: DashboardState
  appVersion: string
  comfyuiVersion: string
  execState: ExecState | null
  pendingQueueCount: number
  comfyUrl: string
  startingComfy: boolean
  refreshing: boolean
  initialLoading: boolean
  sysStats: SystemStats | null
}>()

const emit = defineEmits<{
  (e: 'startComfyUI'): void
  (e: 'refreshAll'): void
}>()

const router = useRouter()
const { t } = useI18n({ useScope: 'global' })

// ── Hero Content ──────────────────────────────────────────────────────
const heroTitle = computed(() => {
  switch (props.dashboardState) {
    case 'ready':
      return t('dashboard.hero.ready_title')
    case 'busy':
      return t('dashboard.hero.busy_title')
    case 'starting':
      return t('dashboard.hero.starting_title')
    case 'stopped':
      return t('dashboard.hero.stopped_title')
    case 'fault':
      return t('dashboard.hero.fault_title')
    case 'unavailable':
      return t('dashboard.hero.unavailable_title')
    default:
      return ''
  }
})

const heroSubtitle = computed(() => {
  switch (props.dashboardState) {
    case 'ready': {
      const parts: string[] = []
      if (props.appVersion) {
        parts.push(`ComfyCarry ${props.appVersion}`)
      }
      if (props.comfyuiVersion) {
        parts.push(`ComfyUI ${props.comfyuiVersion}`)
      }
      parts.push(t('dashboard.current.idle'))
      return parts.join(' · ')
    }
    case 'busy': {
      if (props.execState) {
        const cn = props.execState.currentNode
        const nodeName = cn ? (props.execState.nodeNames?.[cn] || cn) : ''
        const p = props.execState.progress
        const stepStr = p && p.value != null ? `${p.value}/${p.max}` : ''
        const count = props.pendingQueueCount
        const parts = [nodeName, stepStr, count > 0 ? t('dashboard.hero.busy_sub_no_progress', { count }) : ''].filter(Boolean)
        return parts.join(' · ') || t('dashboard.hero.busy_title')
      }
      return t('dashboard.hero.busy_sub_no_progress', { count: props.pendingQueueCount })
    }
    case 'starting':
      return t('dashboard.hero.starting_sub')
    case 'stopped':
      return t('dashboard.hero.stopped_sub')
    case 'fault':
      return t('dashboard.hero.fault_sub')
    case 'unavailable':
      return t('dashboard.hero.unavailable_sub')
    default:
      return ''
  }
})

// ── GPU Card Metrics ──────────────────────────────────────────────────
const primaryGpu = computed(() => {
  if (!props.sysStats?.gpu || props.sysStats.gpu.length === 0) return null
  return props.sysStats.gpu[0]
})

const gpuUsedPct = computed(() => {
  if (!primaryGpu.value) return 0
  const total = primaryGpu.value.mem_total || 0
  const used = primaryGpu.value.mem_used || 0
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)))
})

const gpuFreeGb = computed(() => {
  if (!primaryGpu.value) return '—'
  const total = primaryGpu.value.mem_total || 0
  const used = primaryGpu.value.mem_used || 0
  const free = Math.max(0, total - used)
  return (free / 1024).toFixed(1)
})

const gpuUsedGb = computed(() => {
  if (!primaryGpu.value) return '0.0'
  return ((primaryGpu.value.mem_used || 0) / 1024).toFixed(1)
})

const gpuTotalGb = computed(() => {
  if (!primaryGpu.value) return '0.0'
  return ((primaryGpu.value.mem_total || 0) / 1024).toFixed(1)
})

const gpuName = computed(() => {
  return primaryGpu.value?.name || t('dashboard.gpu.not_detected')
})

const gpuTemp = computed(() => {
  return primaryGpu.value?.temp ?? null
})

const gpuTempColor = computed(() => {
  const temp = gpuTemp.value
  if (temp === null) return 'var(--t3)'
  if (temp >= 85) return 'var(--red)'
  if (temp >= 75) return 'var(--amber)'
  return 'var(--t3)'
})
</script>

<template>
  <div class="dash-hero-section">
    <!-- Left: Open Typography & CTA Actions -->
    <div v-if="dashboardState === 'loading'" class="dash-hero__typography dash-hero__skeleton">
      <div class="dash-skeleton dash-skeleton--hero-title"></div>
      <div class="dash-skeleton dash-skeleton--hero-sub"></div>
      <div class="dash-skeleton-row">
        <div class="dash-skeleton dash-skeleton--btn"></div>
        <div class="dash-skeleton dash-skeleton--btn-sec"></div>
      </div>
    </div>

    <div v-else class="dash-hero__typography">
      <h2 class="dash-hero__title">{{ heroTitle }}</h2>
      <p class="dash-hero__sub">{{ heroSubtitle }}</p>

      <div class="dash-hero__actions">
        <!-- Ready -->
        <template v-if="dashboardState === 'ready'">
          <BaseButton variant="primary" class="dash-btn--pill" @click="router.push('/generate/image')">
            <MsIcon name="auto_awesome" />
            {{ t('dashboard.actions.start_generate') }}
          </BaseButton>
          <BaseButton
            v-if="comfyUrl"
            :href="comfyUrl"
            target="_blank"
            variant="default"
            class="dash-btn--pill"
          >
            <MsIcon name="open_in_new" />
            {{ t('dashboard.actions.open_comfyui') }}
          </BaseButton>
        </template>

        <!-- Busy -->
        <template v-else-if="dashboardState === 'busy'">
          <BaseButton
            variant="primary"
            class="dash-btn--pill"
            @click="router.push({ path: '/generate/image', query: { panel: 'queue' } })"
          >
            <MsIcon name="auto_awesome" />
            {{ t('dashboard.actions.view_progress') }}
          </BaseButton>
          <BaseButton
            v-if="comfyUrl"
            :href="comfyUrl"
            target="_blank"
            variant="default"
            class="dash-btn--pill"
          >
            <MsIcon name="open_in_new" />
            {{ t('dashboard.actions.open_comfyui') }}
          </BaseButton>
        </template>

        <!-- Starting -->
        <template v-else-if="dashboardState === 'starting'">
          <BaseButton variant="default" class="dash-btn--pill" @click="router.push('/comfyui')">
            <MsIcon name="info" />
            {{ t('dashboard.actions.view_status') }}
          </BaseButton>
        </template>

        <!-- Stopped -->
        <template v-else-if="dashboardState === 'stopped'">
          <BaseButton
            variant="primary"
            class="dash-btn--pill"
            :loading="startingComfy"
            @click="emit('startComfyUI')"
          >
            <MsIcon name="play_arrow" />
            {{ t('dashboard.actions.start_comfyui') }}
          </BaseButton>
          <BaseButton variant="default" class="dash-btn--pill" @click="router.push('/comfyui')">
            <MsIcon name="subject" />
            {{ t('dashboard.actions.view_logs') }}
          </BaseButton>
        </template>

        <!-- Fault -->
        <template v-else-if="dashboardState === 'fault'">
          <BaseButton variant="default" class="dash-btn--pill" @click="router.push('/comfyui')">
            <MsIcon name="subject" />
            {{ t('dashboard.actions.view_logs') }}
          </BaseButton>
          <BaseButton
            variant="primary"
            class="dash-btn--pill"
            :loading="startingComfy"
            @click="emit('startComfyUI')"
          >
            <MsIcon name="replay" />
            {{ t('dashboard.actions.retry_start') }}
          </BaseButton>
        </template>

        <!-- Unavailable -->
        <template v-else-if="dashboardState === 'unavailable'">
          <BaseButton
            variant="primary"
            class="dash-btn--pill"
            :loading="refreshing"
            @click="emit('refreshAll')"
          >
            <MsIcon name="refresh" />
            {{ t('common.btn.retry') }}
          </BaseButton>
        </template>
      </div>
    </div>

    <!-- Right: Floating GPU Card -->
    <div v-if="!primaryGpu && initialLoading" class="dash-gpu-card dash-gpu-card--loading">
      <div class="dash-skeleton dash-skeleton--text" style="width:40%"></div>
      <div class="dash-skeleton dash-skeleton--title" style="width:75%;margin:8px 0"></div>
      <div class="dash-skeleton dash-skeleton--text" style="width:55%"></div>
      <div class="dash-skeleton" style="height:5px;width:100%;margin:12px 0;border-radius:3px"></div>
      <div class="dash-skeleton dash-skeleton--text" style="width:70%"></div>
    </div>

    <div v-else class="dash-gpu-card">
      <div class="dash-gpu__header">
        <span class="dash-gpu__title">{{ t('dashboard.gpu.title') }}</span>
      </div>
      <div class="dash-gpu__val">
        {{ t('dashboard.gpu.available', { vram: gpuFreeGb + ' GB' }) }}
      </div>
      <div class="dash-gpu__sub">
        <span>{{ gpuName }}</span>
        <template v-if="gpuTemp !== null">
          <span>·</span>
          <span :style="{ color: gpuTempColor }">{{ gpuTemp }}°C</span>
        </template>
      </div>
      <UsageBar
        :percent="gpuUsedPct"
        :height="5"
      />
      <div class="dash-gpu__footer">
        <span class="dash-gpu__usage-text">{{ gpuUsedGb }} / {{ gpuTotalGb }} GB</span>
        <span class="dash-gpu__pct">{{ t('dashboard.gpu.used_pct', { pct: gpuUsedPct }) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Open Hero Section ── */
.dash-hero-section {
  display: grid;
  grid-template-columns: 1fr minmax(280px, 320px);
  gap: clamp(24px, 4vw, 48px);
  align-items: center;
  padding: 8px 0 28px 0;
}

.dash-hero__typography {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.dash-hero__skeleton {
  gap: 12px;
}

.dash-hero__title {
  font-size: clamp(2rem, 3.4vw, 2.75rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--t1);
  margin: 0 0 10px 0;
  line-height: 1.15;
}

.dash-hero__sub {
  font-size: var(--text-sm);
  color: var(--t3);
  font-family: var(--font-tabular);
  margin: 0 0 24px 0;
  line-height: 1.5;
}

.dash-hero__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.dash-btn--pill {
  border-radius: var(--r-pill) !important;
  padding: 8px 18px !important;
  font-weight: 600 !important;
  letter-spacing: -0.01em !important;
}

/* ── Right Floating GPU Card ── */
.dash-gpu-card {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: var(--sh);
}

.dash-gpu-card--loading {
  gap: var(--sp-2);
  justify-content: center;
}

.dash-gpu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--t3);
  margin-bottom: 6px;
  font-weight: 500;
}

.dash-gpu__val {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--t1);
  font-family: var(--font-tabular);
  line-height: 1.2;
  margin-bottom: 4px;
}

.dash-gpu__sub {
  font-size: var(--text-xs);
  color: var(--t3);
  margin-bottom: var(--sp-3);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.dash-gpu__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--t3);
  font-family: var(--font-tabular);
  margin-top: 10px;
}

.dash-gpu__pct {
  font-size: var(--text-xs);
  color: var(--t3);
  font-family: var(--font-tabular);
}

/* ── Skeletons ── */
.dash-skeleton {
  background: color-mix(in srgb, var(--t3) 14%, transparent);
  border-radius: var(--r-xs);
  animation: pulse 1.5s ease-in-out infinite;
}

.dash-skeleton--hero-title {
  height: 38px;
  width: 55%;
  margin-bottom: 10px;
}

.dash-skeleton--hero-sub {
  height: 16px;
  width: 40%;
  margin-bottom: var(--sp-6);
}

.dash-skeleton-row {
  display: flex;
  gap: var(--sp-3);
}

.dash-skeleton--btn {
  height: 38px;
  width: 120px;
  border-radius: var(--r-pill);
}

.dash-skeleton--btn-sec {
  height: 38px;
  width: 100px;
  border-radius: var(--r-pill);
}

.dash-skeleton--text {
  height: 12px;
}

.dash-skeleton--title {
  height: 24px;
}

@media (max-width: 860px) {
  .dash-hero-section {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
</style>
