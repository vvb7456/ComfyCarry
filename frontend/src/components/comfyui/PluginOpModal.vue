<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { usePluginEvents } from '@/composables/usePluginEvents'
import type { CMQueueStatusData, QueueStatusResponse } from '@/types/plugins'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'PluginOpModal' })

export interface PluginOpRequest {
  title: string
  kind: 'install' | 'uninstall' | 'update' | 'toggle' | 'git'
  endpoint: string
  payload: Record<string, unknown>
}

type Phase = 'idle' | 'running' | 'done' | 'failed' | 'timeout'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  finished: [ok: boolean]
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const WAIT_LIMIT_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 2000

const phase = ref<Phase>('idle')
const opTitle = ref('')
const opKind = ref<PluginOpRequest['kind']>('install')
const queueLabel = ref('')
const errorMsg = ref('')
const restartReady = ref(false)

let uiId = ''
let pollTimer: ReturnType<typeof setInterval> | null = null
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let startedAt = 0

/** SSE 事件源: cm_queue_status (bridge 转发) — open 订阅, 收尾断开 (幂等) */
const { start: startEvents, stop: stopEvents } = usePluginEvents(onQueueEvent)

const kindLabel = computed(() => t(`plugins.op.kind.${opKind.value}`))
const runningLabel = computed(() => t(`plugins.op.running.${opKind.value}`, { name: opTitle.value }))
const doneLabel = computed(() => t('plugins.op.done', {
  name: opTitle.value,
  kind_verb: t(`plugins.op.kind_verb.${opKind.value}`),
}))
const failedLabel = computed(() => t('plugins.op.failed', {
  name: opTitle.value,
  kind: kindLabel.value,
}))
const isTerminal = computed(() => phase.value === 'done' || phase.value === 'failed')

async function open(req: PluginOpRequest): Promise<void> {
  const isVersionSwitch = req.kind === 'install'
    && req.payload.selected_version !== undefined
    && req.payload.selected_version !== 'latest'
  const message = isVersionSwitch
    ? t('plugins.op.confirm.switch_version', { plugin: req.title })
    : t('plugins.op.confirm.message', {
      action: t(`plugins.op.confirm.action.${req.kind}`),
      plugin: req.title,
    })
  const ok = await confirm({
    title: t('plugins.op.confirm.title'),
    message,
    confirmText: t('common.btn.confirm'),
    cancelText: t('common.btn.cancel'),
    variant: req.kind === 'uninstall' ? 'danger' : 'default',
  })
  if (!ok) return
  opTitle.value = req.title
  opKind.value = req.kind
  errorMsg.value = ''
  restartReady.value = false
  phase.value = 'running'
  queueLabel.value = ''
  startEvents()
  emit('update:modelValue', true)
  await run(req)
}

async function run(req: PluginOpRequest): Promise<void> {
  uiId = crypto?.randomUUID?.() ?? `dash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  startedAt = Date.now()

  const d = await post<Record<string, unknown>>(req.endpoint, { ...req.payload, ui_id: uiId })
  if (!d) {
    // 非 2xx 已由 useApiFetch 统一提示; 弹窗就地显示失败态
    fail('')
    return
  }
  startWaiting()
}

function startWaiting(): void {
  stopTimers()
  pollTimer = setInterval(() => { void pollOnce() }, POLL_INTERVAL_MS)
  elapsedTimer = setInterval(() => {
    if (Date.now() - startedAt >= WAIT_LIMIT_MS) {
      stopTimers()
      phase.value = 'timeout'
    }
  }, 1000)
}

async function pollOnce(): Promise<void> {
  const data = await get<QueueStatusResponse>('/api/plugins/queue_status', { silent: true })
  if (!data) return
  if (data.is_processing && data.total_count) {
    queueLabel.value = t('plugins.op.queue_progress', {
      done: data.done_count ?? 0,
      total: data.total_count,
    })
    return
  }
  // 队列空闲: 结果判定交给 SSE 事件的 nodepack_result;
  // 但 SSE 可能断线 — 轮询兜底: 队列回空闲即收尾 (成败经 pending_restart diff 实证)
  queueLabel.value = ''
  finish()
}

/** SSE 事件入口 (cm_queue_status): done 且本 ui_id 出结果 */
async function onQueueEvent(data: CMQueueStatusData): Promise<void> {
  if (phase.value !== 'running') return
  if (data.status !== 'done') return
  const result = data.nodepack_result?.[uiId]
  if (result === undefined) return
  stopTimers()
  phase.value = 'idle' // 立即退出 running, 防 await 期间重复事件重入
  if (result === 'success' || result === 'skip') {
    await checkRestart()
    succeed()
  } else {
    fail(result)
  }
}

/** 轮询兜底收尾: 无法区分成败 (结果事件丢失) → 拉待重启 diff 实证 */
async function finish(): Promise<void> {
  stopTimers()
  await checkRestart()
  succeed()
}

async function checkRestart(): Promise<void> {
  const pr = await get<{ needs_restart?: boolean }>('/api/plugins/pending_restart', { silent: true })
  restartReady.value = !!pr?.needs_restart
}

function succeed(): void {
  phase.value = 'done'
}

function fail(message: string): void {
  stopTimers()
  errorMsg.value = message || t('plugins.op.unknown_error')
  phase.value = 'failed'
}

function stopTimers(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
  stopEvents()
}

/** 关闭弹窗 (终态才可关); 结束后刷新列表 */
function close(ok: boolean): void {
  stopTimers()
  phase.value = 'idle'
  emit('finished', ok)
  emit('update:modelValue', false)
}

/** timeout 态: 继续等待 (重置计时; 超时收尾时 stopTimers 断了 SSE, 这里重接) */
function waitMore(): void {
  startedAt = Date.now()
  phase.value = 'running'
  startEvents()
  startWaiting()
}

/** timeout 态: 后台继续 — 任务仍在跑, 不再等待 (如实告知, 非取消) */
function goBackground(): void {
  toast(t('plugins.op.background_notice'), 'info')
  close(false)
}

/** done 态: 有待重启变更 → 重启 ComfyUI; 无 → 直接关闭 */
async function onDoneAction(): Promise<void> {
  if (restartReady.value) {
    // 重启请求失败时弹窗留在原地 (失败 toast 已由 useApiFetch 发出),
    // 用户可再次点按钮或稍后从 ComfyUI 页手动重启
    if (!await restartComfyUI()) return
  }
  close(true)
}

/** 后台重启 ComfyUI: 不阻塞当前页, 有界等待恢复后 toast。返回请求是否成功发出 */
async function restartComfyUI(): Promise<boolean> {
  const d = await post('/api/comfyui/restart', {})
  if (!d) return false
  toast(t('plugins.restart.restarting'), 'info')
  // 后台有界等待恢复 (冷启动 30s+); 3 分钟上限
  void (async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const s = await get<{ online?: boolean }>('/api/comfyui/status', { silent: true })
      if (s?.online) {
        toast(t('plugins.restart.done'), 'success')
        return
      }
    }
    toast(t('plugins.restart.timeout'), 'error')
  })()
  return true
}

watch(() => props.modelValue, (open_) => {
  if (!open_) stopTimers()
})

onBeforeUnmount(stopTimers)

defineExpose({ open })
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('plugins.op.title')"
    icon="extension"
    width="480px"
    :persistent="!isTerminal"
    :close-on-overlay="isTerminal"
    :close-on-esc="isTerminal"
    :show-close="isTerminal"
    @update:model-value="v => { if (v === false) close(false) }"
  >
    <div v-if="phase === 'running'" class="op-body">
      <Spinner size="lg" />
      <p class="op-line">{{ runningLabel }}</p>
      <p v-if="queueLabel" class="op-sub">{{ queueLabel }}</p>
      <p v-else class="op-sub">{{ t('plugins.op.running_hint') }}</p>
    </div>

    <div v-else-if="phase === 'timeout'" class="op-body">
      <MsIcon name="hourglass_top" size="xl" color="var(--c-caution, #e8a33d)" />
      <p class="op-line">{{ t('plugins.op.timeout_title') }}</p>
      <p class="op-sub">{{ t('plugins.op.timeout_desc') }}</p>
    </div>

    <div v-else-if="phase === 'done'" class="op-body">
      <MsIcon name="check_circle" size="xl" color="var(--green)" />
      <p class="op-line">{{ doneLabel }}</p>
      <p v-if="restartReady" class="op-sub">{{ t('plugins.op.restart_hint') }}</p>
    </div>

    <div v-else-if="phase === 'failed'" class="op-body">
      <MsIcon name="error_outline" size="xl" color="var(--red)" />
      <p class="op-line">{{ failedLabel }}</p>
      <p v-if="errorMsg" class="op-sub op-sub--err">{{ errorMsg }}</p>
    </div>

    <template #footer>
      <template v-if="phase === 'timeout'">
        <BaseButton @click="goBackground">{{ t('plugins.op.go_background') }}</BaseButton>
        <BaseButton variant="primary" @click="waitMore">{{ t('plugins.op.wait_more') }}</BaseButton>
      </template>
      <BaseButton v-else-if="phase === 'done'" variant="primary" @click="onDoneAction">
        {{ restartReady ? t('plugins.op.restart_now') : t('common.btn.done') }}
      </BaseButton>
      <BaseButton v-else-if="phase === 'failed'" @click="close(false)">{{ t('common.btn.close') }}</BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.op-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-4) var(--sp-3);
  text-align: center;
  min-height: 140px;
  justify-content: center;
}

.op-line {
  margin: 0;
  color: var(--t1);
  font-size: var(--text-md);
  font-weight: 500;
}

.op-sub {
  margin: 0;
  color: var(--t3);
  font-size: var(--text-sm);
  max-width: 40ch;
}

.op-sub--err {
  color: var(--red);
  word-break: break-word;
}
</style>