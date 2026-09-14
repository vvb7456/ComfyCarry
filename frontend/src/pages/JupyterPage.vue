<script setup lang="ts">
/**
 * JupyterPage — JupyterLab 单列页 (C06)。
 *
 * 结构: 页头 (停止/重启) → Hero → 运行事实 → 访问令牌 → 活跃内核 → 活跃会话 → 终端 → 日志。
 * 页头只承接运行中的停止与重启; 启动 / 重试 / 打开 JupyterLab 由 Hero 按状态承接。
 *
 * Hero 状态机 (取 status 的 online 与 pm2_status 真实字段):
 *   running(ok)         online=true, 主操作「打开 JupyterLab」(真实链接)
 *   starting(warn+busy) 启动/重启请求进行中, 或 pm2 launching, 无操作
 *   stopped(off)        pm2 stopped, 主操作「启动 JupyterLab」
 *   not_created(off)    pm2 not_found, 主操作「启动 JupyterLab」
 *   failed(bad)         pm2 errored, 主操作「重试」
 *
 * 地址解析沿用原 loadJupyterUrl: 有隧道取隧道入口 (含公共隧道), 无隧道按本机端口直连;
 * 令牌复用 SecretInput。停机时收起令牌与运行对象列表 (状态由 Hero 表达), 日志继续可读。
 *
 * 运行对象统一 ListRow: 内核中断/重启、会话关闭、终端新建/打开/销毁, 操作期间互斥禁用。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import ServiceHero from '@/components/ui/ServiceHero.vue'
import ListRow from '@/components/ui/ListRow.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import type { IconName } from '@/config/icon-codepoints'
import EmptyState from '@/components/ui/EmptyState.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { fmtBytes } from '@/utils/format'
import { apiErrorText, apiMessageText, type ApiErrorBody } from '@/utils/apiError'
import type { JupyterStatus, KernelInfo, SessionInfo, TerminalInfo } from '@/types/jupyter'

defineOptions({ name: 'JupyterPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post, del } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// ─── State ────────────────────────────────────────────────────────────────────

const status = ref<JupyterStatus | null>(null)
const statusLoading = ref(true)
const jupyterUrl = ref('')
const token = ref('')
// 进程重启后 Jupyter 会生成新 token; 置脏后持续重取, 直到拿到非空令牌
const tokenDirty = ref(false)
const actionLoading = ref<'start' | 'stop' | 'restart' | null>(null)
const acting = computed(() => actionLoading.value !== null)

// 新进程下发时刻 (0 = 无待确认启动)。启动/重启成功后置位, 直到 loadStatus
// 拿到不早于该时刻发起的快照才解除; 期间旧的 status 快照 (online/pm2_status)
// 一律不可信, 否则 hero 会闪回 running/stopped。
const pendingStartAt = ref(0)
let pendingStartTimer: ReturnType<typeof setTimeout> | null = null

function markPendingStart() {
  pendingStartAt.value = Date.now()
  if (pendingStartTimer) clearTimeout(pendingStartTimer)
  // 兜底: 轮询持续失败或进程卡死时, 两分钟后交回常规状态机
  pendingStartTimer = setTimeout(() => { pendingStartAt.value = 0 }, 120_000)
}

// 行内操作互斥: 任一内核/会话/终端动作进行中, 其余行操作一并禁用
const kernelPending = ref<string | null>(null)
const sessionPending = ref<string | null>(null)
const terminalPending = ref<string | null>(null)
const anyRowPending = computed(() =>
  kernelPending.value !== null || sessionPending.value !== null || terminalPending.value !== null,
)

type RowStatus = { tone: 'running' | 'stopped' | 'loading' | 'error'; text: string }

// ─── 日志流 ───────────────────────────────────────────────────────────────────

// ── 日志流 ──
const logOpen = ref(true)
const { lines: logLines, status: logStatus, hasMore: logHasMore, loadingMore: logLoadingMore, prepending: logPrepending, onScroll: logOnScroll, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/jupyter/logs',
  streamUrl: '/api/jupyter/logs/stream',
  classify(line) {
    if (/error|exception|traceback/i.test(line)) return 'log-error'
    if (/warn/i.test(line)) return 'log-warn'
    if (/kernel|session/i.test(line)) return 'log-info'
    return ''
  },
})

// ─── 状态判定 ─────────────────────────────────────────────────────────────────

const pm2Status = computed(() => status.value?.pm2_status || 'unknown')
/** 可信的运行态: 快照在线且没有待确认的新进程 */
const isRunning = computed(() => !pendingStartAt.value && !!status.value && (status.value.online || pm2Status.value === 'online'))

// ─── API ──────────────────────────────────────────────────────────────────────

let statusAppliedAt = 0
async function loadStatus() {
  const requestedAt = Date.now()
  const data = await get<JupyterStatus>('/api/jupyter/status', { silent: true })
  if (!data) return
  // 乱序响应保护: 迟到的旧快照不能覆盖新快照
  if (requestedAt < statusAppliedAt) return
  statusAppliedAt = requestedAt
  status.value = data
  statusLoading.value = false
  // 只有在新进程下发之后发起的请求才可信; 在途的旧快照不能解除 pending
  if (pendingStartAt.value && requestedAt >= pendingStartAt.value) pendingStartAt.value = 0
}

/** 有隧道用隧道入口 (自定义 + 公共), 无隧道在 effectiveJupyterUrl 里回落本机直连。 */
async function loadJupyterUrl() {
  const data = await get<{ urls?: Record<string, string>; public?: { urls?: Record<string, string> } }>('/api/tunnel/status', { silent: true })
  if (!data) {
    jupyterUrl.value = ''
    return
  }
  const urls: Record<string, string> = { ...(data.urls || {}), ...(data.public?.urls || {}) }
  for (const [name, url] of Object.entries(urls)) {
    if (name.toLowerCase().includes('jupyter')) {
      jupyterUrl.value = url as string
      return
    }
  }
  jupyterUrl.value = ''
}

/** force=true 时跳过后端缓存重新检测 (重启后必须, 进程可能晚于轮询就绪) */
async function loadToken(force = false) {
  const data = await get<{ token: string }>(`/api/jupyter/token${force ? '?refresh=1' : ''}`, { silent: true })
  if (!data) return
  if (data.token) {
    token.value = data.token
    tokenDirty.value = false
  }
}

const effectiveJupyterUrl = computed(() => {
  if (jupyterUrl.value) return jupyterUrl.value
  // 无隧道时兜底本地直连; 端口取自运行中进程检测 (status.port),
  // 离线时地址不可达, 不显示。
  if (!isRunning.value || !status.value?.port) return ''
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${status.value.port}`
})

/** 打开链接: 本页令牌已确认刷新时才覆盖地址里的 token; 否则保留地址自带 token (隧道地址可能携带更新值)。 */
const jupyterTokenUrl = computed(() => {
  const base = effectiveJupyterUrl.value
  if (!base) return ''
  if (tokenDirty.value || !token.value) return base
  try {
    const u = new URL(base)
    if (u.searchParams.get('token') === token.value) return base
    u.searchParams.set('token', token.value)
    return u.toString()
  } catch {
    if (base.includes('token=')) {
      return base.replace(/([?&])token=[^&]*/, `$1token=${token.value}`)
    }
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}token=${token.value}`
  }
})

/** 事实里只展示主机 (含端口), 完整地址由打开动作承接。 */
const addressHost = computed(() => {
  const url = effectiveJupyterUrl.value
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
})

// ─── Hero 状态机 ──────────────────────────────────────────────────────────────

type HeroState = 'running' | 'starting' | 'stopped' | 'not_created' | 'failed'

const heroState = computed<HeroState>(() => {
  if (actionLoading.value === 'start' || actionLoading.value === 'restart') return 'starting'
  // 新进程已下发但快照尚未更新: 保持启动中, 避免旧 online/pm2_status 造成的闪回
  if (pendingStartAt.value) return 'starting'
  const pm = pm2Status.value
  if (status.value?.online) return 'running'
  if (pm === 'launching') return 'starting'
  if (pm === 'errored') return 'failed'
  if (pm === 'not_found') return 'not_created'
  if (pm === 'online') return 'running'
  return 'stopped'
})

const heroTone = computed(() => ({
  running: 'ok',
  starting: 'warn',
  stopped: 'off',
  not_created: 'off',
  failed: 'bad',
}[heroState.value] as 'ok' | 'warn' | 'off' | 'bad'))

const heroBusy = computed(() => heroState.value === 'starting')
const heroTitle = computed(() => t(`jupyter.hero.${heroState.value}.title`))
const heroSubtitle = computed(() => t(`jupyter.hero.${heroState.value}.subtitle`))
const heroAction = computed<'open' | 'start' | 'retry' | null>(() => {
  if (heroState.value === 'running') return 'open'
  if (heroState.value === 'starting') return null
  if (heroState.value === 'failed') return 'retry'
  return 'start'
})

// ─── 运行事实 ─────────────────────────────────────────────────────────────────

const factsList = computed<{ label: string; value: string }[]>(() => {
  const s = status.value
  if (!s) return []
  const out: { label: string; value: string }[] = []
  // 配置事实: 监听端口停机仍显示
  if (s.port) out.push({ label: t('jupyter.facts.port'), value: String(s.port) })
  if (!isRunning.value) return out
  // 运行期字段随状态显示
  if (addressHost.value) out.push({ label: t('jupyter.facts.address'), value: addressHost.value })
  if (s.version) out.push({ label: t('jupyter.facts.version'), value: `v${s.version}` })
  out.push({ label: t('jupyter.kernels.title'), value: String(s.kernels_count ?? 0) })
  out.push({ label: t('jupyter.sessions.title'), value: String(s.sessions_count ?? 0) })
  out.push({ label: t('jupyter.terminals.title'), value: String(s.terminals_count ?? s.terminals?.length ?? 0) })
  if (s.cpu !== undefined) out.push({ label: t('jupyter.facts.cpu'), value: `${s.cpu.toFixed(1)}%` })
  if (s.memory) out.push({ label: t('jupyter.facts.memory'), value: fmtBytes(s.memory) })
  return out
})

// ─── 运行对象字段 ─────────────────────────────────────────────────────────────

const defaultKernel = computed(() => status.value?.default_kernel || '')
const kernelSpecs = computed(() => status.value?.kernelspecs || [])

function fmtActivity(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString()
}

function kernelStatus(kernel: KernelInfo): RowStatus {
  if (kernel.state === 'idle') return { tone: 'running', text: t('jupyter.kernels.idle') }
  if (kernel.state === 'busy') return { tone: 'loading', text: t('jupyter.kernels.busy') }
  return { tone: 'stopped', text: kernel.state || t('jupyter.kernels.unknown') }
}

function kernelFacts(kernel: KernelInfo): string[] {
  const facts: string[] = []
  if (kernel.connections > 0) facts.push(`${kernel.connections} ${t('jupyter.kernels.connections')}`)
  const activity = fmtActivity(kernel.last_activity)
  if (activity) facts.push(activity)
  return facts
}

function sessionIcon(type: string): IconName {
  if (type === 'notebook') return 'book_2'
  if (type === 'console') return 'terminal'
  return 'description'
}

function sessionStatus(session: SessionInfo): RowStatus | undefined {
  if (session.kernel_state === 'idle') return { tone: 'running', text: t('jupyter.kernels.idle') }
  if (session.kernel_state === 'busy') return { tone: 'loading', text: t('jupyter.kernels.busy') }
  if (session.kernel_state) return { tone: 'stopped', text: session.kernel_state }
  return undefined
}

function sessionFacts(session: SessionInfo): string[] {
  const facts: string[] = []
  if (session.path) facts.push(session.path)
  if (session.kernel_name) facts.push(session.kernel_name)
  return facts
}

function terminalFacts(terminal: TerminalInfo): string[] {
  const activity = fmtActivity(terminal.last_activity)
  return activity ? [`${t('jupyter.terminals.last_activity')} ${activity}`] : []
}

/** 终端页 URL: 去掉 /lab 或 /tree 后缀, 挂到根路径的 /terminals/<name>。 */
function terminalUrl(name: string): string | null {
  const base = jupyterTokenUrl.value
  if (!base) return null
  const [path, query] = base.split('?')
  const root = path.replace(/\/(lab|tree)\/?$/, '')
  const qs = query ? `?${query}` : ''
  return `${root}/terminals/${encodeURIComponent(name)}${qs}`
}

// ─── 服务操作 ─────────────────────────────────────────────────────────────────

async function jupyterAction(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' || action === 'restart') {
    if (!await confirm({
      title: t(`jupyter.confirm.${action}.title`),
      message: t(`jupyter.confirm.${action}.message`),
      confirmText: t(action === 'stop' ? 'common.btn.stop' : 'common.btn.restart'),
    })) return
  }
  actionLoading.value = action
  const data = await post<ApiErrorBody & { ok?: boolean; message?: string }>(`/api/jupyter/${action}`, {})
  actionLoading.value = null
  if (!data) return
  if (data.ok) {
    if (action === 'stop') {
      // 停止后令牌作废, 下次启动重新获取
      token.value = ''
      tokenDirty.value = false
    } else {
      // 启动/重启: 固定 hero 为启动中, 直到新鲜快照到达; 令牌会随进程更新
      markPendingStart()
      tokenDirty.value = true
    }
    toast(apiMessageText(data, t(`jupyter.msg.${action === 'start' ? 'starting' : action === 'stop' ? 'stopped' : 'restarting'}`)), 'success')
    setTimeout(() => {
      loadStatus()
      if (action !== 'stop') {
        loadJupyterUrl()
        loadToken(true)
      }
    }, action === 'restart' ? 5000 : action === 'stop' ? 1000 : 3000)
  } else {
    toast(apiErrorText(data, t('jupyter.err.fallback')), 'error')
  }
}

async function kernelAction(kernelId: string, action: 'interrupt' | 'restart') {
  kernelPending.value = `${kernelId}:${action}`
  const data = await post<ApiErrorBody & { ok?: boolean }>(`/api/jupyter/kernels/${kernelId}/${action}`, {})
  kernelPending.value = null
  if (!data) return
  if (data.ok) {
    toast(action === 'restart' ? t('jupyter.kernels.kernel_restarted') : t('jupyter.kernels.kernel_interrupted'), 'success')
    setTimeout(loadStatus, 1000)
  } else {
    toast(apiErrorText(data, t('jupyter.err.fallback')), 'error')
  }
}

async function closeSession(sessionId: string) {
  if (!await confirm({
    title: t('jupyter.confirm.close_session.title'),
    message: t('jupyter.confirm.close_session.message'),
    confirmText: t('jupyter.confirm.close_session.button'),
  })) return
  sessionPending.value = sessionId
  const data = await del<ApiErrorBody & { ok?: boolean }>(`/api/jupyter/sessions/${sessionId}`)
  sessionPending.value = null
  if (!data) return
  if (data.ok) {
    toast(t('jupyter.sessions.closed'), 'success')
    setTimeout(loadStatus, 1000)
  } else {
    toast(apiErrorText(data, t('jupyter.err.fallback')), 'error')
  }
}

async function newTerminal() {
  terminalPending.value = 'new'
  const data = await post<ApiErrorBody & { name?: string }>('/api/jupyter/terminals/new', {})
  terminalPending.value = null
  if (!data) return
  toast(t('jupyter.terminals.created', { name: data.name || '' }), 'success')
  loadStatus()
}

async function deleteTerminal(name: string) {
  if (!await confirm({
    title: t('jupyter.confirm.destroy_terminal.title'),
    message: t('jupyter.confirm.destroy_terminal.message', { name }),
    confirmText: t('jupyter.confirm.destroy_terminal.button'),
  })) return
  terminalPending.value = name
  const data = await del<ApiErrorBody & { ok?: boolean }>(`/api/jupyter/terminals/${encodeURIComponent(name)}`)
  terminalPending.value = null
  if (!data) return
  toast(t('jupyter.terminals.destroyed', { name }), 'success')
  loadStatus()
}

// ─── 自动刷新 ─────────────────────────────────────────────────────────────────

async function refreshStatus() {
  const wasRunning = isRunning.value
  await loadStatus()
  // 服务刚起来, 或重启后令牌尚未取到 (进程可能晚于轮询就绪): 刷新地址与令牌
  if (isRunning.value && (!wasRunning || tokenDirty.value || !token.value)) {
    void loadJupyterUrl()
    void loadToken(tokenDirty.value)
  }
}

const refresher = useAutoRefresh(refreshStatus, 8000)

onMounted(() => {
  void loadJupyterUrl()
  void loadToken()
  void loadStatus()
  logStart()
  refresher.start({ immediate: false })
})

onUnmounted(() => {
  logStop()
  refresher.stop()
  if (pendingStartTimer) clearTimeout(pendingStartTimer)
})
</script>

<template>
  <div class="page-body">
    <div class="page-header-row">
      <div class="page-title-wrap">
        <h1 class="page-title">{{ t('jupyter.title') }}</h1>
      </div>
      <span class="page-header-row__spacer" />
      <span v-if="isRunning" class="page-actions">
        <BaseButton size="sm" :loading="actionLoading === 'stop'" :disabled="acting" @click="jupyterAction('stop')">
          <MsIcon name="stop" /> {{ t('common.btn.stop') }}
        </BaseButton>
        <BaseButton size="sm" :loading="actionLoading === 'restart'" :disabled="acting" @click="jupyterAction('restart')">
          <MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}
        </BaseButton>
      </span>
    </div>

    <div class="page-col">
      <LoadingCenter v-if="statusLoading && !status" style="padding:60px 0" />

      <template v-else-if="status">
        <!-- Hero + 运行事实 -->
        <ServiceHero
          brand="jupyter"
          :title="heroTitle"
          :subtitle="heroSubtitle"
          :tone="heroTone"
          :busy="heroBusy"
        >
          <template v-if="heroAction" #actions>
            <BaseButton
              v-if="heroAction === 'open'"
              variant="primary"
              :href="jupyterTokenUrl"
              target="_blank"
              rel="noopener"
            >
              <MsIcon name="open_in_new" /> {{ t('jupyter.hero.action.open') }}
            </BaseButton>
            <BaseButton
              v-else-if="heroAction === 'retry'"
              variant="primary"
              :loading="actionLoading === 'start'"
              :disabled="acting"
              @click="jupyterAction('start')"
            >
              {{ t('common.btn.retry') }}
            </BaseButton>
            <BaseButton
              v-else
              variant="primary"
              :loading="actionLoading === 'start'"
              :disabled="acting"
              @click="jupyterAction('start')"
            >
              {{ t('jupyter.hero.action.start') }}
            </BaseButton>
          </template>
          <template v-if="factsList.length" #facts>
            <span v-for="fact in factsList" :key="fact.label">{{ fact.label }}<b>{{ fact.value }}</b></span>
          </template>
        </ServiceHero>

        <!-- 访问令牌 (仅运行时存在) -->
        <section v-if="isRunning" class="jupyter-block">
          <SectionHeader icon="key">{{ t('jupyter.token.title') }}</SectionHeader>
          <SecretInput v-model="token" readonly copyable input-class="jupyter-token-input" />
        </section>

        <!-- 活跃内核 (运行时显示, 空则紧凑空行) -->
        <section v-if="isRunning" class="jupyter-block">
          <SectionHeader icon="developer_board">
            {{ t('jupyter.kernels.title') }}
            <span class="jupyter-count">{{ status.kernels?.length ?? 0 }}</span>
          </SectionHeader>

          <!-- 可用内核与默认内核: 紧凑副行 -->
          <div v-if="kernelSpecs.length" class="jupyter-ks">
            <span class="jupyter-ks__label">{{ t('jupyter.kernels.available') }}</span>
            <span
              v-for="ks in kernelSpecs"
              :key="ks.name"
              class="jupyter-ks__item"
              :class="{ 'is-default': ks.name === defaultKernel }"
              :title="ks.name === defaultKernel ? t('jupyter.kernels.default') : ks.name"
            >
              {{ ks.display_name }}
              <MsIcon v-if="ks.name === defaultKernel" name="check" size="xs" />
            </span>
          </div>

          <ul v-if="status.kernels?.length" class="list-plain">
            <ListRow
              v-for="kernel in status.kernels"
              :key="kernel.id"
              icon="developer_board"
              :title="kernel.name"
              :title-tooltip="kernel.id"
              :status="kernelStatus(kernel)"
              :facts="kernelFacts(kernel)"
            >
              <template #actions>
                <BaseButton
                  variant="ghost" size="sm" icon-only
                  :aria-label="t('jupyter.kernels.interrupt')"
                  :loading="kernelPending === `${kernel.id}:interrupt`"
                  :disabled="anyRowPending"
                  @click="kernelAction(kernel.id, 'interrupt')"
                >
                  <MsIcon name="pause" />
                </BaseButton>
                <BaseButton
                  variant="ghost" size="sm" icon-only
                  :aria-label="t('jupyter.kernels.restart')"
                  :loading="kernelPending === `${kernel.id}:restart`"
                  :disabled="anyRowPending"
                  @click="kernelAction(kernel.id, 'restart')"
                >
                  <MsIcon name="restart_alt" />
                </BaseButton>
              </template>
            </ListRow>
          </ul>
          <EmptyState v-else icon="developer_board" :message="t('jupyter.kernels.empty')" density="compact" />
        </section>

        <!-- 活跃会话 (运行时显示, 空则紧凑空行) -->
        <section v-if="isRunning" class="jupyter-block">
          <SectionHeader icon="web_asset">
            {{ t('jupyter.sessions.title') }}
            <span class="jupyter-count">{{ status.sessions?.length ?? 0 }}</span>
          </SectionHeader>
          <ul v-if="status.sessions?.length" class="list-plain">
            <ListRow
              v-for="session in status.sessions"
              :key="session.id"
              :icon="sessionIcon(session.type)"
              :title="session.name || session.path"
              :title-tooltip="session.path"
              :status="sessionStatus(session)"
              :facts="sessionFacts(session)"
            >
              <template #actions>
                <BaseButton
                  variant="danger" size="sm" icon-only
                  :aria-label="t('jupyter.sessions.close')"
                  :loading="sessionPending === session.id"
                  :disabled="anyRowPending"
                  @click="closeSession(session.id)"
                >
                  <MsIcon name="close" />
                </BaseButton>
              </template>
            </ListRow>
          </ul>
          <EmptyState v-else icon="web_asset" :message="t('jupyter.sessions.empty')" density="compact" />
        </section>

        <!-- 终端 (运行时显示; 有独立新增入口, 保留紧凑空行) -->
        <section v-if="isRunning" class="jupyter-block">
          <SectionHeader icon="terminal">
            {{ t('jupyter.terminals.title') }}
            <span class="jupyter-count">{{ status.terminals?.length ?? 0 }}</span>
            <template #actions>
              <BaseButton
                size="sm"
                :loading="terminalPending === 'new'"
                :disabled="anyRowPending"
                @click="newTerminal"
              >
                <MsIcon name="add" /> {{ t('jupyter.terminals.new') }}
              </BaseButton>
            </template>
          </SectionHeader>
          <ul v-if="status.terminals?.length" class="list-plain">
            <ListRow
              v-for="terminal in status.terminals"
              :key="terminal.name"
              icon="terminal"
              :title="t('jupyter.terminals.label', { name: terminal.name })"
              :facts="terminalFacts(terminal)"
            >
              <template #actions>
                <BaseButton
                  v-if="terminalUrl(terminal.name)"
                  variant="ghost" size="sm" icon-only
                  :aria-label="t('jupyter.terminals.open')"
                  :href="terminalUrl(terminal.name)!"
                  target="_blank"
                  rel="noopener"
                >
                  <MsIcon name="open_in_new" />
                </BaseButton>
                <BaseButton
                  variant="danger" size="sm" icon-only
                  :aria-label="t('jupyter.terminals.destroy')"
                  :loading="terminalPending === terminal.name"
                  :disabled="anyRowPending"
                  @click="deleteTerminal(terminal.name)"
                >
                  <MsIcon name="delete" />
                </BaseButton>
              </template>
            </ListRow>
          </ul>
          <EmptyState v-else icon="terminal" :message="t('jupyter.terminals.empty')" density="compact" />
        </section>

        <!-- 日志 (默认展开, 停机仍可读; 折叠标题与分区标题同构) -->
        <section class="jupyter-block">
          <SectionHeader icon="terminal" collapsible v-model:expanded="logOpen">
            {{ t('jupyter.log.title') }}
          </SectionHeader>
          <LogPanel
            v-show="logOpen"
            :lines="logLines"
            :status="logStatus"
            :has-more="logHasMore"
            :loading-more="logLoadingMore"
            :prepending="logPrepending"
            :on-scroll="logOnScroll"
          />
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 分区节奏: Hero → 令牌 → 内核 → 会话 → 终端 → 日志 (--section-gap, 与总览一致) */
.jupyter-block {
  margin-top: var(--section-gap);
}

.jupyter-count {
  margin-left: 6px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--t3);
}

/* 令牌输入用等宽字体, 与连接命令/密钥同一口径 */
.jupyter-token-input {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  letter-spacing: .02em;
}

/* 可用内核与默认内核: 内核区标题下的紧凑副行 */
.jupyter-ks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: var(--text-xs);
  color: var(--t3);
}

.jupyter-ks__label {
  margin-right: 2px;
}

.jupyter-ks__item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: var(--r-xs, 4px);
  background: var(--bg3);
  color: var(--t2);
}

.jupyter-ks__item.is-default {
  border-color: color-mix(in srgb, var(--ac) 40%, transparent);
  color: var(--ac);
}

.jupyter-ks__item :deep(.ms) {
  font-size: 14px;
}
</style>
