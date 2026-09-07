<script setup lang="ts">
/**
 * 设置 tab: LLM — Provider/模型/参数。
 * group 式布局; 守卫经 useSettingsGuard 注册给 shell。
 * 模型下拉展开时自动刷新一次模型列表 (无刷新按钮)。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsGroup from '@/components/settings/SettingsGroup.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useSettingsGuard } from '@/composables/useSettingsGuard'
import { apiErrorText, type ApiErrorBody } from '@/utils/apiError'
import type { LlmProviderConfig, ModelOption, LlmConfigData } from '@/types/settings'

defineOptions({ name: 'SettingsTabLlm' })

const { t } = useI18n({ useScope: 'global' })
const { get, put, post } = useApiFetch()
const { toast } = useToast()

// ─── LLM state ────────────────────────────────────────────────────────────────

const llmProvidersLoaded = ref(false)
const llmProvider = ref('')
const llmApiKey = ref('')
const llmBaseUrl = ref('')
const llmModel = ref('')
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
const llmProviderKeys = ref<Record<string, LlmProviderConfig>>({})

type LlmProviderOption = {
  id: string
  labelKey: string
  baseUrlKind: 'openai' | 'anthropic' | 'none'
}

/** Provider IDs encode the wire protocol so the UI cannot create an invalid
 * provider/protocol pair. */
const LLM_PROVIDER_OPTIONS: LlmProviderOption[] = [
  { id: 'openai', labelKey: 'settings.llm.provider.openai', baseUrlKind: 'none' },
  { id: 'deepseek', labelKey: 'settings.llm.provider.deepseek', baseUrlKind: 'none' },
  { id: 'openrouter', labelKey: 'settings.llm.provider.openrouter', baseUrlKind: 'none' },
  { id: 'anthropic', labelKey: 'settings.llm.provider.anthropic', baseUrlKind: 'none' },
  { id: 'gemini', labelKey: 'settings.llm.provider.gemini', baseUrlKind: 'none' },
  { id: 'custom_openai', labelKey: 'settings.llm.provider.custom_openai', baseUrlKind: 'openai' },
  { id: 'custom_responses', labelKey: 'settings.llm.provider.custom_responses', baseUrlKind: 'openai' },
  { id: 'custom_anthropic', labelKey: 'settings.llm.provider.custom_anthropic', baseUrlKind: 'anthropic' },
]

function providerOption(providerId: string): LlmProviderOption | undefined {
  return LLM_PROVIDER_OPTIONS.find(p => p.id === providerId)
}

const llmProviderOptions = computed(() =>
  LLM_PROVIDER_OPTIONS.map(option => ({
    value: option.id,
    label: t(option.labelKey),
  })),
)

const llmModelSelectOptions = computed(() =>
  llmAllModels.value.map(m => ({ value: m.id, label: m.name || m.id })),
)

const showLlmBaseUrl = computed(() => {
  const kind = providerOption(llmProvider.value)?.baseUrlKind
  return !!kind && kind !== 'none'
})
const llmBaseUrlHelp = computed(() =>
  providerOption(llmProvider.value)?.baseUrlKind === 'anthropic'
    ? t('settings.llm.provider.base_url_desc_anthropic')
    : t('settings.llm.provider.base_url_desc_openai'),
)
const llmBaseUrlPlaceholder = computed(() =>
  providerOption(llmProvider.value)?.baseUrlKind === 'anthropic'
    ? t('settings.llm.provider.base_url_placeholder_anthropic')
    : t('settings.llm.provider.base_url_placeholder_openai'),
)

// ─── 守卫状态 ────────────────────────────────────────────────────────────────
// dirty = 表单值 ≠ 基线 (最近一次服务端确认值); 基线只在「加载成功 / 保存成功」时更新

function snapshotLlm(): string {
  return JSON.stringify({
    provider: llmProvider.value,
    api_key: llmApiKey.value,
    base_url: llmBaseUrl.value,
    model: llmModel.value,
    temperature: llmTemperature.value,
    max_tokens: llmMaxTokens.value,
    stream: llmStream.value,
  })
}

const llmSnapshot = ref('')
const llmFormDirty = computed(() => llmProvidersLoaded.value && snapshotLlm() !== llmSnapshot.value)

// ─── Load / actions ───────────────────────────────────────────────────────────

async function loadLlmTab() {
  const cfgData = await get<{ ok: boolean; data?: LlmConfigData }>('/api/llm/config')
  if (!cfgData?.ok || !cfgData.data) {
    loadError.value = true
    return
  }
  loadError.value = false
  llmProvidersLoaded.value = true
  const cfg = cfgData.data
  llmProviderKeys.value = cfg.provider_keys || {}
  if (cfg.provider) llmProvider.value = cfg.provider
  const savedProv = llmProviderKeys.value[cfg.provider || '']
  if (savedProv?.api_key) llmApiKey.value = savedProv.api_key
  if (cfg.base_url) llmBaseUrl.value = cfg.base_url
  else if (savedProv?.base_url) llmBaseUrl.value = savedProv.base_url
  if (cfg.temperature != null) llmTemperature.value = cfg.temperature
  if (cfg.max_tokens != null) llmMaxTokens.value = cfg.max_tokens
  llmStream.value = !!cfg.stream
  if (cfg.model) {
    llmModel.value = cfg.model
  }
  llmSnapshot.value = snapshotLlm()
}

function onLlmProviderChange() {
  const saved = llmProviderKeys.value[llmProvider.value]
  llmApiKey.value = saved?.api_key || ''
  llmBaseUrl.value = saved?.base_url || ''
  llmAllModels.value = []
  selectedLlmModel.value = null
  if (saved?.model) {
    llmModel.value = saved.model
  } else {
    llmModel.value = ''
  }
}

function selectLlmModel(value: string | number | boolean) {
  const model = llmAllModels.value.find(m => m.id === value)
  selectedLlmModel.value = model || null
}

/** 模型已按当前 provider+key 拉取过 (供「展开自动刷新一次」判断) */
const modelsFetchedFor = ref('')

async function fetchLlmModels(): Promise<boolean> {
  if (!llmProvider.value) { toast(t('settings.llm.err_no_provider'), 'error'); return false }
  if (!llmApiKey.value) { toast(t('settings.llm.err_no_key'), 'error'); return false }
  llmFetchingModels.value = true
  const data = await post<{ ok?: boolean; models?: ModelOption[]; error?: string }>('/api/llm/models', {
    provider: llmProvider.value,
    api_key: llmApiKey.value,
    base_url: llmBaseUrl.value,
  })
  llmFetchingModels.value = false
  if (!data?.ok) {
    toast(apiErrorText(data, t('settings.llm.model.fetch_failed')), 'error')
    return false
  }
  const models = (data.models || []).sort((a, b) => {
    const na = (a.name || a.id || '').toLowerCase()
    const nb = (b.name || b.id || '').toLowerCase()
    return na.localeCompare(nb)
  })
  llmAllModels.value = models
  if (llmModel.value) {
    selectedLlmModel.value = models.find(model => model.id === llmModel.value) || null
  } else if (models.length > 0) {
    const first = models[0]
    llmModel.value = first.id
    selectedLlmModel.value = first
  }
  modelsFetchedFor.value = `${llmProvider.value}|${llmApiKey.value}|${llmBaseUrl.value}`
  return true
}

/** select 展开时自动刷新一次 (provider/key/endpoint 变化后首次展开触发) */
function onModelSelectOpen() {
  const key = `${llmProvider.value}|${llmApiKey.value}|${llmBaseUrl.value}`
  if (!llmProvider.value || !llmApiKey.value) return
  if (modelsFetchedFor.value === key) return
  fetchLlmModels()
}

async function saveLlmConfig(): Promise<boolean> {
  if (!llmProvider.value) { toast(t('settings.llm.err_no_provider'), 'error'); return false }
  if (!llmApiKey.value) { toast(t('settings.llm.err_no_key'), 'error'); return false }
  llmSaving.value = true
  const body: Record<string, unknown> = {
    provider: llmProvider.value,
    api_key: llmApiKey.value,
    model: llmModel.value,
    temperature: llmTemperature.value,
    max_tokens: llmMaxTokens.value,
    stream: llmStream.value,
    base_url: llmBaseUrl.value,
  }
  const data = await put<{ ok?: boolean; error?: string }>('/api/llm/config', body)
  llmSaving.value = false
  if (!data) return false
  if (data.ok) {
    llmProviderKeys.value[llmProvider.value] = {
      ...llmProviderKeys.value[llmProvider.value],
      api_key: llmApiKey.value,
      model: llmModel.value,
      base_url: llmBaseUrl.value,
    }
    toast(t('settings.llm.config_saved'), 'success')
    return true
  } else {
    toast(apiErrorText(data, t('settings.llm.save_failed')), 'error')
    return false
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
    llmTestResult.value = { ok: true, message: `${t('settings.llm.test_success')}${extra ? ' ' + extra : ''}` }
  } else {
    llmTestResult.value = { ok: false, message: `${t('settings.llm.test_failed')}: ${apiErrorText(data, t('settings.llm.unknown_error'))}` }
  }
}

// ─── 守卫注册 ──
const guardHub = useSettingsGuard()
const provider = {
  isDirty: () => llmFormDirty.value,
  isSaving: () => llmSaving.value,
  save: saveLlmConfig,
  discard: async () => {
    try { await loadLlmTab() } finally { llmSnapshot.value = snapshotLlm() }
  },
}

// ─── 加载失败态 (async setup 由 Suspense 门控首渲, 失败显示错误+重试) ──
const loadError = ref(false)

async function retryLoad(): Promise<void> {
  await loadLlmTab()
}

// async setup: 数据就绪后才挂载渲染
await loadLlmTab()
onMounted(() => guardHub.register(provider))
onUnmounted(() => guardHub.unregister(provider))
</script>

<template>
  <div class="tab-panel settings-centered">
    <!-- 加载失败: 错误 + 重试 (不渲染表单, 防止初值冒充服务端值) -->
    <SettingsGroup v-if="loadError">
      <EmptyState icon="cloud_off" :message="t('common.load_failed')">
        <BaseButton size="sm" @click="retryLoad">{{ t('common.btn.retry') }}</BaseButton>
      </EmptyState>
    </SettingsGroup>

    <SettingsGroup
      v-else
      icon="smart_toy"
      :title="t('settings.llm.provider.title')"
      :help="t('settings.llm.provider.help')"
    >
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.llm.provider.label') }}</div>
          <div class="settings-row__desc">{{ t('settings.llm.provider.label_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect
            v-model="llmProvider"
            :options="llmProviderOptions"
            :placeholder="t('settings.llm.provider.select_placeholder')"
            @change="onLlmProviderChange"
          />
        </div>
      </div>
      <div v-if="showLlmBaseUrl" class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.llm.provider.base_url') }}</div>
          <div class="settings-row__desc">{{ llmBaseUrlHelp }}</div>
        </div>
        <div class="settings-row__control">
          <input type="url" v-model="llmBaseUrl" class="form-input" :placeholder="llmBaseUrlPlaceholder" />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('settings.llm.provider.api_key') }}</div>
          <div class="settings-row__desc">{{ t('settings.llm.provider.api_key_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <SecretInput
            v-model="llmApiKey"
            :placeholder="t('settings.llm.provider.api_key_placeholder')"
            autocomplete="off"
          />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('settings.llm.model.label') }}
            <HelpTip :text="t('settings.llm.model.model_help')" />
          </div>
          <div v-if="llmModelInfo" class="settings-row__desc">{{ llmModelInfo }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect
            v-model="llmModel"
            :options="llmModelSelectOptions"
            searchable
            allow-custom
            :placeholder="t('settings.llm.model.input_placeholder')"
            :search-placeholder="t('settings.llm.model.search_placeholder')"
            :empty-text="t('settings.llm.model.no_match')"
            @change="selectLlmModel"
            @open="onModelSelectOpen"
          />
        </div>
      </div>

      <!-- 测试连接: 动作行 (title+subtitle 左 + 按钮右, 结果为 feedback 文案) -->
      <div class="settings-action">
        <div class="settings-action__text">
          <div class="settings-action__title">{{ t('settings.llm.test_title') }}</div>
          <div class="settings-row__desc">{{ t('settings.llm.test_desc') }}</div>
          <div
            v-if="llmTestResult"
            class="settings-row__feedback"
            :class="llmTestResult.ok ? 'settings-row__feedback--ok' : 'settings-row__feedback--err'"
          >
            {{ llmTestResult.ok ? '✓' : '✗' }} {{ llmTestResult.message }}
          </div>
        </div>
        <BaseButton size="sm" :loading="llmTesting" @click="testLlmConnection">
          {{ t('settings.llm.test_btn') }}
        </BaseButton>
      </div>
    </SettingsGroup>

    <SettingsGroup icon="tune" :title="t('settings.llm.params.title')">
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('settings.llm.params.temperature') }}
            <HelpTip :text="t('settings.llm.params.temperature_help')" />
          </div>
          <div class="settings-row__desc">{{ t('settings.llm.params.temperature_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input type="number" v-model.number="llmTemperature" min="0" max="2" step="0.1" class="form-number" />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('settings.llm.params.max_tokens') }}
            <HelpTip :text="t('settings.llm.params.max_tokens_help')" />
          </div>
          <div class="settings-row__desc">{{ t('settings.llm.params.max_tokens_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input type="number" v-model.number="llmMaxTokens" min="100" max="16000" step="100" class="form-number" />
        </div>
      </div>
      <SettingsGroupToggleRow
        :label="t('settings.llm.params.stream')"
        :desc="t('settings.llm.params.stream_desc')"
        :help="t('settings.llm.params.stream_help')"
        v-model="llmStream"
      />
    </SettingsGroup>
  </div>
</template>

<style scoped>
</style>