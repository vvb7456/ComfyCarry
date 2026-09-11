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
 * 多任务 prompt_id 注册表 + 事件路由。
 *
 * 模块级单例 (与 useToast 同一模式), 不再按调用方实例化。
 *
 * 原先状态挂在生成页的组件实例上; 现在 App 级的执行终态通知器
 * (useExecNotifications) 也必须能回答"这个 prompt_id 是主任务还是辅助任务
 * (预处理 / 打标)" —— 否则它会把这些辅助任务的完成误报成"生成完成"。
 * 生成页负责注册, 通知器负责查询, 两边共用这一份 Map。
 */
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

/** 该 prompt_id 的任务类型; 未注册 (ComfyUI 原生 UI 提交等) 返回 null。 */
function taskType(promptId: string): TaskType | null {
  return tasks.value.get(promptId)?.type ?? null
}

export function useTaskRegistry() {
  return { tasks, registerTask, routeEvent, cleanup, taskType }
}
