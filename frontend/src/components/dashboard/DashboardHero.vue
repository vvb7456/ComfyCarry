<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import DashboardResources from '@/components/dashboard/DashboardResources.vue'
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

</script>

<template>
  <div class="dash-hero-section">
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
        <template v-if="dashboardState === 'ready'">
          <BaseButton variant="primary" class="dash-btn--pill" @click="router.push('/generate/image')">
            <MsIcon name="auto_awesome" />
            {{ t('dashboard.actions.start_generate') }}
          </BaseButton>
          <BaseButton
            v-if="comfyUrl"
            :href="comfyUrl"
            target="_blank"
            rel="noopener"
            variant="default"
            class="dash-btn--pill"
          >
            <MsIcon name="open_in_new" />
            {{ t('dashboard.actions.open_comfyui') }}
          </BaseButton>
        </template>

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
            rel="noopener"
            variant="default"
            class="dash-btn--pill"
          >
            <MsIcon name="open_in_new" />
            {{ t('dashboard.actions.open_comfyui') }}
          </BaseButton>
        </template>

        <template v-else-if="dashboardState === 'starting'">
          <BaseButton variant="default" class="dash-btn--pill" @click="router.push('/comfyui')">
            <MsIcon name="info" />
            {{ t('dashboard.actions.view_status') }}
          </BaseButton>
        </template>

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

    <DashboardResources :stats="sysStats" :initial-loading="initialLoading" />
  </div>
</template>

<style scoped>
.dash-hero-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 472px;
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

/* Hero 两栏是否成立取决于正文容器能否同时容纳说明区和双列资源摘要。
   侧栏展开/收起会改变正文宽度，因此这里查询页面容器而不是视口。 */
@container page (max-width: 960px) {
  .dash-hero-section {
    grid-template-columns: 1fr;
    gap: 32px;
  }
}
</style>
