<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import Spinner from '@/components/ui/Spinner.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import FieldControlRow from '@/components/form/FieldControlRow.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { useAppStore } from '@/stores/app'
import type { LlmProvider, ModelOption, LlmConfigData } from '@/types/settings'

defineOptions({ name: 'SettingsPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post, put } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()
const app = useAppStore()

// ─── Prompt editor settings ───────────────────────────────────────────────────

const {
  settings: promptSettings,
  saving: promptSaving,
  translateProviders: promptTranslateProviders,
  load: loadPromptSettings,
  save: savePromptSettings,
} = usePromptSettings()

const promptAutocompleteOptions = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
]

const normalizeEnabled = computed(() =>
  promptSettings.normalize_comma
  || promptSettings.normalize_period
  || promptSettings.normalize_bracket
  || promptSettings.normalize_underscore
  || promptSettings.escape_bracket,
)

function toggleNormalizeAll(on: boolean) {
  if (on) {
    // 开启总开关 → 恢复默认值
    promptSettings.normalize_comma = true
    promptSettings.normalize_period = true
    promptSettings.normalize_bracket = true
  } else {
    // 关闭总开关 → 全部关闭
    promptSettings.normalize_comma = false
    promptSettings.normalize_period = false
    promptSettings.normalize_bracket = false
    promptSettings.normalize_underscore = false
    promptSettings.escape_bracket = false
  }
}

const translateProviderOptions = computed(() => [
  { value: '', label: t('settings.prompt.translation.provider_auto') },
  ...promptTranslateProviders.value.map(p => ({
    value: p,
    label: t(`settings.prompt.translation.providers.${p}`, p),
  })),
])

async function onSavePromptSettings() {
  const ok = await savePromptSettings()
  if (ok) toast(t('settings.prompt.saved'), 'success')
}

// ─── Tab state ────────────────────────────────────────────────────────────────

const activeTab = ref('comfycarry')
const tabs = computed(() => [
  { key: 'comfycarry', label: 'ComfyCarry', icon: 'dashboard' },
  { key: 'prompt', label: t('settings.prompt.tab_label'), icon: 'edit_note' },
  { key: 'civitai', label: 'CivitAI', icon: 'palette' },
  { key: 'llm', label: 'LLM', icon: 'smart_toy' },
])

// ─── Log stream ───────────────────────────────────────────────────────────────

const { lines: logLines, status: logStatus, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/logs/dashboard?lines=100',
  streamUrl: '/api/logs/dashboard/stream',
})

// ─── Password state ───────────────────────────────────────────────────────────

const pwCurrent = ref('')
const pwNew = ref('')
const pwConfirm = ref('')
const pwSubmitting = ref(false)

// ─── API Key state ────────────────────────────────────────────────────────────

const apiKey = ref('')
const apiKeyRevealed = ref(false)
const regenLoading = ref(false)

// ─── CivitAI state ────────────────────────────────────────────────────────────

const civitaiKey = ref('')
const civitaiSaving = ref(false)

// ─── Reinit state ─────────────────────────────────────────────────────────────

const reinitKeepModels = ref(true)
const reinitLoading = ref(false)

// ─── Update state ─────────────────────────────────────────────────────────────

const updateChecking = ref(false)
const updateApplying = ref(false)
const updateInfo = ref<{
  current_version?: string
  current_commit?: string
  latest_version?: string
  latest_commit?: string
  latest_message?: string
  has_update?: boolean
} | null>(null)
const updatePhase = ref('')

async function checkUpdate() {
  updateChecking.value = true
  updateInfo.value = null
  const data = await get<{
    current_version: string
    current_commit: string
    latest_version: string
    latest_commit: string
    latest_message: string
    has_update: boolean
  }>('/api/update/check')
  updateChecking.value = false
  if (!data) { toast(t('settings.update.check_failed'), 'error'); return }
  updateInfo.value = data
}

async function applyUpdate() {
  if (!await confirm({ message: t('settings.update.apply_btn') + '?' })) return
  updateApplying.value = true
  updatePhase.value = ''
  try {
    const resp = await fetch('/api/update/apply', { method: 'POST' })
    if (!resp.ok || !resp.body) {
      toast(t('settings.update.error'), 'error')
      updateApplying.value = false
      return
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const ev = JSON.parse(line.slice(6))
          updatePhase.value = ev.message || ev.phase
          if (ev.phase === 'done') {
            toast(t('settings.update.done'), 'success')
            setTimeout(() => location.reload(), 4000)
          } else if (ev.phase === 'error') {
            toast(`${t('settings.update.error')}: ${ev.message}`, 'error')
            updateApplying.value = false
          }
        } catch { /* ignore parse errors */ }
      }
    }
  } catch (e: any) {
    toast(`${t('settings.update.error')}: ${e.message}`, 'error')
    updateApplying.value = false
  }
}

// ─── LLM state ───────────────────────────────────────────────────────────────

const llmProviders = ref<LlmProvider[]>([])
const llmProvidersLoaded = ref(false)
const llmProvider = ref('')
const llmApiKey = ref('')
const llmBaseUrl = ref('')
const llmModel = ref('')
const llmModelText = ref('')
const llmTemperature = ref(0.7)
const llmMaxTokens = ref(2000)
const llmStream = ref(true)
const llmAllModels = ref<ModelOption[]>([])
const selectedLlmModel = ref<ModelOption | null>(null)
const llmModelInfo = computed(() => {
  const m = selectedLlmModel.value
  if (!m) return ''
  const parts: string[] = []
  if (m.context_length) parts.push(t('settings.llm.model.context_fmt', { n: m.context_length.toLocaleString() }))
  if (m.pricing?.prompt) parts.push(t('settings.llm.model.input_fmt', { n: m.pricing.prompt }))
  if (m.pricing?.completion) parts.push(t('settings.llm.model.output_fmt', { n: m.pricing.completion }))
  return parts.join(' · ')
})
const llmFetchingModels = ref(false)
const llmSaving = ref(false)
const llmTesting = ref(false)
const llmTestResult = ref<{ ok: boolean; message: string } | null>(null)
const llmProviderKeys = ref<Record<string, { api_key?: string; model?: string; base_url?: string }>>({})

const llmModelSelectOptions = computed(() =>
  llmAllModels.value.map(m => ({ value: m.id, label: m.name || m.id }))
)

const showLlmBaseUrl = computed(() => llmProvider.value === 'custom')

// ─── Load settings ────────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await get<{ civitai_key_set?: boolean; civitai_key?: string; api_key?: string }>('/api/settings')
  if (!data) return
  if (data.civitai_key && data.civitai_key_set) civitaiKey.value = data.civitai_key
  if (data.api_key) apiKey.value = data.api_key
}

// ─── Tab switch ───────────────────────────────────────────────────────────────

function onTabChange(tab: string) {
  activeTab.value = tab
  if (tab === 'comfycarry') {
    logStart()
  } else {
    logStop()
  }
  if (tab === 'llm' && !llmProvidersLoaded.value) {
    loadLlmTab()
  }
  if (tab === 'prompt') {
    loadPromptSettings()
  }
}

// ─── Password ─────────────────────────────────────────────────────────────────

async function changePassword() {
  if (!pwCurrent.value) { toast(t('settings.password.err_current'), 'error'); return }
  if (!pwNew.value) { toast(t('settings.password.err_new'), 'error'); return }
  if (pwNew.value.length < 4) { toast(t('settings.password.err_min_length'), 'error'); return }
  if (pwNew.value !== pwConfirm.value) { toast(t('settings.password.err_mismatch'), 'error'); return }
  pwSubmitting.value = true
  const data = await post<{ message?: string; error?: string }>('/api/settings/password', {
    current: pwCurrent.value,
    new: pwNew.value,
  })
  pwSubmitting.value = false
  if (!data) return
  toast(data.message || data.error || '', data.error ? 'error' : 'success')
  if (!data.error) {
    pwCurrent.value = ''
    pwNew.value = ''
    pwConfirm.value = ''
  }
}

// ─── API Key ──────────────────────────────────────────────────────────────────

function copyApiKey() {
  toast(t('common.clipboard_copied'), 'success')
}

async function regenerateApiKey() {
  if (!await confirm({ message: t('settings.api_key.regenerate_confirm'), variant: 'danger' })) return
  regenLoading.value = true
  const data = await post<{ ok?: boolean; api_key?: string; error?: string }>('/api/settings/api-key', {})
  regenLoading.value = false
  if (!data) return
  if (data.ok && data.api_key) {
    apiKey.value = data.api_key
    apiKeyRevealed.value = true
    toast(t('settings.api_key.regenerated'), 'success')
  } else {
    toast(data.error || t('settings.api_key.regenerate_failed'), 'error')
  }
}

// ─── CivitAI ──────────────────────────────────────────────────────────────────

async function saveCivitaiKey() {
  const key = civitaiKey.value.trim()
  if (!key) { toast(t('settings.civitai.err_empty'), 'error'); return }
  civitaiSaving.value = true
  const data = await post<{ ok?: boolean; error?: string }>('/api/settings/civitai-key', { api_key: key })
  civitaiSaving.value = false
  if (!data) return
  toast(data.ok ? t('settings.civitai.saved') : (data.error || t('settings.civitai.save_failed')), data.ok ? 'success' : 'error')
  if (data.ok) civitaiKey.value = ''
  await loadSettings()
}

async function clearCivitaiKey() {
  if (!await confirm({ message: t('settings.civitai.clear_confirm'), variant: 'danger' })) return
  const data = await post<{ ok?: boolean }>('/api/settings/civitai-key', { api_key: '' })
  if (!data?.ok) return
  toast(t('settings.civitai.cleared'), 'success')
  civitaiKey.value = ''
  await loadSettings()
}

// ─── Export / Import ──────────────────────────────────────────────────────────

async function exportConfig() {
  try {
    const res = await fetch('/api/settings/export-config')
    if (!res.ok) { toast(t('settings.config.export_failed'), 'error'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `comfycarry-config-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast(t('settings.config.exported'), 'success')
  } catch (e: any) {
    toast(`${t('settings.config.export_failed')}: ${e.message}`, 'error')
  }
}

async function importConfig(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(event.target as HTMLInputElement).value = ''
  try {
    const text = await file.text()
    const config = JSON.parse(text)
    if (!config._version) { toast(t('settings.config.invalid_format'), 'error'); return }
    if (!await confirm({ message: t('settings.config.import_confirm', { date: config._exported_at || t('settings.config.unknown_date') }), variant: 'danger' })) return
    const data = await post<{ message?: string }>('/api/settings/import-config', JSON.parse(text))
    if (!data) return
    toast(data.message || '', 'success')
    await loadSettings()
  } catch (e: any) {
    toast(`${t('settings.config.import_failed')}: ${e.message}`, 'error')
  }
}

// ─── Restart / Reinitialize ───────────────────────────────────────────────────

async function restartDashboard() {
  if (!await confirm({ message: t('settings.restart_confirm') })) return
  await post('/api/settings/restart', {})
  toast(t('settings.restarting'), 'info')
  setTimeout(() => location.reload(), 3000)
}

async function reinitialize() {
  const keepModels = reinitKeepModels.value
  const confirmMsg = keepModels ? t('settings.reinit.confirm_keep') : t('settings.reinit.confirm_delete')
  if (!await confirm({ message: confirmMsg, variant: 'danger' })) return
  if (!keepModels && !await confirm({ message: t('settings.reinit.confirm_delete_final'), variant: 'danger' })) return
  reinitLoading.value = true
  toast(t('settings.reinit.in_progress'), 'info')
  const data = await post<{ ok?: boolean; errors?: string[] }>('/api/settings/reinitialize', { keep_models: keepModels })
  reinitLoading.value = false
  if (!data) return
  if (data.ok) {
    toast(t('settings.reinit.success'), 'success')
    setTimeout(() => location.reload(), 1500)
  } else {
    toast(`${t('settings.reinit.partial_fail')}: ${(data.errors || []).join('; ')}`, 'error')
  }
}

// ─── LLM ─────────────────────────────────────────────────────────────────────

async function loadLlmTab() {
  const [provData, cfgData] = await Promise.all([
    get<{ providers: LlmProvider[] }>('/api/llm/providers'),
    get<{ ok: boolean; data?: LlmConfigData }>('/api/llm/config'),
  ])
  llmProvidersLoaded.value = true
  if (provData?.providers) llmProviders.value = provData.providers
  if (cfgData?.ok && cfgData.data) {
    const cfg = cfgData.data
    llmProviderKeys.value = cfg.provider_keys || {}
    if (cfg.provider) llmProvider.value = cfg.provider
    const savedProv = llmProviderKeys.value[cfg.provider || '']
    if (savedProv?.api_key) llmApiKey.value = savedProv.api_key
    if (cfg.base_url) llmBaseUrl.value = cfg.base_url
    if (cfg.temperature != null) llmTemperature.value = cfg.temperature
    if (cfg.max_tokens != null) llmMaxTokens.value = cfg.max_tokens
    llmStream.value = !!cfg.stream
    if (cfg.model) {
      llmModel.value = cfg.model
      llmModelText.value = cfg.model
    }
  }
}

function onLlmProviderChange() {
  const saved = llmProviderKeys.value[llmProvider.value]
  llmApiKey.value = saved?.api_key || ''
  llmBaseUrl.value = saved?.base_url || ''
  llmAllModels.value = []
  selectedLlmModel.value = null
  if (saved?.model) {
    llmModel.value = saved.model
    llmModelText.value = saved.model
  } else {
    llmModel.value = ''
    llmModelText.value = t('settings.llm.model.refresh_hint')
  }
}

function selectLlmModel(value: string | number | boolean) {
  const model = llmAllModels.value.find(m => m.id === value)
  if (model) {
    llmModelText.value = model.name || model.id
    selectedLlmModel.value = model
  }
}

async function fetchLlmModels() {
  if (!llmProvider.value) { toast(t('settings.llm.err_no_provider'), 'error'); return }
  if (!llmApiKey.value) { toast(t('settings.llm.err_no_key'), 'error'); return }
  llmFetchingModels.value = true
  llmModelText.value = t('settings.llm.model.fetching')
  const data = await post<{ ok?: boolean; models?: ModelOption[]; error?: string }>('/api/llm/models', {
    provider: llmProvider.value,
    api_key: llmApiKey.value,
    base_url: llmBaseUrl.value,
  })
  llmFetchingModels.value = false
  if (!data?.ok) {
    llmModelText.value = t('settings.llm.model.fetch_failed')
    toast(data?.error || t('settings.llm.model.fetch_failed'), 'error')
    return
  }
  const models = (data.models || []).sort((a, b) => {
    const na = (a.name || a.id || '').toLowerCase()
    const nb = (b.name || b.id || '').toLowerCase()
    return na.localeCompare(nb)
  })
  llmAllModels.value = models
  if (models.length > 0) {
    const first = models[0]
    llmModel.value = first.id
    llmModelText.value = first.name || first.id
    selectedLlmModel.value = first
  } else {
    llmModelText.value = t('settings.llm.model.none_available')
  }
  toast(t('settings.llm.model.fetched_count', { count: models.length }), 'success')
}

async function saveLlmConfig() {
  if (!llmProvider.value) { toast(t('settings.llm.err_no_provider'), 'error'); return }
  if (!llmApiKey.value) { toast(t('settings.llm.err_no_key'), 'error'); return }
  llmSaving.value = true
  const body: Record<string, unknown> = {
    provider: llmProvider.value,
    api_key: llmApiKey.value,
    model: llmModel.value,
    temperature: llmTemperature.value,
    max_tokens: llmMaxTokens.value,
    stream: llmStream.value,
  }
  if (llmBaseUrl.value) body.base_url = llmBaseUrl.value
  const data = await put<{ ok?: boolean; error?: string }>('/api/llm/config', body)
  llmSaving.value = false
  if (!data) return
  if (data.ok) {
    llmProviderKeys.value[llmProvider.value] = { api_key: llmApiKey.value, model: llmModel.value, base_url: llmBaseUrl.value }
    toast(t('settings.llm.config_saved'), 'success')
  } else {
    toast(data.error || t('settings.llm.save_failed'), 'error')
  }
}

async function testLlmConnection() {
  if (!llmProvider.value) { toast(t('settings.llm.err_no_provider'), 'error'); return }
  if (!llmApiKey.value) { toast(t('settings.llm.err_no_key'), 'error'); return }
  if (!llmModel.value) { toast(t('settings.llm.err_no_model'), 'error'); return }
  llmTesting.value = true
  llmTestResult.value = null
  const data = await post<{ ok?: boolean; latency_ms?: number; response?: string; error?: string }>('/api/llm/test', {
    provider: llmProvider.value,
    api_key: llmApiKey.value,
    model: llmModel.value,
    base_url: llmBaseUrl.value,
  })
  llmTesting.value = false
  if (!data) return
  if (data.ok) {
    const extra = [data.latency_ms ? `${data.latency_ms}ms` : '', data.response ? `— ${data.response}` : ''].filter(Boolean).join(' ')
    llmTestResult.value = { ok: true, message: `✓ ${t('settings.llm.test_success')}${extra ? ' ' + extra : ''}` }
  } else {
    llmTestResult.value = { ok: false, message: `✗ ${t('settings.llm.test_failed')}: ${data.error || t('settings.llm.unknown_error')}` }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

loadSettings()
logStart()

onUnmounted(() => {
  logStop()
})
</script>

<template>
  <div class="settings-page">
    <PageHeader icon="settings" :title="t('settings.title')">
      <template #controls>
        <BaseButton @click="restartDashboard">
          <MsIcon name="refresh" />
          {{ t('settings.restart_btn') }}
        </BaseButton>
      </template>
    </PageHeader>

    <div class="page-body">
      <TabSwitcher :tabs="tabs" v-model="activeTab" @update:model-value="onTabChange" />

      <!-- ═══ Tab: ComfyCarry ═══════════════════════════════ -->
      <div v-show="activeTab === 'comfycarry'" class="settings-grid">
        <!-- Left column -->
        <div class="settings-col">
          <!-- Password -->
          <BaseCard density="roomy">
            <h3 class="settings-card-title">
              <MsIcon name="lock" />
              {{ t('settings.password.title') }}
            </h3>
            <form @submit.prevent="changePassword" autocomplete="off">
              <input
                type="text"
                name="username"
                autocomplete="username"
                tabindex="-1"
                aria-hidden="true"
                style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"
              />
              <FormField :label="t('settings.password.current')">
                <SecretInput
                  v-model="pwCurrent"
                  is-password
                  :placeholder="t('settings.password.current_placeholder')"
                  autocomplete="current-password"
                  input-class="form-input"
                />
              </FormField>
              <FormField :label="t('settings.password.new')">
                <SecretInput
                  v-model="pwNew"
                  is-password
                  :placeholder="t('settings.password.new_placeholder')"
                  autocomplete="new-password"
                  input-class="form-input"
                />
              </FormField>
              <FormField :label="t('settings.password.confirm')">
                <SecretInput
                  v-model="pwConfirm"
                  is-password
                  :placeholder="t('settings.password.confirm_placeholder')"
                  autocomplete="new-password"
                  input-class="form-input"
                />
              </FormField>
              <div class="btn-row-end">
                <BaseButton type="submit" variant="primary" size="sm" :disabled="pwSubmitting">
                  <Spinner v-if="pwSubmitting" size="sm" />
                  {{ t('settings.password.update_btn') }}
                </BaseButton>
              </div>
            </form>
          </BaseCard>

          <!-- API Key -->
          <BaseCard density="roomy">
            <h3 class="settings-card-title">
              <MsIcon name="key" />
              ComfyCarry API Key
              <HelpTip :text="t('settings.api_key.help')" />
            </h3>
            <SecretInput
              v-model="apiKey"
              v-model:revealed="apiKeyRevealed"
              readonly
              copyable
              input-class="form-input mono-input"
              style="margin-bottom:12px"
              @copied="copyApiKey"
            />
            <div class="btn-row-end">
              <BaseButton variant="danger" size="sm" :disabled="regenLoading" @click="regenerateApiKey">
                <Spinner v-if="regenLoading" size="sm" />
                {{ t('settings.api_key.regenerate') }}
              </BaseButton>
            </div>
          </BaseCard>

          <!-- Export / Import -->
          <BaseCard density="roomy">
            <h3 class="settings-card-title">
              <MsIcon name="package_2" />
              {{ t('settings.config.title') }}
            </h3>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div>
                <p style="font-size:.82rem;color:var(--t2);margin:0 0 8px">{{ t('settings.config.export_desc') }}</p>
                <div class="btn-row-end">
                  <BaseButton variant="primary" size="sm" @click="exportConfig">
                    <MsIcon name="upload" color="none" />
                    {{ t('settings.config.export_btn') }}
                  </BaseButton>
                </div>
              </div>
              <div>
                <p style="font-size:.82rem;color:var(--t2);margin:0 0 8px">{{ t('settings.config.import_desc') }}</p>
                <div class="btn-row-end">
                  <BaseButton variant="primary" size="sm" @click="($refs.importFileInput as HTMLInputElement)?.click()">
                    <MsIcon name="download" color="none" />
                    {{ t('settings.config.import_btn') }}
                  </BaseButton>
                  <input ref="importFileInput" type="file" accept=".json" @change="importConfig" style="display:none" />
                </div>
              </div>
            </div>
          </BaseCard>

          <!-- Update -->
          <BaseCard density="roomy">
            <h3 class="settings-card-title">
              <MsIcon name="update" />
              {{ t('settings.update.title') }}
            </h3>
            <div class="update-info">
              <div class="update-row">
                <span class="update-label">{{ t('settings.update.current_version') }}</span>
                <span class="update-value">{{ app.version || '—' }} <code>{{ (app.commit || '').substring(0, 8) || '—' }}</code></span>
              </div>
              <div v-if="updateInfo" class="update-row">
                <span class="update-label">{{ t('settings.update.latest_commit') }}</span>
                <span class="update-value">{{ updateInfo.latest_version }}</span>
              </div>
              <div v-if="updateInfo" class="update-status">
                <StatusDot :status="updateInfo.has_update ? 'pending' : 'success'" />
                <span>{{ updateInfo.has_update ? t('settings.update.update_available') : t('settings.update.up_to_date') }}</span>
              </div>
            </div>
            <div v-if="updateApplying && updatePhase" class="update-phase">
              <Spinner size="sm" />
              <span>{{ updatePhase }}</span>
            </div>
            <div class="btn-row-end" style="gap:8px">
              <BaseButton size="sm" :disabled="updateChecking || updateApplying" @click="checkUpdate">
                <Spinner v-if="updateChecking" size="sm" />
                <MsIcon v-else name="refresh" />
                {{ t('settings.update.check_btn') }}
              </BaseButton>
              <BaseButton
                v-if="updateInfo?.has_update"
                variant="primary"
                size="sm"
                :disabled="updateApplying"
                @click="applyUpdate"
              >
                <Spinner v-if="updateApplying" size="sm" />
                <MsIcon v-else name="download" />
                {{ t('settings.update.apply_btn') }}
              </BaseButton>
            </div>
          </BaseCard>

          <!-- Reinitialize -->
          <BaseCard density="roomy" tone="danger" class="reinit-card">
            <h3 class="settings-card-title" style="color:var(--red)">
              <MsIcon name="warning" />
              {{ t('settings.reinit.title') }}
              <HelpTip :text="t('settings.reinit.help')" />
            </h3>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <label style="font-size:.82rem;color:var(--t2);display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" v-model="reinitKeepModels" class="form-checkbox" />
                {{ t('settings.reinit.keep_models') }}
              </label>
              <BaseButton variant="danger" size="sm" :disabled="reinitLoading" @click="reinitialize">
                <Spinner v-if="reinitLoading" size="sm" />
                {{ t('settings.reinit.btn') }}
              </BaseButton>
            </div>
          </BaseCard>
        </div>

        <!-- Right column: log -->
        <div class="log-col">
          <h3 class="settings-card-title" style="margin-bottom:12px">
            <MsIcon name="receipt_long" />
            {{ t('settings.log.title') }}
          </h3>
          <LogPanel :lines="logLines" :status="logStatus" style="height:calc(100% - 50px)" />
        </div>
      </div>

      <!-- ═══ Tab: Prompt Editor ═══════════════════════════ -->
      <div v-show="activeTab === 'prompt'" class="settings-centered">
        <!-- 翻译设置 -->
        <BaseCard density="roomy">
          <h3 class="settings-card-title">
            <MsIcon name="translate" />
            {{ t('settings.prompt.translation.title') }}
          </h3>
          <FormField :label="t('settings.prompt.translation.show')" layout="horizontal" density="compact">
            <ToggleSwitch v-model="promptSettings.show_translation" />
          </FormField>
          <FormField :label="t('settings.prompt.translation.provider')" density="compact">
            <BaseSelect
              v-model="promptSettings.translate_provider"
              :options="translateProviderOptions"
              :disabled="!promptSettings.show_translation"
            />
          </FormField>
        </BaseCard>

        <!-- 规格化设置 -->
        <BaseCard density="roomy">
          <h3 class="settings-card-title" style="margin-bottom:14px">
            <MsIcon name="auto_fix_high" />
            {{ t('settings.prompt.normalize.title') }}
            <span style="margin-left:auto">
              <ToggleSwitch :model-value="normalizeEnabled" @update:model-value="toggleNormalizeAll" />
            </span>
          </h3>
          <FormField :label="t('settings.prompt.normalize.comma')" layout="horizontal" density="compact">
            <ToggleSwitch v-model="promptSettings.normalize_comma" :disabled="!normalizeEnabled" />
          </FormField>
          <FormField :label="t('settings.prompt.normalize.period')" layout="horizontal" density="compact">
            <ToggleSwitch v-model="promptSettings.normalize_period" :disabled="!normalizeEnabled" />
          </FormField>
          <FormField :label="t('settings.prompt.normalize.bracket')" layout="horizontal" density="compact">
            <ToggleSwitch v-model="promptSettings.normalize_bracket" :disabled="!normalizeEnabled" />
          </FormField>
          <FormField :label="t('settings.prompt.normalize.underscore')" layout="horizontal" density="compact">
            <ToggleSwitch v-model="promptSettings.normalize_underscore" :disabled="!normalizeEnabled" />
          </FormField>
          <FormField :label="t('settings.prompt.normalize.escape_bracket')" layout="horizontal" density="compact">
            <ToggleSwitch v-model="promptSettings.escape_bracket" :disabled="!normalizeEnabled" />
          </FormField>
        </BaseCard>

        <!-- 自动补全设置 -->
        <BaseCard density="roomy">
          <h3 class="settings-card-title">
            <MsIcon name="auto_awesome" />
            {{ t('settings.prompt.autocomplete.title') }}
          </h3>
          <FormField :label="t('settings.prompt.autocomplete.limit')" density="compact">
            <BaseSelect
              v-model="promptSettings.autocomplete_limit"
              :options="promptAutocompleteOptions"
            />
          </FormField>
        </BaseCard>

        <!-- 标签库设置 -->
        <BaseCard density="roomy">
          <h3 class="settings-card-title">
            <MsIcon name="category" />
            {{ t('settings.prompt.tag_library.title') }}
          </h3>
          <FormField :label="t('settings.prompt.tag_library.show_nsfw')" layout="horizontal" density="compact">
            <ToggleSwitch v-model="promptSettings.show_nsfw" />
          </FormField>
        </BaseCard>

        <!-- 保存按钮 -->
        <div class="btn-row-end">
          <BaseButton variant="primary" size="sm" :disabled="promptSaving" @click="onSavePromptSettings">
            <Spinner v-if="promptSaving" size="sm" />
            <MsIcon v-else name="save" />
            {{ t('common.btn.save') }}
          </BaseButton>
        </div>
      </div>

      <!-- ═══ Tab: CivitAI ═══════════════════════════════ -->
      <div v-show="activeTab === 'civitai'" class="settings-centered">
        <BaseCard density="roomy">
          <h3 class="settings-card-title">
            <MsIcon name="palette" />
            CivitAI API Key
          </h3>
          <FormField>
            <template #label>
              {{ t('settings.civitai.key_prefix') }}
              <a href="https://civitai.com/user/account" target="_blank" style="color:var(--ac)">{{ t('settings.civitai.key_link') }}</a>
              {{ t('settings.civitai.key_suffix') }}
            </template>
            <SecretInput
              v-model="civitaiKey"
              :placeholder="t('settings.civitai.placeholder')"
              autocomplete="off"
              input-class="form-input"
            />
          </FormField>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <BaseButton variant="primary" size="sm" :disabled="civitaiSaving" @click="saveCivitaiKey">
              <Spinner v-if="civitaiSaving" size="sm" />
              {{ t('common.btn.save') }}
            </BaseButton>
            <BaseButton variant="danger" size="sm" square :title="t('common.btn.clear')" @click="clearCivitaiKey">
              <MsIcon name="delete" />
            </BaseButton>
          </div>
        </BaseCard>
      </div>

      <!-- ═══ Tab: LLM ═══════════════════════════════ -->
      <div v-show="activeTab === 'llm'" class="settings-centered">
        <!-- Provider & API Key -->
        <BaseCard density="roomy">
          <h3 class="settings-card-title">
            <MsIcon name="smart_toy" />
            {{ t('settings.llm.provider.title') }}
          </h3>
          <FormField :label="t('settings.llm.provider.label')" density="compact">
            <BaseSelect v-model="llmProvider" :options="llmProviders" value-key="id" label-key="name" :placeholder="t('settings.llm.provider.select_placeholder')" @change="onLlmProviderChange" />
          </FormField>
          <FormField :label="t('settings.llm.provider.api_key')" density="compact">
            <SecretInput
              v-model="llmApiKey"
              :placeholder="t('settings.llm.provider.api_key_placeholder')"
              autocomplete="off"
              input-class="form-input"
            />
          </FormField>
          <FormField v-if="showLlmBaseUrl" :label="t('settings.llm.provider.base_url')" density="compact">
            <input type="url" v-model="llmBaseUrl" class="form-input" placeholder="https://..." />
          </FormField>
        </BaseCard>

        <!-- Model -->
        <BaseCard density="roomy">
          <h3 class="settings-card-title">
            <MsIcon name="deployed_code" />
            {{ t('settings.llm.model.title') }}
          </h3>
          <FormField :label="t('settings.llm.model.label')" :hint="llmModelInfo" density="compact">
            <FieldControlRow>
              <BaseSelect
                v-model="llmModel"
                :options="llmModelSelectOptions"
                searchable
                :display-text="llmModelText"
                :placeholder="t('settings.llm.model.refresh_hint')"
                :search-placeholder="t('settings.llm.model.search_placeholder')"
                :empty-text="t('settings.llm.model.no_match')"
                @change="selectLlmModel"
              />
              <BaseButton size="sm" :disabled="llmFetchingModels" :title="t('settings.llm.model.fetch_title')" @click="fetchLlmModels">
                <Spinner v-if="llmFetchingModels" size="sm" />
                <MsIcon v-else name="refresh" color="var(--ac)" />
              </BaseButton>
            </FieldControlRow>
          </FormField>
        </BaseCard>

        <!-- Parameters -->
        <BaseCard density="roomy">
          <h3 class="settings-card-title">
            <MsIcon name="tune" color="#fbbf24" />
            {{ t('settings.llm.params.title') }}
          </h3>
          <FormField density="compact">
            <template #label>
              {{ t('settings.llm.params.temperature') }}
              <HelpTip :text="t('settings.llm.params.temperature_help')" />
            </template>
            <template #label-right>{{ llmTemperature.toFixed(1) }}</template>
            <input type="range" v-model.number="llmTemperature" min="0" max="2" step="0.1" class="form-range" />
            <template #below>
              <div class="gen-range-tips"><span>0</span><span>1</span><span>2</span></div>
            </template>
          </FormField>
          <FormField density="compact">
            <template #label>
              {{ t('settings.llm.params.max_tokens') }}
              <HelpTip :text="t('settings.llm.params.max_tokens_help')" />
            </template>
            <template #label-right>{{ llmMaxTokens }}</template>
            <input type="range" v-model.number="llmMaxTokens" min="100" max="16000" step="100" class="form-range" />
            <template #below>
              <div class="gen-range-tips"><span>100</span><span>4000</span><span>8000</span><span>16000</span></div>
            </template>
          </FormField>
          <FormField density="compact">
            <template #label>
              {{ t('settings.llm.params.stream') }}
              <HelpTip :text="t('settings.llm.params.stream_help')" />
            </template>
            <template #label-right>
              <ToggleSwitch v-model="llmStream" />
            </template>
          </FormField>
        </BaseCard>

        <!-- Save & Test -->
        <BaseCard density="roomy">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span
              v-if="llmTestResult"
              style="font-size:.85rem;margin-right:auto"
              :style="{ color: llmTestResult.ok ? 'var(--green)' : 'var(--red)' }"
            >
              {{ llmTestResult.message }}
            </span>
            <span v-else style="margin-right:auto"></span>
            <BaseButton size="sm" :disabled="llmTesting" @click="testLlmConnection">
              <Spinner v-if="llmTesting" size="sm" />
              <MsIcon v-else name="wifi_tethering" />
              {{ t('settings.llm.test_btn') }}
            </BaseButton>
            <BaseButton variant="primary" size="sm" :disabled="llmSaving" @click="saveLlmConfig">
              <Spinner v-if="llmSaving" size="sm" />
              <MsIcon v-else name="save" />
              {{ t('settings.llm.save_btn') }}
            </BaseButton>
          </div>
        </BaseCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Vue-unique: page wrapper */
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Vue-unique: log column sizing */
.log-col {
  min-height: 400px;
  max-height: calc(100vh - 200px);
  display: flex;
  flex-direction: column;
}

/* Vue-unique: button row align right */
.btn-row-end {
  display: flex;
  justify-content: flex-end;
}

/* Vue-unique: CivitAI / LLM centered layout */
.settings-centered {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
  margin: 8px auto 0;
}

/* Vue-unique: card heading inside settings */
.settings-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .92rem;
  font-weight: 600;
  margin: 0 0 14px;
}

/* Vue-unique: reinit danger card */
.reinit-card {
  border: 1px solid rgba(239, 68, 68, 0.25);
}

/* Vue-unique: update card info */
.update-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
  font-size: var(--text-sm);
}
.update-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.update-label {
  color: var(--t3);
  min-width: 100px;
  flex-shrink: 0;
}
.update-value {
  color: var(--t1);
}
.update-value code {
  font-family: 'IBM Plex Mono', monospace;
  font-size: var(--text-xs);
  background: var(--bg3);
  padding: 1px 5px;
  border-radius: var(--r-xs);
}
.update-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: var(--text-sm);
  font-weight: 500;
}
.update-phase {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: var(--text-sm);
  color: var(--t2);
}

/* Vue-unique: mono variant for API key display */
.mono-input {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .82rem;
  letter-spacing: .5px;
  padding-right: 72px;
}

/* Vue-unique: LLM range slider tick marks */
.gen-range-tips {
  display: flex;
  justify-content: space-between;
  font-size: .72rem;
  color: var(--t3);
  margin-top: 2px;
}
</style>
