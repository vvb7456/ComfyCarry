import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from './useWizardState'
import type { RemoteFieldDef } from '@/types/wizard'
import type { SelectOption } from '@/components/form/BaseSelect.vue'
import { remoteBrand } from '@/config/remote-logos'
import {
  type RcloneMethod,
  defaultRemoteNameRef as _defaultRemoteName,
  selectedMethodRef as _selectedMethod,
  detectedRemotesRef as _detectedRemotes,
  fileStatusRef as _fileStatus,
  remoteOverrides as _remoteOverrides,
  pathOverrides as _pathOverrides,
  setDetectTimer,
  clearDetectTimer,
} from './wizardRcloneState'

export function useWizardRclone() {
  const { t } = useI18n({ useScope: 'global' })
  const { config, envVars, syncTemplates, remoteTypeDefs } = useWizardState()

  /** Whether the env var RCLONE_CONF_BASE64 is available */
  const hasRcloneEnv = computed(() => !!envVars.value.rclone_has_env)

  /** All remote names (detected + manually added) */
  const allRemoteNames = computed(() => {
    const names = new Set<string>()
    _detectedRemotes.value.forEach(r => names.add(r.name))
    config.wizard_remotes.forEach(r => names.add(r.name))
    return [...names]
  })

  /** 同上, 但带品牌 logo —— 给 BaseSelect 用 (名字相同时保留先出现的类型) */
  const allRemoteOptions = computed<SelectOption[]>(() => {
    const byName = new Map<string, string>()
    _detectedRemotes.value.forEach(r => { if (!byName.has(r.name)) byName.set(r.name, r.type) })
    config.wizard_remotes.forEach(r => { if (!byName.has(r.name)) byName.set(r.name, r.type) })
    return [...byName].map(([name, type]) => {
      const brand = remoteBrand(type, undefined)
      return { value: name, label: name, logo: brand.logo, icon: brand.icon }
    })
  })

  // ── Method selection ────────────────────────────────────────

  function selectMethod(method: RcloneMethod) {
    // Toggle off if clicking the already-selected method
    if (_selectedMethod.value === method) {
      _selectedMethod.value = ''
      config._rclone_display_method = ''
      config.rclone_config_method = 'skip'
      config.rclone_config_value = ''
      _fileStatus.value = ''
      _detectedRemotes.value = []
      return
    }

    // Clear stale detections from previous method
    _detectedRemotes.value = []
    _fileStatus.value = ''
    _selectedMethod.value = method
    config._rclone_display_method = method
    config.rclone_config_method = method || 'skip'

    // Clear config value when switching away from file method
    if (method !== 'file') {
      config.rclone_config_value = ''
    }

    // Trigger remote detection for non-manual methods
    if (method && method !== 'manual') {
      debouncedDetect()
    }
  }

  // ── File upload → base64 ────────────────────────────────────

  async function handleFile(file: File) {
    const text = await file.text()
    // Use TextEncoder to safely handle UTF-8 (btoa only supports Latin-1)
    const bytes = new TextEncoder().encode(text)
    const binStr = Array.from(bytes, b => String.fromCharCode(b)).join('')
    config.rclone_config_value = btoa(binStr)
    config.rclone_config_method = 'file'
    _fileStatus.value = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`
    await detectRemotes()
  }

  // ── Remote detection ────────────────────────────────────────

  function debouncedDetect() {
    clearDetectTimer()
    setDetectTimer(setTimeout(() => detectRemotes(), 300))
  }

  async function detectRemotes() {
    const method = _selectedMethod.value || 'skip'
    if (method === 'skip' || method === 'manual') return

    let reqMethod = method as string
    let value = ''

    if (method === 'file') {
      reqMethod = 'base64'
      value = config.rclone_config_value || ''
    } else if (method === 'base64_env') {
      reqMethod = 'base64_env'
      value = ''
    }

    try {
      const res = await fetch('/api/setup/preview_remotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: reqMethod, value }),
      })
      const d = await res.json()
      _detectedRemotes.value = d.remotes || []
    } catch (e) {
      console.error('detectRemotes error:', e)
    }
  }

  // ── Manual remote CRUD ──────────────────────────────────────

  function submitRemote(
    name: string,
    type: string,
    params: Record<string, string>,
  ): { ok: boolean; error?: string } {
    if (!name || !type) {
      return { ok: false, error: t('wizard.step3.name_type_required') }
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return { ok: false, error: t('wizard.step3.name_invalid') }
    }
    // Duplicate check
    if (allRemoteNames.value.includes(name)) {
      return { ok: false, error: t('wizard.step3.remote_exists', { name }) }
    }
    // Required field check
    const def = remoteTypeDefs.value[type]
    if (def) {
      for (const f of def.fields) {
        if (f.required && !params[f.key]) {
          return { ok: false, error: t('wizard.step3.field_required', { field: f.label }) }
        }
      }
    }

    config.wizard_remotes.push({ name, type, params })
    return { ok: true }
  }

  function removeRemote(name: string) {
    config.wizard_remotes = config.wizard_remotes.filter(r => r.name !== name)
  }

  // ── Sync rules step helpers ─────────────────────────────────

  const pullTemplates = computed(() =>
    syncTemplates.value.filter(t => t.direction === 'pull'),
  )

  const pushTemplates = computed(() =>
    syncTemplates.value.filter(t => t.direction === 'push'),
  )

  function isRuleSelected(templateId: string): boolean {
    return config.wizard_sync_rules.some(r => r.template_id === templateId)
  }

  function toggleRule(templateId: string, remote: string, remotePath: string) {
    const idx = config.wizard_sync_rules.findIndex(r => r.template_id === templateId)
    if (idx >= 0) {
      // 取消勾选前把已选的 remote / 路径存回 overrides ——
      // 不然重新勾选时会回落到默认值, 用户之前的选择白填了
      const removed = config.wizard_sync_rules[idx]
      if (removed.remote) _remoteOverrides.value[templateId] = removed.remote
      if (removed.remote_path) _pathOverrides.value[templateId] = removed.remote_path
      config.wizard_sync_rules.splice(idx, 1)
    } else {
      config.wizard_sync_rules.push({ template_id: templateId, remote, remote_path: remotePath })
    }
  }

  function updateRuleRemote(templateId: string, remote: string) {
    const rule = config.wizard_sync_rules.find(r => r.template_id === templateId)
    if (rule) rule.remote = remote
  }

  function updateRulePath(templateId: string, path: string) {
    const rule = config.wizard_sync_rules.find(r => r.template_id === templateId)
    if (rule) rule.remote_path = path
  }

  /** Apply a default remote to all selected rules */
  function setDefaultRemote(remote: string) {
    _defaultRemoteName.value = remote
    for (const rule of config.wizard_sync_rules) {
      rule.remote = remote
    }
  }

  /** The user-chosen default remote (persists across renders). Falls back to first available. */
  const defaultRemoteName = computed({
    get: () => {
      // If user previously selected one and it still exists, use it
      if (_defaultRemoteName.value && allRemoteNames.value.includes(_defaultRemoteName.value)) {
        return _defaultRemoteName.value
      }
      return allRemoteNames.value[0] || ''
    },
    set: (v: string) => setDefaultRemote(v),
  })

  // ── Init from env ─────────────────────────────────────────

  /** Load remotes from an imported config's base64 rclone value */
  async function loadImportedRemotes(base64Value: string) {
    if (!base64Value) return
    try {
      const res = await fetch('/api/setup/preview_remotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'base64', value: base64Value }),
      })
      const d = await res.json()
      _detectedRemotes.value = d.remotes || []
    } catch (e) {
      console.error('loadImportedRemotes error:', e)
    }
  }

  /** Clear detected remotes (used when switching away from import mode) */
  function resetDetectedRemotes() {
    _detectedRemotes.value = []
  }

  function initFromEnv() {
    // 环境变量只提供"首次进入时的默认值"。此前这里是无条件覆盖, 用户在
    // Step 3 改选手动创建后前进再后退, 选择就被弹回环境变量。
    const notChosenYet = !_selectedMethod.value
      && (!config.rclone_config_method || config.rclone_config_method === 'skip')
    if (hasRcloneEnv.value && notChosenYet) {
      _selectedMethod.value = 'base64_env'
      config.rclone_config_method = 'base64_env'
      config._rclone_display_method = 'base64_env'
      debouncedDetect()
    }
    // Restore saved method if state was persisted
    if (config.rclone_config_method && config.rclone_config_method !== 'skip') {
      _selectedMethod.value = config.rclone_config_method === 'base64_env'
        ? 'base64_env'
        : config.rclone_config_method === 'file' || config.rclone_config_value
          ? 'file'
          : 'manual'
      // Re-detect remotes after page reload if method has a value
      if (_selectedMethod.value !== 'manual' && !_detectedRemotes.value.length) {
        debouncedDetect()
      }
    }
  }

  return {
    // State (aliased from module-level refs)
    selectedMethod: _selectedMethod,
    detectedRemotes: _detectedRemotes,
    fileStatus: _fileStatus,

    // Computed
    hasRcloneEnv,
    allRemoteNames,
    allRemoteOptions,
    remoteOverrides: _remoteOverrides,
    pathOverrides: _pathOverrides,
    pullTemplates,
    pushTemplates,
    defaultRemoteName,

    // Actions
    selectMethod,
    handleFile,
    detectRemotes,
    debouncedDetect,
    submitRemote,
    removeRemote,
    isRuleSelected,
    toggleRule,
    updateRuleRemote,
    updateRulePath,
    setDefaultRemote,
    loadImportedRemotes,
    resetDetectedRemotes,
    initFromEnv,
  }
}
