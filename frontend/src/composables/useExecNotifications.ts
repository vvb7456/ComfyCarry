import { onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useTaskRegistry } from '@/composables/generate/useTaskRegistry'
import { useBackgroundRunStore } from '@/stores/backgroundRun'

/**
 * 执行终态通知器 —— App 级常驻, 全站唯一的"生成完成 / 中断 / 出错"出口。
 *
 * 为什么独立于页面存在:
 *   此前 ComfyUI 页与生成页各自订阅 /api/comfyui/events 并各自 toast, 同一事件
 *   弹两条; 而生成页被 KeepAlive 常驻, 切页后仍会从不可见的页面弹提示。
 *   通知属于"无人发起、由后台事件产生"的应用级反馈, 不该挂靠在页面生命周期上
 *   (页面可见/被缓存 ≠ 该不该提示), 所以这里自带一条 EventSource, 与页面无关。
 *
 * 它不需要 ExecTracker: 后端 bridge 已在 execution_done 里带上 prompt_id 与
 * elapsed, interrupted / error 也带 prompt_id —— 只消费终态事件即可。
 *
 * 三条规则 (与页面无关, 只与事件上下文有关):
 *   1. 幂等: prompt_id + 事件类型 在 TTL 内只弹一次 (多订阅者 / 重连重放兜底)。
 *   2. 辅助任务 (预处理 / 打标) 不是"生成", 不报完成 —— 查全局 taskRegistry。
 *   3. 后台运行中 / 刚手动停止 → 由浮动条统一汇报, 不逐轮弹。
 *
 * 页面只负责各自的可视化 (进度条 / 预览 / 队列 / live 续跑), 不再自己 toast 终态。
 */
const TERMINAL_TYPES = new Set(['execution_done', 'execution_interrupted', 'execution_error'])

/** 同一 (prompt_id, 事件类型) 的去重窗口。重连补发 / 多订阅者都落在这之内。 */
const DEDUPE_TTL_MS = 10_000

const RECONNECT_DELAY_MS = 3000

interface BridgeEvent {
  type?: string
  data?: Record<string, unknown>
}

export function useExecNotifications() {
  const { t } = useI18n({ useScope: 'global' })
  const { toast } = useToast()
  const registry = useTaskRegistry()
  const bg = useBackgroundRunStore()

  /** key → 首次见到的时间戳; 顺带做 TTL 清理, 避免长跑中无限增长 */
  const notifiedAt = new Map<string, number>()

  function seenRecently(key: string): boolean {
    const now = Date.now()
    for (const [k, ts] of notifiedAt) {
      if (now - ts > DEDUPE_TTL_MS) notifiedAt.delete(k)
    }
    if (notifiedAt.has(key)) return true
    notifiedAt.set(key, now)
    return false
  }

  function handleEvent(event: BridgeEvent) {
    const type = event.type || ''
    if (!TERMINAL_TYPES.has(type)) return

    const data = event.data || {}
    const promptId = (data.prompt_id as string) || ''
    if (seenRecently(`${type}:${promptId}`)) return

    // 辅助任务 (预处理 / 打标) 的终态不是"生成完成"
    const kind = promptId ? registry.taskType(promptId) : null
    if (kind && kind !== 'main') return

    // 后台运行: 每轮都弹会攒几百条, 由 BackgroundRunBar 的 stop_reason 统一汇报;
    // 手动停止的静默窗由 store 兜住 (state 与事件到达顺序是竞态)。
    if (bg.state === 'running' || bg.recentlyStopped()) return

    if (type === 'execution_done') {
      const elapsed = data.elapsed ? ` (${data.elapsed}s)` : ''
      toast(`${t('comfyui.msg.gen_complete')}${elapsed}`, 'success')
    } else if (type === 'execution_interrupted') {
      toast(t('comfyui.msg.exec_interrupted'), 'warning')
    } else {
      toast(t('comfyui.msg.exec_error'), 'error')
    }
  }

  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function start() {
    stop()
    source = new EventSource('/api/comfyui/events')
    source.onmessage = (e) => {
      try {
        handleEvent(JSON.parse(e.data) as BridgeEvent)
      } catch { /* ignore malformed events */ }
    }
    source.onerror = () => {
      source?.close()
      source = null
      reconnectTimer = setTimeout(start, RECONNECT_DELAY_MS)
    }
  }

  function stop() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (source) { source.close(); source = null }
  }

  onUnmounted(stop)
  start()

  return { stop }
}
