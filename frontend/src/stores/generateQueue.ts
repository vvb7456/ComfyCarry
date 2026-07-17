import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import type {
  ComfyQueueResponse,
  ComfyHistoryItem,
  ComfyHistoryResponse,
} from '@/types/comfyui'

type QueueItem = [number, string, Record<string, unknown>, ...unknown[]]

/**
 * 队列/历史数据层 (规格 E1) — 生成工作台 ws 回调 + QueuePanel/HistoryPanel 共享 store。
 * - queue: 实时刷新 (ws status / 完成事件 / 抽屉打开均触发 loadQueue)
 * - history: 一次拉 max_items=200 (ComfyUI /history 无 offset), 渲染层分页 (E4)
 *   完成事件时: 抽屉开着 → loadHistory; 关着 → markHistoryDirty, 首开抽屉再 load
 * - historySortAsc 由 HistoryPanel 双向绑定; loadHistory 按其值对 API 响应排序
 */
export const useGenerateQueueStore = defineStore('generateQueue', () => {
  const { get } = useApiFetch()

  // ── Queue ──
  const queueRunning = ref<QueueItem[]>([])
  const queuePending = ref<QueueItem[]>([])
  const queueCount = computed(() => queueRunning.value.length + queuePending.value.length)

  async function loadQueue() {
    const d = await get<ComfyQueueResponse>('/api/comfyui/queue')
    if (!d) return
    queueRunning.value = (d.queue_running || []) as QueueItem[]
    queuePending.value = (d.queue_pending || []) as QueueItem[]
  }

  // ── History ──
  const historyItems = ref<ComfyHistoryItem[]>([])
  const historyLoaded = ref(false)
  const historyDirty = ref(false)
  // 排序方向 (与 HistoryPanel 双向绑定; API 响应默认 desc, sortAsc=true → 反转)
  const historySortAsc = ref(false)

  async function loadHistory() {
    const d = await get<ComfyHistoryResponse>('/api/comfyui/history?max_items=200')
    if (!d) return
    const items = d.history || []
    historyItems.value = historySortAsc.value ? [...items].reverse() : items
    historyLoaded.value = true
    historyDirty.value = false
  }

  function markHistoryDirty() {
    historyDirty.value = true
  }

  return {
    queueRunning,
    queuePending,
    queueCount,
    loadQueue,
    historyItems,
    historyLoaded,
    historyDirty,
    historySortAsc,
    loadHistory,
    markHistoryDirty,
  }
})
