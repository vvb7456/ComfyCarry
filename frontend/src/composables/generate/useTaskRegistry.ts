import { ref } from 'vue'
import type { ComfyEvent } from '@/composables/useExecTracker'

export type TaskType = 'main' | 'preprocess' | 'tag'

export interface TaskEntry {
  promptId: string
  type: TaskType
  subtype?: string // e.g., 'pose', 'canny', 'depth' for preprocess
  status: 'pending' | 'running' | 'done' | 'error'
  startedAt: number
}

/**
 * Multi-task prompt_id registry and event router.
 * Routes SSE events to the correct task based on prompt_id.
 */
export function useTaskRegistry() {
  const tasks = ref(new Map<string, TaskEntry>())

  function registerTask(promptId: string, type: TaskType, subtype?: string) {
    tasks.value.set(promptId, {
      promptId,
      type,
      subtype,
      status: 'pending',
      startedAt: Date.now(),
    })
  }

  function routeEvent(event: ComfyEvent): { target: TaskEntry } | null {
    const promptId = event.data?.prompt_id as string
    if (!promptId) return null

    const task = tasks.value.get(promptId)
    if (!task) return null

    // Update task status based on event type.
    // 非终态事件一律把 pending 提升为 running: 注册可能晚于 execution_start
    // (提交响应回到 JS 的时刻与 SSE 事件到达的时刻是竞态), 只认 execution_start
    // 会让任务永久卡在 pending。
    if (event.type === 'execution_done') task.status = 'done'
    else if (event.type === 'execution_error' || event.type === 'execution_interrupted') task.status = 'error'
    else if (task.status === 'pending') task.status = 'running'

    return { target: task }
  }

  function cleanup() {
    const now = Date.now()
    for (const [id, task] of tasks.value) {
      const done = task.status === 'done' || task.status === 'error'
      // 终态 30s 后清理; 未终态的僵尸任务 (排队中被删除的 prompt 等收不到任何
      // 终态事件) 10 分钟后清理, 避免 Map 在长跑中无限增长。
      if (now - task.startedAt > (done ? 30_000 : 600_000)) {
        tasks.value.delete(id)
      }
    }
  }

  return { tasks, registerTask, routeEvent, cleanup }
}
