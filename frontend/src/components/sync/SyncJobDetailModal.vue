<script setup lang="ts">
/**
 * SyncJobDetailModal — 单条同步任务详情 (C07)。
 *
 * 数据来自 /api/sync/jobs/<id>?after_id=0&limit=500: 任务本体 + 事件流。
 * 规则列表使用执行时快照 (job.rules), 规则被编辑/删除后历史仍可回看。
 * 事件超过一批时按最后一条 id 通过 after_id 增量加载。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { fmtBytes } from '@/utils/format'
import type { SyncJob, SyncJobEvent } from '@/composables/useSyncJobs'
import type { IconName } from '@/config/icon-codepoints'

defineOptions({ name: 'SyncJobDetailModal' })

const props = defineProps<{
  modelValue: boolean
  jobId: string | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t, te } = useI18n({ useScope: 'global' })
const { get } = useApiFetch()

const EVENT_BATCH = 500

const job = ref<SyncJob | null>(null)
const events = ref<SyncJobEvent[]>([])
const loading = ref(false)
const loadingMore = ref(false)
/** 事件流已读完 (某批不足 EVENT_BATCH 即到头) */
const eventsExhausted = ref(false)

interface JobDetailResponse {
  job: SyncJob
  events: SyncJobEvent[]
}

async function loadDetail(): Promise<void> {
  if (!props.jobId) return
  loading.value = true
  job.value = null
  events.value = []
  eventsExhausted.value = false
  try {
    const d = await get<JobDetailResponse>(`/api/sync/jobs/${props.jobId}?after_id=0&limit=${EVENT_BATCH}`)
    if (!d) return
    job.value = d.job
    events.value = d.events || []
    eventsExhausted.value = events.value.length < EVENT_BATCH
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.jobId] as const,
  ([open]) => { if (open) void loadDetail() },
)

const hasMoreEvents = computed(() => !eventsExhausted.value && events.value.length > 0)

async function loadMoreEvents(): Promise<void> {
  if (!props.jobId || !events.value.length) return
  const lastId = events.value[events.value.length - 1].id
  loadingMore.value = true
  try {
    const d = await get<JobDetailResponse>(`/api/sync/jobs/${props.jobId}?after_id=${lastId}&limit=${EVENT_BATCH}`)
    const batch = d?.events ?? []
    if (batch.length) events.value = [...events.value, ...batch]
    if (batch.length < EVENT_BATCH) eventsExhausted.value = true
  } finally {
    loadingMore.value = false
  }
}

// ── 展示格式化 ──

function statusTone(status: string): 'positive' | 'caution' | 'negative' | 'neutral' {
  if (status === 'success') return 'positive'
  if (status === 'failed') return 'negative'
  if (status === 'running' || status === 'partial') return 'caution'
  return 'neutral'
}

function statusText(status: string): string {
  const key = `sync.job.status.${status}`
  return te(key) ? t(key) : status
}

function triggerText(trigger: string): string {
  const key = `sync.job.trigger.${trigger}`
  return te(key) ? t(key) : trigger
}

function directionIcon(direction: string): IconName {
  return direction === 'push' ? 'arrow_upward' : 'arrow_downward'
}

function fmtTime(epoch?: number | null): string {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toLocaleString()
}

function fmtDuration(started?: number, finished?: number | null): string {
  if (!started || !finished) return '—'
  const sec = Math.max(0, Math.round(finished - started))
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}

function fmtSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '—'
  return `${fmtBytes(bytesPerSec)}/s`
}

const files = computed(() => job.value?.summary?.files ?? [])

/** 事件行: 复用 sync.log.* 的 key + params 文案 (缺条目时原样显示 key) */
const eventRows = computed(() => events.value.map(e => ({
  id: e.id,
  time: new Date(e.created_at * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  level: e.level,
  text: te(`sync.log.${e.key}`)
    ? t(`sync.log.${e.key}`, (e.params || {}) as Record<string, unknown>)
    : e.key,
})))
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('sync.detail.title')"
    size="lg"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="loading" class="detail-loading">
      <Spinner size="md" />
      <span>{{ t('common.loading') }}</span>
    </div>

    <div v-else-if="job" class="detail">
      <!-- 状态 + 触发 -->
      <div class="detail-status">
        <Badge :tone="statusTone(job.status)">{{ statusText(job.status) }}</Badge>
        <span class="detail-trigger">
          {{ t('sync.detail.trigger') }}
          <b>{{ triggerText(job.trigger_type) }}</b>
        </span>
      </div>

      <!-- 汇总 -->
      <dl class="detail-dl">
        <dt>{{ t('sync.detail.started') }}</dt>
        <dd>{{ fmtTime(job.started_at) }}</dd>
        <dt>{{ t('sync.detail.finished') }}</dt>
        <dd>{{ fmtTime(job.finished_at) }}</dd>
        <dt>{{ t('sync.detail.duration') }}</dt>
        <dd>{{ fmtDuration(job.started_at, job.finished_at) }}</dd>
        <dt>{{ t('sync.detail.files') }}</dt>
        <dd>{{ job.files_synced }}</dd>
        <dt>{{ t('sync.detail.size') }}</dt>
        <dd>{{ job.summary ? fmtBytes(job.summary.bytes ?? 0) : '—' }}</dd>
        <dt>{{ t('sync.detail.speed') }}</dt>
        <dd>{{ fmtSpeed(job.summary?.speed) }}</dd>
      </dl>

      <!-- 规则快照 -->
      <section class="detail-section">
        <h4 class="detail-section__title">{{ t('sync.detail.rules') }}</h4>
        <ul v-if="(job.rules ?? []).length" class="detail-rules">
          <li v-for="r in job.rules" :key="r.id" class="detail-rule">
            <MsIcon :name="directionIcon(r.direction)" size="sm" class="detail-rule__dir" />
            <div class="detail-rule__main">
              <div class="detail-rule__name">{{ r.name || r.id }}</div>
              <div class="detail-rule__path mono">
                {{ r.remote }}:{{ r.remote_path }} → {{ r.local_path }}
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="detail-muted">{{ job.rule_count }}</p>
      </section>

      <!-- 文件清单 -->
      <section v-if="files.length" class="detail-section">
        <h4 class="detail-section__title">{{ t('sync.detail.file_list') }}</h4>
        <div class="detail-files">
          <span v-for="(f, i) in files" :key="i" class="detail-file mono">{{ f }}</span>
        </div>
      </section>

      <!-- 事件 -->
      <section class="detail-section">
        <h4 class="detail-section__title">{{ t('sync.detail.events') }}</h4>
        <ul v-if="eventRows.length" class="detail-events">
          <li v-for="e in eventRows" :key="e.id" class="detail-event" :class="`level-${e.level}`">
            <span class="detail-event__time">{{ e.time }}</span>
            <span class="detail-event__text">{{ e.text }}</span>
          </li>
        </ul>
        <p v-else class="detail-muted">{{ t('sync.detail.no_events') }}</p>
        <div v-if="hasMoreEvents" class="detail-more">
          <BaseButton size="sm" :loading="loadingMore" @click="loadMoreEvents">
            {{ t('sync.detail.load_more') }}
          </BaseButton>
        </div>
      </section>
    </div>

    <template #footer>
      <BaseButton @click="emit('update:modelValue', false)">{{ t('common.btn.close') }}</BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--t3);
}

.detail-status {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.detail-trigger {
  font-size: var(--text-sm);
  color: var(--t3);
}

.detail-trigger b {
  margin-left: 6px;
  font-weight: 500;
  color: var(--t2);
}

/* 键值网格: 与设计稿 .cc-dl 同构 */
.detail-dl {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 9px 14px;
  margin: 0;
  font-size: var(--text-sm);
}

.detail-dl dt { color: var(--t3); }
.detail-dl dd { margin: 0; color: var(--t1); overflow-wrap: anywhere; }

.mono { font-family: var(--font-mono); font-size: var(--text-xs); }

.detail-section {
  margin-top: 20px;
  border-top: 1px solid var(--bd);
  padding-top: 14px;
}

.detail-section__title {
  margin: 0 0 10px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--t2);
}

.detail-muted {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--t3);
}

.detail-rules {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-rule {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.detail-rule__dir { color: var(--t3); margin-top: 2px; }

.detail-rule__name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--t1);
}

.detail-rule__path {
  margin-top: 2px;
  color: var(--t3);
  overflow-wrap: anywhere;
}

.detail-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.detail-file {
  color: var(--t2);
  overflow-wrap: anywhere;
}

.detail-events {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-event {
  display: flex;
  gap: 10px;
  font-size: var(--text-xs);
  color: var(--t2);
  padding: 2px 0;
}

.detail-event__time {
  flex: none;
  color: var(--t3);
  font-family: var(--font-tabular);
}

.detail-event__text { overflow-wrap: anywhere; }
.detail-event.level-error .detail-event__text { color: var(--red); }
.detail-event.level-warn .detail-event__text { color: var(--amber); }
.detail-event.level-success .detail-event__text { color: var(--green); }

.detail-more {
  margin-top: 10px;
  display: flex;
  justify-content: center;
}
</style>
