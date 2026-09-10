<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { fmtBytes, fmtSpeed } from '@/utils/format'
import type { ExecState } from '@/composables/useExecTracker'
import type { ActivityData, DownloadTask } from '@/types/dashboard'

defineOptions({ name: 'DashboardTasks' })

defineProps<{
  initialLoading: boolean
  activity: ActivityData | null
  execState: ExecState | null
  elapsed: number
  activeDownloads: DownloadTask[]
}>()

const { t } = useI18n({ useScope: 'global' })

function formatDlSpeed(speed?: number | string): string {
  if (speed == null) return ''
  const num = typeof speed === 'string' ? parseFloat(speed) : speed
  if (!num || isNaN(num) || num <= 0) return ''
  return fmtSpeed(num)
}

function formatDlSize(completed?: number, total?: number): string {
  if (!total || total <= 0) {
    return completed && completed > 0 ? fmtBytes(completed) : ''
  }
  return `${fmtBytes(completed || 0)} / ${fmtBytes(total)}`
}
</script>

<template>
  <section class="dash-section">
    <div class="dash-section-header">
      <div class="dash-section-tagline">
        <span class="dash-accent-bar"></span>
        <span class="dash-tagline-text">{{ t('dashboard.taglines.tasks') }}</span>
      </div>
      <div class="dash-section-title-row">
        <h2 class="dash-section-title">{{ t('dashboard.current.title') }}</h2>
        <router-link
          v-if="execState || activeDownloads.length > 0"
          to="/generate/image?panel=queue"
          class="dash-section-action"
        >
          <span class="dash-section-action__text">{{ t('dashboard.actions.view_all') }}</span>
          <MsIcon name="arrow_forward" size="xs" />
        </router-link>
      </div>
    </div>

    <!-- Initial loading -->
    <div v-if="initialLoading && !activity" class="dash-tasks-loading">
      <div class="dash-spinner"></div>
      <span>{{ t('common.status.loading') }}</span>
    </div>

    <!-- Executing generation progress bar (Reused ComfyProgressBar) -->
    <div v-else-if="execState" class="dash-tasks-exec">
      <ComfyProgressBar :state="execState" :elapsed="elapsed" />
    </div>

    <!-- Active downloads -->
    <div v-else-if="activeDownloads.length > 0" class="dash-tasks-card">
      <div
        v-for="dl in activeDownloads"
        :key="dl.filename"
        class="dash-task-item"
      >
        <div class="dash-task-icon">
          <MsIcon name="download" />
        </div>
        <div class="dash-task-content">
          <div class="dash-task-row">
            <span class="dash-task-name text-truncate" :title="dl.model_name || dl.filename">
              {{ dl.model_name || dl.filename }}
            </span>
            <span class="dash-task-meta">
              <template v-if="formatDlSpeed(dl.speed)">{{ formatDlSpeed(dl.speed) }} · </template>
              <template v-if="formatDlSize(dl.completed_bytes, dl.total_bytes)">{{ formatDlSize(dl.completed_bytes, dl.total_bytes) }} · </template>
              {{ Math.round(dl.progress) }}%
            </span>
          </div>
          <div class="dash-task-bar-wrap">
            <UsageBar :percent="dl.progress" :height="4" />
          </div>
          <div v-if="dl.model_name && dl.filename !== dl.model_name" class="dash-task-sub text-truncate" :title="dl.filename">
            {{ dl.filename }}
          </div>
        </div>
      </div>
    </div>

    <!-- 空闲：与最近生成的空态同一副形态（居中静音一行，不套容器，也没有状态点） -->
    <EmptyState v-else :message="t('dashboard.current.idle_desc')" />
  </section>
</template>

<style scoped>
.dash-section-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  color: var(--ac);
  text-decoration: none;
  font-weight: 500;
  transition: opacity 0.15s ease;
}

.dash-section-action:hover {
  text-decoration: none;
  opacity: 0.85;
}

.dash-section-action:hover .dash-section-action__text {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.dash-section-action .ms {
  text-decoration: none !important;
  transition: transform 0.15s ease;
}

.dash-section-action:hover .ms {
  transform: translateX(2px);
}

/* ── Section 1: Real-time Tasks ── */

.dash-tasks-loading {
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  color: var(--t3);
  font-size: var(--text-sm);
}

.dash-tasks-exec {
  width: 100%;
}

.dash-tasks-card {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.dash-task-item {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
}

.dash-task-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--rs);
  background: color-mix(in srgb, var(--ac) 12%, transparent);
  color: var(--ac);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dash-task-content {
  flex: 1;
  min-width: 0;
}

.dash-task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.dash-task-name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
}

.dash-task-meta {
  font-size: var(--text-sm);
  color: var(--t3);
  font-family: var(--font-tabular);
}

.dash-task-bar-wrap {
  margin-bottom: 4px;
}

.dash-task-sub {
  font-size: var(--text-sm);
  color: var(--t3);
}
</style>
