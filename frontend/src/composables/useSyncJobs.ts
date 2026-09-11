import { ref, onUnmounted, type Ref } from 'vue'
import { useApiFetch } from './useApiFetch'

// ── Types ────────────────────────────────────────────────────

/** 任务执行时的规则展示快照 (规则被编辑/删除后历史仍可回看) */
export interface SyncJobRuleSnapshot {
  id: string
  name: string
  direction: 'pull' | 'push'
  method: 'copy' | 'sync' | 'move'
  remote: string
  remote_path: string
  local_path: string
  trigger: 'manual' | 'deploy' | 'watch'
}

export interface SyncJobSummary {
  bytes?: number          // total bytes transferred
  speed?: number          // average speed (bytes/s)
  transfers?: number      // total file transfers
  files?: string[]        // transferred file names (max 50)
  errors?: number
}

export interface SyncJob {
  job_id: string
  trigger_type: string   // manual | watch | deploy | companion
  trigger_ref: string | null
  status: string         // running | success | failed | partial | cancelled
  rule_count: number
  success_count: number
  failure_count: number
  files_synced: number
  summary: SyncJobSummary | null
  /** 执行时规则快照; 旧库未补 rules_json 列的历史行可能缺失 */
  rules?: SyncJobRuleSnapshot[]
  started_at: number
  finished_at: number | null
}

export interface SyncJobEvent {
  id: number
  job_id: string
  rule_id: string | null
  level: string          // info | warn | error | success
  key: string
  params: Record<string, unknown> | null
  created_at: number
}

interface JobsListResponse {
  jobs: SyncJob[]
  current_job_id: string | null
  page: number
  limit: number
  total: number
}

interface JobDetailResponse {
  job: SyncJob
  events: SyncJobEvent[]
}

// ── Composable ───────────────────────────────────────────────

export function useSyncJobs(opts?: { pollInterval?: number; pageSize?: number }) {
  const { get } = useApiFetch()

  const jobs: Ref<SyncJob[]> = ref([])
  const currentJobId: Ref<string | null> = ref(null)
  const loading = ref(false)
  const page: Ref<number> = ref(1)
  const pageSize: Ref<number> = ref(opts?.pageSize ?? 5)
  const total = ref(0)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const pollMs = opts?.pollInterval ?? 10_000

  // 请求序号: 并发请求时只采纳最后一次发出的结果, 避免慢响应覆盖用户新选中的页
  let reqSeq = 0

  // ── Fetch a page from server ──
  async function fetchPage(target: number = page.value) {
    const seq = ++reqSeq
    const requested = Math.max(1, Math.floor(target) || 1)
    loading.value = true
    try {
      const d = await get<JobsListResponse>(
        `/api/sync/jobs?page=${requested}&limit=${pageSize.value}`,
      )
      if (seq !== reqSeq || !d) return
      jobs.value = d.jobs
      currentJobId.value = d.current_job_id
      // 以服务端归一化后的页码为准 (空集合 / 越界会回落到有效页)
      page.value = d.page
      total.value = d.total
      // 服务端把请求归一到第一页时, 恢复自动轮询
      if (page.value === 1) ensurePolling()
    } finally {
      if (seq === reqSeq) loading.value = false
    }
  }

  /** 兼容旧调用方: 拉取第一页 (参数已由 pageSize 取代) */
  function fetchJobs() {
    return fetchPage(1)
  }

  /** 刷新当前页 */
  function refresh() {
    return fetchPage(page.value)
  }

  /**
   * 切换到指定页。
   * 第 1 页立即刷新并恢复轮询; 第 2 页及之后仅拉取一次, 停止轮询以保持阅读位置。
   */
  function goToPage(target: number) {
    const p = Math.max(1, Math.floor(target) || 1)
    if (p === page.value) return
    if (p === 1) {
      startPolling()
    } else {
      stopPolling()
      fetchPage(p)
    }
  }

  // ── Fetch single job detail + events (独立于页码) ──
  async function fetchJobDetail(jobId: string, afterId = 0, limit = 500) {
    return get<JobDetailResponse>(`/api/sync/jobs/${jobId}?after_id=${afterId}&limit=${limit}`)
  }

  /** 读取当前运行任务详情 (Hero 用, 不受历史页码影响) */
  async function fetchCurrentJobDetail(afterId = 0, limit = 500) {
    if (!currentJobId.value) return null
    return fetchJobDetail(currentJobId.value, afterId, limit)
  }

  // ── Polling ──
  function ensurePolling() {
    if (pollTimer) return
    pollTimer = setInterval(() => { fetchPage(1) }, pollMs)
  }

  function startPolling() {
    stopPolling()
    page.value = 1
    fetchPage(1)
    pollTimer = setInterval(() => { fetchPage(1) }, pollMs)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onUnmounted(stopPolling)

  return {
    jobs,
    currentJobId,
    loading,
    page,
    pageSize,
    total,
    fetchPage,
    fetchJobs,
    refresh,
    goToPage,
    fetchJobDetail,
    fetchCurrentJobDetail,
    startPolling,
    stopPolling,
  }
}
