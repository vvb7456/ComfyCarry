import { onScopeDispose, ref } from 'vue'
import type { QueueStatusResponse } from '@/types/plugins'

interface UsePluginQueueOptions {
  get: <T>(url: string) => Promise<T | null>
  formatStatus: (done: number, total: number) => string
  onIdle?: () => void | Promise<void>
}

export function usePluginQueue({ get, formatStatus, onIdle }: UsePluginQueueOptions) {
  const queueProcessing = ref(false)
  const queueStatus = ref('')

  let queuePollTimer: ReturnType<typeof setInterval> | null = null

  async function pollQueue() {
    const data = await get<QueueStatusResponse>('/api/plugins/queue_status')
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
