<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import LogPanel from '@/components/ui/LogPanel.vue'
import AddCard from '@/components/ui/AddCard.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import Spinner from '@/components/ui/Spinner.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import HeaderStatusBadge from '@/components/layout/HeaderStatusBadge.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import type { JupyterStatus } from '@/types/jupyter'
import { fmtBytes } from '@/utils/format'

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
const actionLoading = ref<'start' | 'stop' | 'restart' | null>(null)

const pm2Status = computed(() => status.value?.pm2_status || 'unknown')
const isRunning = computed(() => status.value?.online || pm2Status.value === 'online')

// log stream
const { lines: logLines, status: logStatus, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/jupyter/logs?lines=200',
  streamUrl: '/api/jupyter/logs/stream',
  classify(line) {
    if (/error|exception|traceback/i.test(line)) return 'log-error'
    if (/warn/i.test(line)) return 'log-warn'
    if (/kernel|session/i.test(line)) return 'log-info'
    return ''
  },
})

// ─── Status dot helper ────────────────────────────────────────────────────────

function pm2StatusDot(s: string): string {
  if (s === 'online') return 'running'
  if (s === 'stopped') return 'stopped'
  if (s === 'errored') return 'error'
  return 'offline'
}

function pm2StatusLabel(s: string): string {
  if (s === 'online') return t('jupyter.status.running')
  if (s === 'stopped') return t('jupyter.status.stopped')
  if (s === 'errored') return t('jupyter.status.error')
  if (s === 'not_found') return t('jupyter.status.not_created')
  return s
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function loadJupyterUrl() {
  const data = await get<{ urls?: Record<string, string>; public?: { urls?: Record<string, string> } }>('/api/tunnel/status')
  if (!data) return
  const urls: Record<string, string> = { ...(data.urls || {}), ...(data.public?.urls || {}) }
  for (const [name, url] of Object.entries(urls)) {
    if (name.toLowerCase().includes('jupyter')) {
      jupyterUrl.value = url as string
      return
    }
  }
  jupyterUrl.value = ''
}

async function loadToken() {
  const data = await get<{ token: string }>('/api/jupyter/token')
  if (data?.token) token.value = data.token
}

async function loadStatus() {
  const data = await get<JupyterStatus>('/api/jupyter/status')
  if (data) {
    status.value = data
    statusLoading.value = false
  }
}

// ─── Service actions ──────────────────────────────────────────────────────────

async function jupyterAction(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' || action === 'restart') {
    if (!await confirm({ message: t(`jupyter.confirm.${action}`) })) return
  }
  actionLoading.value = action
  const data = await post<{ ok?: boolean; message?: string; error?: string }>(`/api/jupyter/${action}`, {})
  actionLoading.value = null
  if (!data) return
  if (data.ok) {
    toast(data.message || t(`jupyter.toast.${action === 'start' ? 'starting' : action === 'stop' ? 'stopped' : 'restarting'}`), 'success')
    setTimeout(() => {
      loadStatus()
      if (action !== 'stop') loadJupyterUrl()
    }, action === 'restart' ? 5000 : action === 'stop' ? 1000 : 3000)
  } else {
    toast(`${t(`jupyter.toast.${action}_failed`)}: ${data.error || ''}`, 'error')
  }
}

// ─── Kernel actions ───────────────────────────────────────────────────────────

async function kernelAction(kernelId: string, action: 'interrupt' | 'restart') {
  const data = await post<{ ok?: boolean; error?: string }>(`/api/jupyter/kernels/${kernelId}/${action}`, {})
  if (!data) return
  if (data.ok) {
    toast(action === 'restart' ? t('jupyter.kernels.kernel_restarted') : t('jupyter.kernels.kernel_interrupted'), 'success')
    setTimeout(loadStatus, 1000)
  } else {
    toast(`${t('jupyter.kernels.action_failed')}: ${data.error || ''}`, 'error')
  }
}

// ─── Session actions ──────────────────────────────────────────────────────────

async function closeSession(sessionId: string) {
  if (!await confirm({ message: t('jupyter.confirm.close_session') })) return
  const data = await del<{ ok?: boolean; error?: string }>(`/api/jupyter/sessions/${sessionId}`)
  if (!data) return
  if (data.ok) {
    toast(t('jupyter.sessions.closed'), 'success')
    setTimeout(loadStatus, 1000)
  } else {
    toast(`${t('jupyter.kernels.action_failed')}: ${data.error || ''}`, 'error')
  }
}

// ─── Terminal actions ─────────────────────────────────────────────────────────

async function newTerminal() {
  const data = await post<{ name?: string }>('/api/jupyter/terminals/new', {})
  if (!data) return
  toast(t('jupyter.terminals.created', { name: data.name || '' }), 'success')
  loadStatus()
}

async function deleteTerminal(name: string) {
  if (!await confirm({ message: t('jupyter.terminals.destroy_confirm', { name }), variant: 'danger' })) return
  const data = await del<{ ok?: boolean }>(`/api/jupyter/terminals/${encodeURIComponent(name)}`)
  if (!data) return
  toast(t('jupyter.terminals.destroyed', { name }), 'success')
  loadStatus()
}

// ─── Terminal URL ─────────────────────────────────────────────────────────────

function terminalUrl(name: string): string | null {
  if (!jupyterUrl.value) return null
  const base = jupyterUrl.value.split('?')[0]
  const qs = jupyterUrl.value.includes('?') ? jupyterUrl.value.substring(jupyterUrl.value.indexOf('?')) : ''
  return `${base}/terminals/${encodeURIComponent(name)}${qs}`
}

/** Jupyter URL with token appended (if not already present) */
const jupyterTokenUrl = computed(() => {
  if (!jupyterUrl.value || !token.value) return ''
  // If URL already has token param, use as-is
  if (jupyterUrl.value.includes('token=')) return jupyterUrl.value
  const sep = jupyterUrl.value.includes('?') ? '&' : '?'
  return `${jupyterUrl.value}${sep}token=${token.value}`
})

function copyToken() {
  toast(t('common.clipboard_copied'), 'success')
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

Promise.all([loadJupyterUrl(), loadToken(), loadStatus()])
logStart()
const refresher = useAutoRefresh(loadStatus, 8000)
refresher.start({ immediate: false })

onUnmounted(() => {
  logStop()
  refresher.stop()
})
</script>

<template>
  <div class="jupyter-page">
    <PageHeader icon="book_2" :title="t('jupyter.title')">
      <template #badge>
        <HeaderStatusBadge
          v-if="status"
          :running="isRunning"
          :running-label="t('jupyter.status.running')"
          :stopped-label="t('jupyter.status.stopped')"
        />
        <Spinner v-else-if="statusLoading" size="sm" />
      </template>
      <template #controls>
        <span v-if="status">
          <template v-if="isRunning">
            <BaseButton :disabled="actionLoading !== null" @click="jupyterAction('stop')">
              <MsIcon name="stop" /> {{ t('jupyter.actions.stop') }}
            </BaseButton>
            <BaseButton :disabled="actionLoading !== null" @click="jupyterAction('restart')">
              <MsIcon name="restart_alt" /> {{ t('jupyter.actions.restart') }}
            </BaseButton>
          </template>
          <BaseButton v-else :disabled="actionLoading !== null" @click="jupyterAction('start')">
            <MsIcon name="play_arrow" /> {{ t('jupyter.actions.start') }}
          </BaseButton>
        </span>
      </template>
    </PageHeader>

    <div class="page-body">
      <!-- Status content -->
      <LoadingCenter v-if="statusLoading && !status">
        {{ t('common.status.loading') }}
      </LoadingCenter>
      <template v-else-if="status">
        <!-- Not running hint -->
        <div v-if="!isRunning" style="color:var(--t3);padding:16px 0;font-size:.85rem">
          {{ pm2Status === 'not_found' ? t('jupyter.hint.not_created') :
             pm2Status === 'stopped' ? t('jupyter.hint.stopped') :
             pm2Status === 'errored' ? t('jupyter.hint.error') :
             t('jupyter.hint.not_running') }}
        </div>

        <!-- Info grid (when running) -->
        <div v-if="isRunning" class="jupyter-info-grid">
          <div v-if="status.version" class="jupyter-info-item">
            <span class="jupyter-info-label">{{ t('jupyter.info.version') }}</span>
            <span>v{{ status.version }}</span>
          </div>
          <div v-if="status.pid" class="jupyter-info-item">
            <span class="jupyter-info-label">{{ t('jupyter.info.pid') }}</span>
            <span>{{ status.pid }}</span>
          </div>
          <div class="jupyter-info-item">
            <span class="jupyter-info-label">{{ t('jupyter.info.port') }}</span>
            <span>{{ status.port }}</span>
          </div>
          <div v-if="status.cpu !== undefined" class="jupyter-info-item">
            <span class="jupyter-info-label">{{ t('jupyter.info.cpu') }}</span>
            <span>{{ status.cpu.toFixed(1) }}%</span>
          </div>
          <div v-if="status.memory" class="jupyter-info-item">
            <span class="jupyter-info-label">{{ t('jupyter.info.memory') }}</span>
            <span>{{ fmtBytes(status.memory) }}</span>
          </div>
          <div class="jupyter-info-item">
            <span class="jupyter-info-label">{{ t('jupyter.info.kernels_count') }}</span>
            <span>{{ status.kernels_count }}</span>
          </div>
          <div class="jupyter-info-item">
            <span class="jupyter-info-label">{{ t('jupyter.info.sessions_count') }}</span>
            <span>{{ status.sessions_count }}</span>
          </div>
        </div>

        <!-- Kernelspecs badges -->
        <div v-if="isRunning && status.kernelspecs?.length" class="jupyter-kernelspecs">
          <span style="font-size:.78rem;color:var(--t3);margin-right:8px">{{ t('jupyter.kernels.available') }}:</span>
          <span
            v-for="ks in status.kernelspecs"
            :key="ks.name"
            class="jupyter-ks-badge"
            :class="{ default: ks.name === status.default_kernel }"
          >
            {{ ks.display_name }}
            <MsIcon v-if="ks.name === status.default_kernel" name="check" />
          </span>
        </div>
      </template>

      <!-- Token -->
      <SectionHeader icon="key">{{ t('jupyter.token.title') }}</SectionHeader>
      <BaseCard density="default">
        <SecretInput
          v-model="token"
          readonly
          copyable
          input-class="token-input"
          @copied="copyToken"
        />
        <div v-if="jupyterTokenUrl" class="jupyter-token-link">
          <a :href="jupyterTokenUrl" target="_blank" rel="noopener">
            {{ t('jupyter.token.open_jupyter') }} <MsIcon name="open_in_new" size="xs" />
          </a>
        </div>
      </BaseCard>

      <!-- Active Kernels -->
      <template v-if="status?.kernels?.length">
        <SectionHeader icon="memory">{{ t('jupyter.kernels.title') }}</SectionHeader>
        <BaseCard density="compact">
          <div v-for="kernel in status.kernels" :key="kernel.id" class="jupyter-kernel-item">
            <div class="jupyter-kernel-info">
              <StatusDot :status="kernel.state === 'idle' ? 'running' : kernel.state === 'busy' ? 'loading' : 'stopped'" />
              <span class="jupyter-kernel-name">{{ kernel.name }}</span>
              <span
                class="jupyter-kernel-state"
                :style="`color: ${kernel.state === 'idle' ? 'var(--green)' : kernel.state === 'busy' ? 'var(--amber)' : 'var(--t3)'}`"
              >
                {{ kernel.state === 'idle' ? t('jupyter.kernels.idle') : kernel.state === 'busy' ? t('jupyter.kernels.busy') : kernel.state }}
              </span>
              <span v-if="kernel.connections > 0" style="font-size:.75rem;color:var(--t3)">
                {{ kernel.connections }} {{ t('jupyter.kernels.connections') }}
              </span>
            </div>
            <div class="jupyter-kernel-actions">
              <BaseButton size="sm" square :title="t('jupyter.kernels.interrupt')" @click="kernelAction(kernel.id, 'interrupt')">
                <MsIcon name="pause" />
              </BaseButton>
              <BaseButton size="sm" square :title="t('jupyter.kernels.restart')" @click="kernelAction(kernel.id, 'restart')">↻</BaseButton>
            </div>
          </div>
        </BaseCard>
      </template>

      <!-- Active Sessions -->
      <template v-if="status?.sessions?.length">
        <SectionHeader icon="folder_open">{{ t('jupyter.sessions.title') }}</SectionHeader>
        <BaseCard density="compact">
          <div v-for="sess in status.sessions" :key="sess.id" class="jupyter-session-item">
            <span class="jupyter-session-icon">
              <MsIcon :name="sess.type === 'notebook' ? 'book_2' : sess.type === 'console' ? 'terminal' : 'description'" />
            </span>
            <div class="jupyter-session-info">
              <span class="jupyter-session-name text-truncate">{{ sess.name || sess.path }}</span>
              <span class="jupyter-session-meta text-truncate">
                {{ sess.path }} · {{ sess.kernel_name || '' }}
                <span :style="`color: ${sess.kernel_state === 'idle' ? 'var(--green)' : sess.kernel_state === 'busy' ? 'var(--amber)' : 'var(--t3)'}`">
                  ({{ sess.kernel_state === 'idle' ? t('jupyter.kernels.idle') : sess.kernel_state === 'busy' ? t('jupyter.kernels.busy') : (sess.kernel_state || '-') }})
                </span>
              </span>
            </div>
            <div class="jupyter-session-actions">
              <BaseButton variant="danger" size="sm" square :title="t('jupyter.sessions.close')" @click="closeSession(sess.id)">
                <MsIcon name="close" />
              </BaseButton>
            </div>
          </div>
        </BaseCard>
      </template>

      <!-- Terminals -->
      <SectionHeader icon="terminal">{{ t('jupyter.terminals.title') }}</SectionHeader>
      <BaseCard density="compact">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <div
            v-for="term in (status?.terminals || [])"
            :key="term.name"
            class="jupyter-terminal-item"
          >
            <MsIcon name="terminal" />
            <a
              v-if="terminalUrl(term.name)"
              :href="terminalUrl(term.name)!"
              target="_blank"
              class="terminal-name-link"
              :title="t('jupyter.terminals.open')"
            >
              {{ t('jupyter.terminals.label', { name: term.name }) }}
              <MsIcon name="open_in_new" size="xs" />
            </a>
            <span v-else class="terminal-name">{{ t('jupyter.terminals.label', { name: term.name }) }}</span>
            <BaseButton variant="danger" size="sm" square :title="t('jupyter.terminals.destroy')" @click="deleteTerminal(term.name)">
              <MsIcon name="delete" />
            </BaseButton>
          </div>
          <!-- Add terminal card -->
          <AddCard class="jupyter-terminal-item" size="compact" :fill="false" :stretch="false" :label="t('jupyter.terminals.new')" @click="newTerminal" />
        </div>
      </BaseCard>

      <!-- Log -->
      <SectionHeader icon="receipt_long">{{ t('jupyter.log.title') }}</SectionHeader>
      <LogPanel :lines="logLines" :status="logStatus" />
    </div>
  </div>
</template>

<style scoped>


/* Vue-unique: page wrapper */
.jupyter-page { display: flex; flex-direction: column; height: 100%; }

/* Vue-unique: token input */
.token-input { width: 100%; font-family: 'IBM Plex Mono', monospace; font-size: .78rem; letter-spacing: .02em; background: var(--bg3); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 72px 6px 10px; color: var(--t1); outline: none; box-sizing: border-box; }
.jupyter-token-link { font-size: .72rem; color: var(--t3); margin-top: 6px; }
.jupyter-token-link a { color: var(--ac); text-decoration: none; display: inline-flex; align-items: center; gap: 2px; }
.jupyter-token-link a:hover { text-decoration: underline; }

/* Vue-unique: terminal name (link / non-link) */
.terminal-name-link { font-weight: 600; font-size: .85rem; color: var(--t1); text-decoration: none; transition: color .15s; }
.terminal-name-link:hover { color: var(--ac); }
.terminal-name { font-weight: 600; font-size: .85rem; color: var(--t1); }

/* ── Info Grid ── */
.jupyter-info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin: 8px 0 16px; }
.jupyter-info-item { background: var(--bg3); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.jupyter-info-label { font-size: .72rem; color: var(--t3); text-transform: uppercase; letter-spacing: .04em; }
.jupyter-info-item > span:last-child { font-size: .95rem; font-weight: 600; font-family: 'IBM Plex Mono', monospace; }

/* ── Kernel Specs ── */
.jupyter-kernelspecs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.jupyter-ks-badge { background: var(--bg3); border-radius: 4px; padding: 2px 8px; font-size: .75rem; color: var(--t2); }
.jupyter-ks-badge.default { border: 1px solid var(--ac); color: var(--ac); }

/* ── Kernel / Session / Terminal Items ── */
.jupyter-kernel-item,
.jupyter-session-item,
.jupyter-terminal-item { display: flex; align-items: center; justify-content: space-between; background: var(--bg3); border: 1px solid var(--bd); border-radius: 8px; padding: 10px 14px; margin-bottom: 6px; gap: 10px; }
.jupyter-kernel-info,
.jupyter-session-info { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.jupyter-kernel-name { font-weight: 600; font-size: .88rem; }
.jupyter-kernel-state { font-size: .78rem; }
.jupyter-kernel-actions,
.jupyter-session-actions { display: flex; gap: 4px; flex-shrink: 0; }
.jupyter-session-icon { font-size: 1.1rem; flex-shrink: 0; }
.jupyter-session-name { font-weight: 600; font-size: .85rem; }
.jupyter-session-meta { font-size: .75rem; color: var(--t3); }
.jupyter-session-info { flex-direction: column; align-items: flex-start; gap: 2px; }
</style>
