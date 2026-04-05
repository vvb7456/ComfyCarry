import { ref, reactive, computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  WizardConfig, SetupState, GpuInfo, PrebuiltInfo,
  PluginInfo, SyncTemplate, RemoteTypeDef,
  DetectedImageType, SetupStateEnvVars,
} from '@/types/wizard'

const TOTAL_STEPS = 10

function createDefaultConfig(): WizardConfig {
  return {
    image_type: 'prebuilt',
    password: '',
    tunnel_mode: '',
    cf_api_token: '',
    cf_domain: '',
    cf_subdomain: '',
    public_tunnel_subdomain: '',
    rclone_config_method: 'skip',
    rclone_config_value: '',
    civitai_token: '',
    plugins: [],
    install_fa2: false,
    install_sa2: false,
    ssh_password: '',
    ssh_keys: [],
    wizard_sync_rules: [],
    wizard_remotes: [],
    llm_provider: '',
    llm_api_key: '',
    llm_base_url: '',
    llm_model: '',
  }
}

// ── Singleton state (shared across all wizard components) ────
let _initialized = false
const config = reactive<WizardConfig>(createDefaultConfig())
const currentStep = ref(0)
const gpuInfo = ref<GpuInfo | null>(null)
const prebuiltInfo = ref<PrebuiltInfo | null>(null)
const detectedImageType = ref<DetectedImageType>('prebuilt')
const pluginData = ref<PluginInfo[]>([])
const envVars = ref<SetupStateEnvVars>({})
const syncTemplates = ref<SyncTemplate[]>([])
const remoteTypeDefs = ref<Record<string, RemoteTypeDef>>({})
const importedConfig = ref<Record<string, any> | null>(null)
const activeTunnelMode = ref('')
const activeTunnelUrls = ref<Record<string, string>>({})
const deployState = ref<'idle' | 'deploying' | 'done' | 'error'>('idle')
const initLoading = ref(true)

export function useWizardState() {
  const { t } = useI18n({ useScope: 'global' })

  // ── Computed ────────────────────────────────────────────────

  const isUnsupported = computed(() =>
    detectedImageType.value === 'unsupported' ||
    detectedImageType.value === 'unsupported-gpu' ||
    detectedImageType.value === 'no-gpu',
  )

  const totalSteps = TOTAL_STEPS

  // ── Init (called once from WizardApp root) ─────────────────

  async function init() {
    if (_initialized) return
    initLoading.value = true
    try {
      const res = await fetch('/api/setup/state')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const state: SetupState = await res.json()

      // Env vars
      envVars.value = state.env_vars || {}

      // GPU detection
      const gpu = state.gpu_info
      gpuInfo.value = gpu || null
      prebuiltInfo.value = state.prebuilt_info || null
      detectedImageType.value = (state.detected_image_type || 'prebuilt') as DetectedImageType

      // Mock mode (?mock=xxx) for debugging
      const mockParam = new URLSearchParams(location.search).get('mock')
      if (mockParam) {
        if (mockParam === 'prebuilt') {
          detectedImageType.value = 'prebuilt'
          prebuiltInfo.value = { version: '3.0', torch: '2.9.1+cu130', cuda_toolkit: '13.0', fa2: true, build_date: '2026-02-20T00:00:00Z' }
        } else if (mockParam === 'unsupported') {
          detectedImageType.value = 'unsupported'
          prebuiltInfo.value = null
          gpuInfo.value = null
        } else if (mockParam === 'unsupported-gpu') {
          detectedImageType.value = 'prebuilt'
          gpuInfo.value = { name: 'Tesla V100-SXM2-16GB', cuda_cap: '7.0', vram_gb: 16 }
        } else if (mockParam === 'no-gpu') {
          detectedImageType.value = 'prebuilt'
          gpuInfo.value = null
        }
      }

      // GPU capability check → override detectedImageType
      if (gpu?.cuda_cap) {
        const capMajor = parseInt(gpu.cuda_cap.split('.')[0], 10)
        if (capMajor > 0 && capMajor < 8) {
          detectedImageType.value = 'unsupported-gpu'
        }
      } else if (!gpu && !mockParam) {
        detectedImageType.value = 'no-gpu'
      }

      // Template data
      pluginData.value = state.plugins_available || []
      syncTemplates.value = state.sync_templates || []
      remoteTypeDefs.value = state.remote_type_defs || {}

      // Active tunnel
      activeTunnelMode.value = state.active_tunnel_mode || ''
      activeTunnelUrls.value = state.active_tunnel_urls || {}

      // Set image_type based on detection
      config.image_type = isUnsupported.value ? 'unsupported' : 'prebuilt'

      // Default plugins
      const selectedUrls = state.plugins || pluginData.value.map(p => p.url)
      config.plugins = selectedUrls

      // ── Env var pre-fill ────────────────────────────────
      const ev = envVars.value
      if (ev.password) config.password = ev.password
      if (ev.cf_api_token) config.cf_api_token = ev.cf_api_token
      if (ev.cf_domain) config.cf_domain = ev.cf_domain
      if (ev.cf_subdomain) config.cf_subdomain = ev.cf_subdomain
      if (ev.civitai_token) config.civitai_token = ev.civitai_token

      // ── Restore from saved state ──────────────────────
      if (state.password && !config.password) config.password = state.password
      if (state.cf_api_token && !config.cf_api_token) config.cf_api_token = state.cf_api_token
      if (state.cf_domain && !config.cf_domain) config.cf_domain = state.cf_domain
      if (state.cf_subdomain && !config.cf_subdomain) config.cf_subdomain = state.cf_subdomain
      if (state.civitai_token && !config.civitai_token) config.civitai_token = state.civitai_token
      if (state.rclone_config_method && state.rclone_config_method !== 'skip') {
        config.rclone_config_method = state.rclone_config_method as WizardConfig['rclone_config_method']
        if (state.rclone_config_value) config.rclone_config_value = state.rclone_config_value
      }
      if (state.plugins) config.plugins = state.plugins
      if (state.wizard_remotes) config.wizard_remotes = state.wizard_remotes
      if (state.wizard_sync_rules) config.wizard_sync_rules = state.wizard_sync_rules
      if (state.install_fa2 !== undefined) config.install_fa2 = state.install_fa2
      if (state.install_sa2 !== undefined) config.install_sa2 = state.install_sa2
      if (state.ssh_password) config.ssh_password = state.ssh_password
      if (state.ssh_keys) config.ssh_keys = state.ssh_keys
      if (state.llm_provider) config.llm_provider = state.llm_provider
      if (state.llm_api_key) config.llm_api_key = state.llm_api_key
      if (state.llm_base_url) config.llm_base_url = state.llm_base_url
      if (state.llm_model) config.llm_model = state.llm_model
      if (state._imported_sync_rules) {
        config._imported_sync_rules = true
        config._imported_sync_rules_count = state._imported_sync_rules_count || 0
      }

      // ── Restore step position ────────────────────────
      if (typeof state.current_step === 'number' && state.current_step > 0) {
        currentStep.value = state.current_step
      }

      // ── Resume deploy if in progress ──────────────────
      if (state.deploy_started && !state.deploy_completed) {
        deployState.value = 'deploying'
      } else if (state.deploy_error) {
        deployState.value = 'error'
        currentStep.value = TOTAL_STEPS - 1
      }

      _initialized = true
    } finally {
      initLoading.value = false
    }
  }

  // ── Save current config to backend ─────────────────────────

  function saveConfig() {
    fetch('/api/setup/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, current_step: currentStep.value }),
    }).catch(() => { /* best-effort persist */ })
  }

  // ── Step Navigation ────────────────────────────────────────

  function nextStep() {
    saveConfig()

    // Step 1: password validation
    if (currentStep.value === 1) {
      if (!config.password) return false
    }

    // Step 3: rclone completeness
    if (currentStep.value === 3) {
      const m = config._rclone_display_method || config.rclone_config_method
      if (m === 'file' && !config.rclone_config_value) return false
      if (m === 'manual' && config.wizard_remotes.length === 0) return false
    }

    // Import mode: step 0 → last step
    if (currentStep.value === 0 && importedConfig.value) {
      currentStep.value = TOTAL_STEPS - 1
      return true
    }

    // Skip step 4 when no rclone and no manual remotes
    if (currentStep.value === 3) {
      const m = config._rclone_display_method || config.rclone_config_method
      if ((!m || m === 'skip') && config.wizard_remotes.length === 0) {
        currentStep.value = 5
        return true
      }
    }

    if (currentStep.value < TOTAL_STEPS - 1) {
      currentStep.value++
      return true
    }
    return false
  }

  function prevStep() {
    saveConfig()

    // Import mode: from last step back to step 0
    if (currentStep.value === TOTAL_STEPS - 1 && importedConfig.value) {
      currentStep.value = 0
      return true
    }

    // Skip step 4 when going back from step 5 without rclone
    if (currentStep.value === 5) {
      const m = config._rclone_display_method || config.rclone_config_method
      if ((!m || m === 'skip') && config.wizard_remotes.length === 0) {
        currentStep.value = 3
        return true
      }
    }

    if (currentStep.value > 0) {
      currentStep.value--
      return true
    }
    return false
  }

  function goToStep(n: number) {
    if (n >= 0 && n < TOTAL_STEPS) {
      currentStep.value = n
    }
  }

  // ── Import config from file ────────────────────────────────

  async function handleImportFile(file: File): Promise<{ ok: boolean; message: string }> {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)

      if (!parsed._version) {
        return { ok: false, message: t('wizard.import.invalid_format') }
      }

      // Store raw import data — will be applied to backend at deploy time
      importedConfig.value = parsed
      config.image_type = 'prebuilt'

      // Apply parsed values to local wizard config
      let appliedCount = 0
      if (parsed.password) { config.password = parsed.password; appliedCount++ }
      if (parsed.cf_api_token) { config.cf_api_token = parsed.cf_api_token; appliedCount++ }
      if (parsed.cf_domain) config.cf_domain = parsed.cf_domain
      if (parsed.cf_subdomain) config.cf_subdomain = parsed.cf_subdomain
      if (parsed.civitai_token) { config.civitai_token = parsed.civitai_token; appliedCount++ }
      if (parsed.rclone_config_base64) {
        config.rclone_config_method = 'file'
        config._rclone_display_method = 'base64'
        config.rclone_config_value = parsed.rclone_config_base64
        appliedCount++
      }
      if (parsed.extra_plugins !== undefined || parsed.disabled_default_plugins !== undefined) {
        const defaultUrls = pluginData.value.map(p => p.url)
        const disabled = new Set<string>(parsed.disabled_default_plugins || [])
        const plugins = defaultUrls.filter(u => !disabled.has(u))
        plugins.push(...(parsed.extra_plugins || []))
        config.plugins = plugins
        appliedCount++
      }
      if (parsed.sync_rules?.length > 0) {
        config._imported_sync_rules = true
        config._imported_sync_rules_count = parsed.sync_rules.length
        appliedCount++
      }
      if (parsed.install_fa2 !== undefined) config.install_fa2 = parsed.install_fa2
      if (parsed.install_sa2 !== undefined) config.install_sa2 = parsed.install_sa2
      if (parsed.tunnel_mode && parsed.tunnel_mode !== 'public') { config.tunnel_mode = parsed.tunnel_mode; appliedCount++ }
      if (parsed.ssh_password) { config.ssh_password = parsed.ssh_password; appliedCount++ }
      if (parsed.ssh_keys) config.ssh_keys = parsed.ssh_keys
      if (parsed.ssh_pw_sync !== undefined) config.ssh_pw_sync = parsed.ssh_pw_sync
      if (parsed.llm_provider) {
        config.llm_provider = parsed.llm_provider; appliedCount++
        const provKeys = parsed.llm_provider_keys?.[parsed.llm_provider]
        if (provKeys) {
          config.llm_api_key = provKeys.api_key || ''
          config.llm_base_url = provKeys.base_url || ''
          config.llm_model = provKeys.model || ''
        }
      }

      return { ok: true, message: t('wizard.import.success', { count: appliedCount }) }
    } catch (e: any) {
      return { ok: false, message: `${t('wizard.import.parse_fail')} ${e.message}` }
    }
  }

  // ── Mode selection (step 0) ────────────────────────────────

  function selectMode(mode: 'fresh' | 'import') {
    if (mode === 'fresh') {
      importedConfig.value = null

      // Reset config to defaults, then re-apply env var pre-fills
      const defaults = createDefaultConfig()
      Object.assign(config, defaults)

      config.image_type = isUnsupported.value ? 'unsupported' : 'prebuilt'
      config.plugins = pluginData.value.map(p => p.url)

      const ev = envVars.value
      if (ev.password) config.password = ev.password
      if (ev.cf_api_token) config.cf_api_token = ev.cf_api_token
      if (ev.cf_domain) config.cf_domain = ev.cf_domain
      if (ev.cf_subdomain) config.cf_subdomain = ev.cf_subdomain
      if (ev.civitai_token) config.civitai_token = ev.civitai_token
    }
  }

  return {
    // State
    config,
    currentStep,
    gpuInfo,
    prebuiltInfo,
    detectedImageType,
    pluginData,
    envVars,
    syncTemplates,
    remoteTypeDefs,
    importedConfig,
    activeTunnelMode,
    activeTunnelUrls,
    deployState,
    initLoading,

    // Computed
    isUnsupported,
    totalSteps,

    // Actions
    init,
    saveConfig,
    nextStep,
    prevStep,
    goToStep,
    handleImportFile,
    selectMode,
  }
}
