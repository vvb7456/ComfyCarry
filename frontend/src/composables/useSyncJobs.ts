import { ref, onUnmounted, type Ref } from 'vue'
import { useApiFetch } from './useApiFetch'

// ── Types ────────────────────────────────────────────────────

export interface SyncJobSummary {
  bytes?: number          // total bytes transferred
  speed?: number          // average speed (bytes/s)
  transfers?: number      // total file transfers
  files?: string[]        // transferred file names (max 50)
  errors?: number
}

export interface SyncJob {
  job_id: string
  trigger_type: string   // manual | watch | deploy
  trigger_ref: string | null
  status: string         // running | success | failed | partial | cancelled
  rule_count: number
  success_count: number
  failure_count: number
  files_synced: number
  summary: SyncJobSummary | null
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
}

interface JobDetailResponse {
  job: SyncJob
  events: SyncJobEvent[]
}

// ── Composable ───────────────────────────────────────────────

export function useSyncJobs(opts?: { pollInterval?: number }) {
  const { get } = useApiFetch()

  const jobs: Ref<SyncJob[]> = ref([])
  const currentJobId: Ref<string | null> = ref(null)
  const loading = ref(false)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const pollMs = opts?.pollInterval ?? 10_000

  // ── Fetch recent jobs list ──
  async function fetchJobs(limit = 20) {
    loading.value = true
    try {
      const d = await get<JobsListResponse>(`/api/sync/jobs?limit=${limit}`)
      if (d) {
        jobs.value = d.jobs
        currentJobId.value = d.current_job_id
      }
    } finally {
      loading.value = false
    }
  }

  // ── Fetch single job detail + events ──
  async function fetchJobDetail(jobId: string, afterId = 0, limit = 500) {
    return get<JobDetailResponse>(`/api/sync/jobs/${jobId}?after_id=${afterId}&limit=${limit}`)
  }

  // ── Polling ──
  function startPolling() {
    stopPolling()
    fetchJobs()
    pollTimer = setInterval(fetchJobs, pollMs)
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
    fetchJobs,
    fetchJobDetail,
    startPolling,
    stopPolling,
  }
}
