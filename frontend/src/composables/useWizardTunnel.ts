import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from './useWizardState'

interface TunnelCapacity {
  active_tunnels: number
  max_tunnels: number
  available: boolean
}

interface ValidateResult {
  ok: boolean
  message: string
  account_name?: string
}

export function useWizardTunnel() {
  const { t } = useI18n({ useScope: 'global' })
  const { config, envVars, activeTunnelMode } = useWizardState()

  const capacity = ref<TunnelCapacity | null>(null)
  const capacityLoading = ref(false)
  const capacityError = ref(false)
  const validating = ref(false)
  const validateResult = ref<ValidateResult | null>(null)

  /** Whether tunnel cards are locked (already configured via bootstrap/env) */
  const tunnelLocked = computed(() => !!activeTunnelMode.value)

  // ── Select tunnel mode ──────────────────────────────────────

  function selectMode(mode: 'public' | 'custom') {
    if (tunnelLocked.value) return
    if (config.tunnel_mode === mode) {
      // Toggle off: deselect current mode
      config.tunnel_mode = ''
      return
    }
    config.tunnel_mode = mode
  }

  function clearMode() {
    if (tunnelLocked.value) return
    config.tunnel_mode = ''
    config.cf_api_token = ''
    config.cf_domain = ''
    config.cf_subdomain = ''
    config.public_tunnel_subdomain = ''
  }

  // ── Load public tunnel capacity ─────────────────────────────

  async function loadCapacity() {
    capacityLoading.value = true
    capacityError.value = false
    try {
      const res = await fetch('/api/tunnel/public/status')
      const d = await res.json()
      const cap = d.capacity || {}
      if (cap.active_tunnels >= 0) {
        capacity.value = {
          active_tunnels: cap.active_tunnels,
          max_tunnels: cap.max_tunnels,
          available: cap.available !== false,
        }
      } else {
        capacityError.value = true
      }
    } catch {
      capacityError.value = true
    } finally {
      capacityLoading.value = false
    }
  }

  // ── Validate CF API Token ───────────────────────────────────

  async function validateCfToken(): Promise<ValidateResult> {
    const token = config.cf_api_token.trim()
    const domain = config.cf_domain.trim()

    if (!token || !domain) {
      const result: ValidateResult = {
        ok: false,
        message: t('wizard.step2.validate_empty'),
      }
      validateResult.value = result
      return result
    }

    validating.value = true
    validateResult.value = null
    try {
      const res = await fetch('/api/tunnel/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_token: token, domain }),
      })
      const d = await res.json()
      const result: ValidateResult = d.ok
        ? { ok: true, message: d.message, account_name: d.account_name }
        : { ok: false, message: d.message || d.error || t('wizard.step2.validate_fail') }
      validateResult.value = result
      return result
    } catch (e: any) {
      const result: ValidateResult = {
        ok: false,
        message: `${t('wizard.step2.validate_error')} ${e.message}`,
      }
      validateResult.value = result
      return result
    } finally {
      validating.value = false
    }
  }

  // ── Init from env vars ────────────────────────────────────

  function initFromEnv() {
    const ev = envVars.value
    if (activeTunnelMode.value) {
      config.tunnel_mode = activeTunnelMode.value as '' | 'public' | 'custom'
    } else if (ev.cf_api_token) {
      config.tunnel_mode = 'custom'
    } else if (ev.public_tunnel) {
      config.tunnel_mode = 'public'
    }
  }

  return {
    // State
    capacity,
    capacityLoading,
    capacityError,
    validating,
    validateResult,

    // Computed
    tunnelLocked,

    // Actions
    selectMode,
    clearMode,
    loadCapacity,
    validateCfToken,
    initFromEnv,
  }
}
