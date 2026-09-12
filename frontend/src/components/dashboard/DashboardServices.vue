<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { serviceIcon } from '@/config/serviceIdentity'
import type { OverviewData, DashboardState } from '@/types/dashboard'

defineOptions({ name: 'DashboardServices' })

defineProps<{
  initialLoading: boolean
  data: OverviewData | null
  dashboardState: DashboardState
  isComfyBusy: boolean
  startingComfy: boolean
  comfyUrl: string
  jupyterUrl: string
  tunnelConfigured: boolean
  comfyuiSvcStatusTone: 'running' | 'stopped' | 'loading' | 'error'
  comfyuiSvcStatusText: string
  jupyterSvcStatusTone: 'running' | 'stopped' | 'loading' | 'error'
  jupyterSvcStatusText: string
  syncSvcStatusTone: 'running' | 'stopped' | 'loading' | 'error'
  syncSvcStatusText: string
  tunnelSvcStatusTone: 'running' | 'stopped' | 'loading' | 'error'
  tunnelSvcStatusText: string
}>()

const emit = defineEmits<{
  (e: 'startComfyUI'): void
}>()

const { t } = useI18n({ useScope: 'global' })

// 服务身份图标 (单一来源 config/serviceIdentity.ts); 先取常量避免模板内联
// serviceIcon('xxx') 被 build-fonts 当图标名提取, 产生 Missing codepoints 误报
const SVC_ICONS = {
  comfyui: serviceIcon('comfyui'),
  jupyter: serviceIcon('jupyter'),
  sync: serviceIcon('sync'),
  tunnel: serviceIcon('tunnel'),
} as const
</script>

<template>
  <section class="dash-section">
    <div class="dash-section-header">
      <div class="dash-section-tagline">
        <span class="dash-accent-bar"></span>
        <span class="dash-tagline-text">{{ t('dashboard.taglines.services') }}</span>
      </div>
      <div class="dash-section-title-row">
        <h2 class="dash-section-title">{{ t('dashboard.services.title') }}</h2>
      </div>
    </div>

    <!-- Skeletons -->
    <div v-if="initialLoading && !data" class="dash-svc-grid">
      <div v-for="i in 4" :key="i" class="dash-svc-card dash-svc-card--skeleton">
        <div class="dash-skeleton dash-skeleton--icon" style="margin-bottom: 12px"></div>
        <div class="dash-skeleton dash-skeleton--text" style="width: 60%; height: 14px; margin-bottom: 8px"></div>
        <div class="dash-skeleton dash-skeleton--text" style="width: 80%; height: 12px"></div>
      </div>
    </div>

    <!-- 4-Column Micro Cards Grid -->
    <div v-else class="dash-svc-grid">
      <!-- Card 1: ComfyUI -->
      <div class="dash-svc-card">
        <div class="dash-svc-card__top">
          <div class="dash-svc-card__icon">
            <MsIcon :name="SVC_ICONS.comfyui" size="md" />
          </div>
          <a
            v-if="dashboardState === 'ready' || dashboardState === 'busy'"
            :href="comfyUrl || undefined"
            target="_blank"
            class="link dash-svc-card__cta"
          >
            <span class="dash-svc-card__cta-text">{{ isComfyBusy ? t('dashboard.actions.view') : t('dashboard.actions.open') }}</span>
            <MsIcon name="open_in_new" />
          </a>
          <button
            v-else-if="dashboardState === 'stopped'"
            type="button"
            class="dash-svc-card__cta"
            :disabled="startingComfy"
            @click="emit('startComfyUI')"
          >
            <span class="dash-svc-card__cta-text">{{ t('dashboard.actions.start') }}</span>
          </button>
          <router-link
            v-else
            to="/comfyui"
            class="dash-svc-card__cta"
          >
            <span class="dash-svc-card__cta-text">{{ t('dashboard.actions.manage') }}</span>
          </router-link>
        </div>
        <div class="dash-svc-card__name">{{ t('dashboard.services.comfyui') }}</div>
        <div class="dash-svc-card__status">
          <StatusDot :status="comfyuiSvcStatusTone" size="sm" />
          <span>{{ comfyuiSvcStatusText }}</span>
        </div>
      </div>

      <!-- Card 2: Jupyter -->
      <div class="dash-svc-card">
        <div class="dash-svc-card__top">
          <div class="dash-svc-card__icon">
            <MsIcon :name="SVC_ICONS.jupyter" size="md" />
          </div>
          <a
            v-if="data?.jupyter?.online && jupyterUrl"
            :href="jupyterUrl"
            target="_blank"
            class="link dash-svc-card__cta"
          >
            <span class="dash-svc-card__cta-text">{{ t('dashboard.actions.open') }}</span>
            <MsIcon name="open_in_new" />
          </a>
          <router-link
            v-else
            to="/jupyter"
            class="dash-svc-card__cta"
          >
            <span class="dash-svc-card__cta-text">{{ t('dashboard.actions.manage') }}</span>
          </router-link>
        </div>
        <div class="dash-svc-card__name">{{ t('dashboard.services.jupyter') }}</div>
        <div class="dash-svc-card__status">
          <StatusDot :status="jupyterSvcStatusTone" size="sm" />
          <span>{{ jupyterSvcStatusText }}</span>
        </div>
      </div>

      <!-- Card 3: Cloud Sync -->
      <div class="dash-svc-card">
        <div class="dash-svc-card__top">
          <div class="dash-svc-card__icon">
            <MsIcon :name="SVC_ICONS.sync" size="md" />
          </div>
          <router-link to="/sync" class="dash-svc-card__cta">
            <span class="dash-svc-card__cta-text">{{ t('dashboard.actions.manage') }}</span>
          </router-link>
        </div>
        <div class="dash-svc-card__name">{{ t('dashboard.services.sync') }}</div>
        <div class="dash-svc-card__status">
          <StatusDot :status="syncSvcStatusTone" size="sm" />
          <span>{{ syncSvcStatusText }}</span>
        </div>
      </div>

      <!-- Card 4: Tunnel -->
      <div class="dash-svc-card">
        <div class="dash-svc-card__top">
          <div class="dash-svc-card__icon">
            <MsIcon :name="SVC_ICONS.tunnel" size="md" />
          </div>
          <router-link to="/tunnel" class="dash-svc-card__cta">
            <span class="dash-svc-card__cta-text">{{ tunnelConfigured ? t('dashboard.actions.manage') : t('dashboard.actions.config') }}</span>
          </router-link>
        </div>
        <div class="dash-svc-card__name">{{ t('dashboard.services.tunnel') }}</div>
        <div class="dash-svc-card__status">
          <StatusDot :status="tunnelSvcStatusTone" size="sm" />
          <span>{{ tunnelSvcStatusText }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ── Section 2: Core Services Micro Cards ── */
.dash-svc-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-3);
}

.dash-svc-card {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.dash-svc-card:hover {
  border-color: color-mix(in srgb, var(--ac) 25%, var(--bd));
}

.dash-svc-card--skeleton {
  min-height: 105px;
}

.dash-svc-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
}

.dash-svc-card__icon {
  width: 32px;
  height: 32px;
  border-radius: var(--rs);
  background: color-mix(in srgb, var(--t3) 10%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t2);
}

.dash-svc-card__cta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-sm);
  color: var(--ac);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: none;
  font-weight: 500;
  transition: opacity 0.15s ease;
}

.dash-svc-card__cta:hover {
  opacity: 0.85;
}

/* router-link / button 变体的 hover 下划线反馈 (外部链接由 .link 提供) */
.dash-svc-card__cta:hover .dash-svc-card__cta-text {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.dash-svc-card__cta:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dash-svc-card__name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
  margin-bottom: 4px;
}

.dash-svc-card__status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-sm);
  color: var(--t3);
}

/* ── Skeletons ── */
.dash-skeleton {
  background: color-mix(in srgb, var(--t3) 14%, transparent);
  border-radius: var(--r-xs);
  animation: pulse 1.5s ease-in-out infinite;
}

.dash-skeleton--icon {
  width: 32px;
  height: 32px;
  border-radius: var(--rs);
}

.dash-skeleton--text {
  height: 12px;
}

@media (max-width: 768px) {
  .dash-svc-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
