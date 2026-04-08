<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LogPanel from '@/components/ui/LogPanel.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import Badge from '@/components/ui/Badge.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { LogLine, LogStatus } from '@/composables/useLogStream'
import type { SyncJob } from '@/composables/useSyncJobs'
import type { SyncRule } from '@/types/sync'

defineOptions({ name: 'SyncActivityTab' })

const props = defineProps<{
  logLines: Array<string | LogLine>
  logStatus?: LogStatus
  jobs: SyncJob[]
  currentJobId: string | null
  rules: SyncRule[]
}>()

const { t } = useI18n({ useScope: 'global' })

// ── Current job ──
const currentJob = computed(() => {
  if (!props.currentJobId) return null
  return props.jobs.find(j => j.job_id === props.currentJobId) || null
})

const finishedJobs = computed(() =>
  props.jobs.filter(j => j.job_id !== props.currentJobId)
)

const currentProgress = computed(() => {
  const j = currentJob.value
  if (!j || !j.rule_count) return 0
  return Math.round(((j.success_count + j.failure_count) / j.rule_count) * 100)
})

const triggerColor: Record<string, string> = { manual: 'var(--blue)', watch: 'var(--green)', deploy: 'var(--amber)' }

const barColor = computed(() => {
  const j = currentJob.value
  if (j && j.failure_count > 0) return 'var(--amber)'
  return 'var(--ac)'
})

// ── Pagination ──
const PAGE_SIZE = 10
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(finishedJobs.value.length / PAGE_SIZE)))
const pagedJobs = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return finishedJobs.value.slice(start, start + PAGE_SIZE)
})

// ── Helpers ──
function ruleOf(job: SyncJob) {
  if (!job.trigger_ref) return null
  return props.rules.find(r => r.id === job.trigger_ref) || null
}

function statusDot(s: string) {
  if (s === 'success') return 'success'
  if (s === 'failed') return 'error'
  if (s === 'running') return 'loading'
  return 'stopped'
}

function fmtTime(epoch: number) {
  if (!epoch) return ''
  return new Date(epoch * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDuration(job: SyncJob) {
  if (!job.started_at || !job.finished_at) return ''
  const sec = Math.round(job.finished_at - job.started_at)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}

function fmtBytes(bytes: number) {
  if (bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtSpeed(bytesPerSec: number) {
  if (bytesPerSec <= 0) return ''
  return `${fmtBytes(bytesPerSec)}/s`
}

function jobPath(job: SyncJob) {
  const rule = ruleOf(job)
  if (!rule) return `${job.rule_count} ${t('sync.activity.rules_short')}`
  if (rule.direction === 'push') return `${rule.local_path} → ${rule.remote}:${rule.remote_path}`
  return `${rule.remote}:${rule.remote_path} → ${rule.local_path}`
}

// ── Expand/Collapse ──
const expandedJobId = ref<string | null>(null)

function toggleExpand(jobId: string) {
  expandedJobId.value = expandedJobId.value === jobId ? null : jobId
}

function jobFiles(job: SyncJob): string[] {
  return job.summary?.files ?? []
}
</script>

<template>
  <!-- Current Job -->
  <BaseCard v-if="currentJob" class="current-job-card">
    <div class="current-job__header">
      <StatusDot status="loading" />
      <span class="current-job__label">{{ t('sync.activity.current_job') }}</span>
      <Badge :color="triggerColor[currentJob.trigger_type]">{{ t(`sync.job.trigger.${currentJob.trigger_type}`) }}</Badge>
    </div>
    <UsageBar :percent="currentProgress" :base-color="barColor" :warning="999" :danger="999" style="margin-top:8px" />
    <div class="current-job__detail">
      {{ currentJob.success_count + currentJob.failure_count }}/{{ currentJob.rule_count }} {{ t('sync.activity.rules_short') }}
      <template v-if="currentJob.files_synced"> · {{ currentJob.files_synced }} {{ t('sync.activity.files_short') }}</template>
    </div>
  </BaseCard>

  <!-- Recent Jobs Table -->
  <SectionHeader icon="history" flush>
    {{ t('sync.activity.recent_jobs') }}
  </SectionHeader>

  <div v-if="finishedJobs.length" class="job-table-wrap">
    <div class="job-table-body">
      <table class="job-table">
      <thead>
        <tr>
          <th class="col-status"></th>
          <th class="col-time">{{ t('sync.activity.col_start') }}</th>
          <th class="col-time">{{ t('sync.activity.col_end') }}</th>
          <th class="col-trigger">{{ t('sync.activity.col_trigger') }}</th>
          <th class="col-files">{{ t('sync.activity.col_files') }}</th>
          <th class="col-size">{{ t('sync.activity.col_size') }}</th>
          <th class="col-speed">{{ t('sync.activity.col_speed') }}</th>
          <th class="col-dur">{{ t('sync.activity.col_duration') }}</th>
          <th class="col-path">{{ t('sync.activity.col_path') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="job in pagedJobs" :key="job.job_id">
          <tr class="job-row" :class="{ 'job-row--expandable': jobFiles(job).length }" @click="jobFiles(job).length && toggleExpand(job.job_id)">
            <td class="col-status"><StatusDot :status="statusDot(job.status)" size="sm" /></td>
            <td class="col-time">{{ fmtTime(job.started_at) }}</td>
            <td class="col-time">{{ job.finished_at ? fmtTime(job.finished_at) : '-' }}</td>
            <td class="col-trigger"><Badge :color="triggerColor[job.trigger_type]" size="sm">{{ t(`sync.job.trigger.${job.trigger_type}`) }}</Badge></td>
            <td class="col-files">
              <span v-if="job.summary">{{ job.summary.transfers ?? 0 }}</span>
              <span v-else>-</span>
              <MsIcon v-if="jobFiles(job).length" :name="expandedJobId === job.job_id ? 'expand_less' : 'expand_more'" size="xxs" class="expand-icon" />
            </td>
            <td class="col-size">{{ job.summary ? fmtBytes(job.summary.bytes ?? 0) || '0 B' : '-' }}</td>
            <td class="col-speed">{{ job.summary ? fmtSpeed(job.summary.speed ?? 0) || '-' : '-' }}</td>
            <td class="col-dur">{{ fmtDuration(job) || '-' }}</td>
            <td class="col-path">
              <template v-if="ruleOf(job)">
                <span class="path-inline">
                  <template v-if="ruleOf(job)!.direction === 'push'">
                    <MsIcon name="folder" size="xxs" class="path-icon" /> {{ ruleOf(job)!.local_path }}
                    <span class="sync-flow-arrows"><span>▸</span><span>▸</span><span>▸</span></span>
                    <MsIcon name="cloud" size="xxs" class="path-icon" /> {{ ruleOf(job)!.remote }}:{{ ruleOf(job)!.remote_path }}
                  </template>
                  <template v-else>
                    <MsIcon name="cloud" size="xxs" class="path-icon" /> {{ ruleOf(job)!.remote }}:{{ ruleOf(job)!.remote_path }}
                    <span class="sync-flow-arrows"><span>▸</span><span>▸</span><span>▸</span></span>
                    <MsIcon name="folder" size="xxs" class="path-icon" /> {{ ruleOf(job)!.local_path }}
                  </template>
                </span>
              </template>
              <span v-else class="path-muted">{{ job.rule_count }} {{ t('sync.activity.rules_short') }}</span>
            </td>
          </tr>
          <tr v-if="expandedJobId === job.job_id && jobFiles(job).length" class="job-files-row">
            <td colspan="9">
              <div class="file-list">
                <span v-for="(f, i) in jobFiles(job)" :key="i" class="file-item">{{ f }}</span>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    </div>

    <!-- Pagination — always at bottom -->
    <div class="pagination">
      <BaseButton variant="ghost" size="xs" :disabled="page <= 1" @click="page--">
        <MsIcon name="chevron_left" size="xs" />
      </BaseButton>
      <span class="pagination__info">{{ page }} / {{ totalPages }}</span>
      <BaseButton variant="ghost" size="xs" :disabled="page >= totalPages" @click="page++">
        <MsIcon name="chevron_right" size="xs" />
      </BaseButton>
    </div>
  </div>
  <div v-else class="job-table-empty">
    <EmptyState icon="cloud_done" :message="t('sync.activity.no_history')" density="compact" />
  </div>

  <!-- Live Log -->
  <div class="log-section">
    <SectionHeader icon="receipt_long" flush>{{ t('sync.log.title') }}</SectionHeader>
    <LogPanel :lines="logLines" :status="logStatus" />
  </div>
</template>

<style scoped>
.current-job-card { margin-bottom: 16px; }
.current-job__header { display: flex; align-items: center; gap: 8px; }
.current-job__label { font-weight: 600; font-size: var(--text-sm); }
.current-job__detail { margin-top: 6px; font-size: var(--text-xs); color: var(--t3); }

.page-info { font-size: var(--text-xs); color: var(--t3); font-variant-numeric: tabular-nums; }

.log-section { margin-top: var(--sp-6); }

.job-table-empty {
  min-height: calc(10 * 30px + 29px + 1px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
}

/* ── Table ── */
.job-table-wrap {
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: calc(10 * 30px + 29px + 33px);  /* 10 rows + thead + pagination */
}

.job-table-body {
  flex: 1;
}

.job-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.job-table thead {
  background: var(--bg3);
}

.job-table th {
  padding: 6px 12px;
  text-align: left;
  font-weight: 600;
  color: var(--t2);
  white-space: nowrap;
  border-bottom: 1px solid var(--bd);
}

.job-table td {
  padding: 6px 12px;
  color: var(--t2);
  border-bottom: 1px solid color-mix(in srgb, var(--bd) 40%, transparent);
  vertical-align: top;
}

.job-row:hover td { background: var(--bg3); }
.job-row:last-child td { border-bottom: none; }
.job-row--expandable { cursor: pointer; }

.expand-icon { vertical-align: middle; margin-left: 2px; opacity: .5; }

.job-files-row td {
  padding: 0 8px 6px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--bd) 40%, transparent);
  background: var(--bg3);
}

.col-status { width: 20px; text-align: center; }
.col-time { width: 70px; font-variant-numeric: tabular-nums; color: var(--t3); white-space: nowrap; }
.col-trigger { width: 70px; }
.col-files { width: 65px; white-space: nowrap; text-align: right; }
.col-size, .col-speed { width: 60px; white-space: nowrap; text-align: right; }
.col-dur { width: 50px; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
.col-path { min-width: 180px; }

.path-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.path-icon { opacity: .5; flex-shrink: 0; }
.path-muted { color: var(--t3); }

/* Animated arrows (same as rule cards) */
.sync-flow-arrows { display: inline-flex; gap: 1px; margin: 0 3px; flex-shrink: 0; }
.sync-flow-arrows span { color: var(--green); font-size: .72rem; font-weight: 700; animation: arrowFlow 1.4s infinite; opacity: .25; }
.sync-flow-arrows span:nth-child(2) { animation-delay: .2s; }
.sync-flow-arrows span:nth-child(3) { animation-delay: .4s; }
@keyframes arrowFlow { 0%, 100% { opacity: .2; } 40% { opacity: 1; } 60% { opacity: 1; } 80% { opacity: .2; } }

.file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  padding: 4px 0 2px 20px;
  font-size: var(--text-xs);
  color: var(--t2);
}
.file-item {
  white-space: nowrap;
}
.file-item::before { content: '→ '; opacity: .5; }

/* ── Pagination ── */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--bd);
  margin-top: auto;
}
.pagination__info {
  font-size: var(--text-xs);
  color: var(--t3);
  font-variant-numeric: tabular-nums;
}
</style>
