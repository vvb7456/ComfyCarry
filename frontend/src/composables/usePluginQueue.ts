import { onScopeDispose, ref } from 'vue'
import type { QueueStatusResponse } from '@/types/plugins'

interface UsePluginQueueOptions {
  /** 轮询请求一律静默 —— 队列状态是后台探测, 失败由行级状态/列表兜底 */
  get: <T>(url: string, opts?: { silent?: boolean }) => Promise<T | null>
  formatStatus: (done: number, total: number) => string
  onIdle?: () => void | Promise<void>
}

export function usePluginQueue({ get, formatStatus, onIdle }: UsePluginQueueOptions) {
  const queueProcessing = ref(false)
  const queueStatus = ref('')

  let queuePollTimer: ReturnType<typeof setInterval> | null = null

  async function pollQueue() {
    const data = await get<QueueStatusResponse>('/api/plugins/queue_status', { silent: true })
    if (!data) return

    if (data.is_processing && data.total_count && data.total_count > 0) {
      queueProcessing.value = true
      queueStatus.value = formatStatus(data.done_count ?? 0, data.total_count ?? 0)
      return
    }

    queueProcessing.value = false
    queueStatus.value = ''

    if (queuePollTimer) {
      stopQueuePoll()
      await onIdle?.()
    }
  }

  function startQueuePoll() {
    void pollQueue()
    if (queuePollTimer) clearInterval(queuePollTimer)
    queuePollTimer = setInterval(() => {
      void pollQueue()
    }, 2000)
  }

  function stopQueuePoll() {
    if (!queuePollTimer) return
    clearInterval(queuePollTimer)
    queuePollTimer = null
  }

  onScopeDispose(() => {
    stopQueuePoll()
  })

  return {
    queueProcessing,
    queueStatus,
    pollQueue,
    startQueuePoll,
    stopQueuePoll,
  }
}
