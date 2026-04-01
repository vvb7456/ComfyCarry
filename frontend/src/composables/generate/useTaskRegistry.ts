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

    // Update task status based on event type
    if (event.type === 'execution_start') task.status = 'running'
    else if (event.type === 'execution_done') task.status = 'done'
    else if (event.type === 'execution_error' || event.type === 'execution_interrupted') task.status = 'error'

    return { target: task }
  }

  function getMainTask(): TaskEntry | null {
    for (const task of tasks.value.values()) {
      if (task.type === 'main' && (task.status === 'pending' || task.status === 'running')) return task
    }
    return null
  }

  function cleanup() {
    const now = Date.now()
    for (const [id, task] of tasks.value) {
      if ((task.status === 'done' || task.status === 'error') && now - task.startedAt > 30_000) {
        tasks.value.delete(id)
      }
    }
  }

  return { tasks, registerTask, routeEvent, getMainTask, cleanup }
}
