import { ref, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from './useWizardState'
import type { DeployStep, DeployStatus, DeploySSEEvent, WizardConfig } from '@/types/wizard'
import type { LogLine } from './useLogStream'

const SSE_RECONNECT_DELAY = 3000

// Shared singleton state for the wizard deploy flow.
// StepConfirm starts the deploy, while WizardDeployView renders it.
// These must observe the same SSE/timer state instead of creating separate refs.
const steps = ref<DeployStep[]>([])
const logLines = ref<LogLine[]>([])
const status = ref<DeployStatus>('idle')
const elapsed = ref('')
const errorMsg = ref('')
const attnWarnings = ref<string[]>([])

let _evtSource: EventSource | null = null
let _elapsedTimer: ReturnType<typeof setInterval> | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _deployStartTime = 0
let _sseCompleted = false

export function useWizardDeploy() {
  const { t } = useI18n({ useScope: 'global' })
  const { config, deployState, saveConfig, importedConfig } = useWizardState()

  // ── Elapsed timer ───────────────────────────────────────────

  function startElapsedTimer() {
    stopElapsedTimer()
    _deployStartTime = Date.now()
    elapsed.value = t('wizard.deploy.elapsed_initial')
    _elapsedTimer = setInterval(() => {
      const totalSec = Math.floor((Date.now() - _deployStartTime) / 1000)
      const min = Math.floor(totalSec / 60)
      const sec = totalSec % 60
      elapsed.value = min > 0
        ? t('wizard.deploy.elapsed', { time: t('wizard.deploy.elapsed_format', { min, sec }) })
        : t('wizard.deploy.elapsed', { time: t('wizard.deploy.elapsed_sec', { sec }) })
    }, 1000)
  }

  function stopElapsedTimer() {
    if (_elapsedTimer) {
      clearInterval(_elapsedTimer)
      _elapsedTimer = null
    }
  }

  // ── SSE connection ──────────────────────────────────────────

  function connectSSE() {
    _sseCompleted = false
    closeSSE()

    // Clear content on reconnect to avoid duplicates (backend replays all)
    steps.value = []
    logLines.value = []

    const evtSource = new EventSource('/api/setup/log_stream')
    _evtSource = evtSource

    evtSource.onmessage = (event) => {
      let data: DeploySSEEvent
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }

      if (data.type === 'step') {
        // Mark previous active step as done
        const prev = steps.value.find(s => s.status === 'active')
        if (prev) prev.status = 'done'

        steps.value.push({ name: data.name, status: 'active' })
        return
      }

      if (data.type === 'done') {
        _sseCompleted = true
        closeSSE()
        stopElapsedTimer()

        // Finalize last active step
        const lastActive = steps.value.find(s => s.status === 'active')
        if (lastActive) {
          lastActive.status = data.success ? 'done' : 'error'
        }

        if (data.success) {
          status.value = 'success'
          deployState.value = 'done'

          logLines.value.push({
            text: `${t('wizard.deploy.done_msg')}`,
            className: 'log-info',
          })

          // Attention install warnings
          if (data.attn_warnings?.length) {
            attnWarnings.value = data.attn_warnings
            const names = data.attn_warnings.join(' / ')
            logLines.value.push({
              text: t('wizard.deploy.attn_warn', { names }),
              className: 'log-warn',
            })
          }
        } else {
          status.value = 'error'
          deployState.value = 'error'
          errorMsg.value = data.msg || t('wizard.deploy.failed')

          logLines.value.push({
            text: data.msg || t('wizard.deploy.failed'),
            className: 'log-error',
          })
        }
        return
      }

      if (data.type === 'log') {
        const prefix = data.time ? `${data.time}  ` : ''
        const levelClass = data.level === 'error' ? 'log-error'
          : data.level === 'warn' ? 'log-warn'
            : data.level === 'output' ? ''
              : ''
        logLines.value.push({
          text: `${prefix}${data.msg}`,
          className: levelClass || undefined,
        })
      }
    }

    evtSource.onerror = () => {
      evtSource.close()
      if (!_sseCompleted) {
        // Auto-reconnect after delay
        _reconnectTimer = setTimeout(() => connectSSE(), SSE_RECONNECT_DELAY)
      }
    }
  }

  function closeSSE() {
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer)
      _reconnectTimer = null
    }
    if (_evtSource) {
      _evtSource.close()
      _evtSource = null
    }
  }

  // ── Start deploy ────────────────────────────────────────────

  async function startDeploy(): Promise<{ ok: boolean; error?: string }> {
    saveConfig()

    // Apply imported config to backend at deploy time (deferred from file upload)
    if (importedConfig.value) {
      try {
        const res = await fetch('/api/settings/import-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(importedConfig.value),
        })
        const d = await res.json()
        if (!d.ok) {
          return { ok: false, error: d.error || t('wizard.deploy.start_fail') }
        }
      } catch (e: any) {
        return { ok: false, error: `${t('wizard.deploy.request_fail')} ${e.message}` }
      }
    }

    try {
      const res = await fetch('/api/setup/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const d = await res.json()
      if (!d.ok) {
        return { ok: false, error: d.error || t('wizard.deploy.start_fail') }
      }
    } catch (e: any) {
      return { ok: false, error: `${t('wizard.deploy.request_fail')} ${e.message}` }
    }

    // Switch to deploying state
    status.value = 'deploying'
    deployState.value = 'deploying'
    errorMsg.value = ''
    attnWarnings.value = []
    startElapsedTimer()
    connectSSE()
    return { ok: true }
  }

  // ── Retry deploy ────────────────────────────────────────────

  async function retry(): Promise<{ ok: boolean; error?: string }> {
    steps.value = []
    logLines.value = []
    errorMsg.value = ''
    attnWarnings.value = []
    status.value = 'idle'
    return startDeploy()
  }

  // ── Resume (reconnect to ongoing deploy) ────────────────────

  function resume() {
    status.value = 'deploying'
    startElapsedTimer()
    connectSSE()
  }

  // ── Cleanup ─────────────────────────────────────────────────

  onUnmounted(() => {
    closeSSE()
    stopElapsedTimer()
  })

  return {
    // State
    steps,
    logLines,
    status,
    elapsed,
    errorMsg,
    attnWarnings,

    // Actions
    startDeploy,
    retry,
    resume,
  }
}
