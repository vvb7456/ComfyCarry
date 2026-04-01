import { ref, onUnmounted } from 'vue'

export interface ComfyEvent {
  type: string
  data: Record<string, unknown>
}

export interface EventResult {
  finished?: boolean
  type?: string
  data?: Record<string, unknown>
}

export interface ExecProgress {
  value: number
  max: number
  percent: number
}

export interface ExecState {
  promptId: string
  startTime: number       // ms timestamp
  currentNode: string
  nodeNames: Record<string, string>   // nodeId → class_type
  totalNodes: number
  executedNodes: Set<string>
  cachedNodes: Set<string>
  progress: ExecProgress | null
}

/**
 * ComfyUI execution state machine composable.
 * Tracks execution_start → progress → executing → done events.
 *
 * Bridge event data formats:
 *   execution_start:  { prompt_id, start_time (unix s), node_names: {nodeId: classType} }
 *   execution_snapshot: { ..., executed_nodes: [], cached_nodes: [], current_node }
 *   progress:         { value, max, percent, node, prompt_id }
 *   executing:        { node, class_type?, prompt_id? }
 *   execution_cached: { nodes: [nodeId, ...] }
 *   execution_done:   { prompt_id, elapsed }
 */
export function useExecTracker() {
  const state = ref<ExecState | null>(null)
  const elapsed = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  function startTimer() {
    stopTimer()
    timer = setInterval(() => {
      if (state.value) {
        elapsed.value = Date.now() - state.value.startTime
      }
    }, 1000)
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null }
    elapsed.value = 0
  }

  /**
   * Fetch node_names from queue API when bridge didn't provide them.
   */
  function fetchNodeNames(promptId: string) {
    fetch('/api/comfyui/queue').then(r => r.json()).then((qData: { queue_running?: unknown[][] }) => {
      if (!state.value || state.value.promptId !== promptId) return
      for (const item of (qData.queue_running || [])) {
        if (item[1] === promptId && item[2]) {
          for (const [nid, ndata] of Object.entries(item[2] as Record<string, Record<string, unknown>>)) {
            if (typeof ndata === 'object' && ndata.class_type) {
              state.value.nodeNames[nid] = ndata.class_type as string
            }
          }
          state.value.totalNodes = Object.keys(state.value.nodeNames).length
          break
        }
      }
    }).catch(() => {})
  }

  function handleEvent(event: ComfyEvent): EventResult | void {
    const { type, data } = event

    switch (type) {
      case 'execution_start':
      case 'execution_snapshot': {
        // Bridge sends node_names as { nodeId: classType } map
        const nodeNames = (data.node_names || {}) as Record<string, string>
        const totalNodes = Object.keys(nodeNames).length
        const promptId = data.prompt_id as string || ''

        state.value = {
          promptId,
          // Use bridge's start_time (unix seconds) with ms conversion; fallback to now
          startTime: typeof data.start_time === 'number' ? data.start_time * 1000 : Date.now(),
          currentNode: type === 'execution_snapshot' ? (data.current_node as string || '') : '',
          nodeNames,
          totalNodes,
          executedNodes: new Set((data.executed_nodes || []) as string[]),
          cachedNodes: new Set((data.cached_nodes || []) as string[]),
          progress: null,
        }

        // When no node names provided, fetch from queue API
        if (totalNodes === 0 && promptId) {
          fetchNodeNames(promptId)
        }

        elapsed.value = Date.now() - state.value.startTime
        startTimer()
        break
      }

      case 'progress':
        if (state.value) {
          const val = data.value as number
          const max = data.max as number
          state.value.progress = {
            value: val,
            max,
            percent: (data.percent as number) ?? (max > 0 ? Math.round(val / max * 100) : 0),
          }
        }
        break

      case 'executing':
        if (state.value && data.node) {
          const node = data.node as string
          state.value.currentNode = node
          state.value.executedNodes.add(node)
          if (data.class_type) state.value.nodeNames[node] = data.class_type as string
          // Clear step progress when switching nodes (matching legacy behavior)
          state.value.progress = null
        }
        break

      case 'execution_cached':
        if (state.value && data.nodes) {
          (data.nodes as string[]).forEach((n: string) => state.value!.cachedNodes.add(n))
        }
        break

      case 'execution_done':
      case 'execution_error':
      case 'execution_interrupted': {
        const result = { finished: true, type, data }
        state.value = null
        stopTimer()
        return result
      }

      case 'ws_disconnected':
        state.value = null
        stopTimer()
        break
    }
  }

  function destroy() {
    state.value = null
    stopTimer()
  }

  onUnmounted(destroy)

  return { state, elapsed, handleEvent, destroy }
}
