<script setup lang="ts">
/**
 * LlmSettingsModal — LLM 服务配置弹窗 (页内就近迁移自设置页)。
 *
 * 由 LlmModal 承载: 未配置空态的「配置」入口与已配置态模型行旁的设置按钮。
 * 表单为本地 ref + 快照基线 (非共享状态), 关闭 (取消 / Esc / 遮罩 / 关闭按钮)
 * 统一经过未保存检查, 放弃即丢弃本地草稿。
 * 保存成功后 emit('saved') — 由 LlmModal 调 llm.open() 刷新 configured/modelName。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useModalCloseGuard } from '@/composables/useModalCloseGuard'
import { apiErrorText } from '@/utils/apiError'
import type { LlmProviderConfig, ModelOption, LlmConfigData } from '@/types/settings'

defineOptions({ name: 'LlmSettingsModal' })

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存成功: 由宿主刷新 llm 配置状态 */
  saved: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, put, post } = useApiFetch()
const { toast } = useToast()

// ─── 表单状态 ────────────────────────────────────────────────────────────────

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
  if (m.context_length) parts.push(t('llm.settings.model.context_fmt', { n: m.context_length.toLocaleString() }))
  if (m.pricing?.prompt) parts.push(t('llm.settings.model.input_fmt', { n: m.pricing.prompt }))
  if (m.pricing?.completion) parts.push(t('llm.settings.model.output_fmt', { n: m.pricing.completion }))
  return parts.join(' · ')
})
const llmFetchingModels = ref(false)
const llmSaving = ref(false)
const llmTesting = ref(false)
const llmTestResult = ref<{ ok: boolean; message: string } | null>(null)
const llmProviderKeys = ref<Record<string, LlmProviderConfig>>({})
const llmProvidersLoaded = ref(false)

type LlmProviderOption = {
  id: string
  labelKey: string
  baseUrlKind: 'openai' | 'anthropic' | 'none'
}

/** Provider IDs encode the wire protocol so the UI cannot create an invalid
 * provider/protocol pair. */
const LLM_PROVIDER_OPTIONS: LlmProviderOption[] = [
  { id: 'openai', labelKey: 'llm.settings.provider.openai', baseUrlKind: 'none' },
  { id: 'deepseek', labelKey: 'llm.settings.provider.deepseek', baseUrlKind: 'none' },
  { id: 'openrouter', labelKey: 'llm.settings.provider.openrouter', baseUrlKind: 'none' },
  { id: 'anthropic', labelKey: 'llm.settings.provider.anthropic', baseUrlKind: 'none' },
  { id: 'gemini', labelKey: 'llm.settings.provider.gemini', baseUrlKind: 'none' },
  { id: 'custom_openai', labelKey: 'llm.settings.provider.custom_openai', baseUrlKind: 'openai' },
  { id: 'custom_responses', labelKey: 'llm.settings.provider.custom_responses', baseUrlKind: 'openai' },
  { id: 'custom_anthropic', labelKey: 'llm.settings.provider.custom_anthropic', baseUrlKind: 'anthropic' },
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
    ? t('llm.settings.provider.base_url_desc_anthropic')
    : t('llm.settings.provider.base_url_desc_openai'),
)
const llmBaseUrlPlaceholder = computed(() =>
  providerOption(llmProvider.value)?.baseUrlKind === 'anthropic'
    ? t('llm.settings.provider.base_url_placeholder_anthropic')
    : t('llm.settings.provider.base_url_placeholder_openai'),
)

// ─── 守卫状态: dirty = 表单值 ≠ 基线 (最近一次服务端确认值) ─────────────────

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

// ─── 加载: 打开弹窗时拉取服务端配置 ─────────────────────────────────────────

const loading = ref(true)
const loadError = ref(false)

async function loadAll(): Promise<void> {
  loading.value = true
  const cfgData = await get<{ ok: boolean; data?: LlmConfigData }>('/api/llm/config')
  loading.value = false
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
  if (cfg.model) llmModel.value = cfg.model
  llmSnapshot.value = snapshotLlm()
}

watch(() => props.modelValue, (open) => {
  if (open) {
    llmTestResult.value = null
    void loadAll()
  }
})

// ─── 表单动作 ────────────────────────────────────────────────────────────────

function onLlmProviderChange() {
  const saved = llmProviderKeys.value[llmProvider.value]
  llmApiKey.value = saved?.api_key || ''
  llmBaseUrl.value = saved?.base_url || ''
  llmAllModels.value = []
  selectedLlmModel.value = null
  llmModel.value = saved?.model || ''
}

function selectLlmModel(value: string | number | boolean) {
  const model = llmAllModels.value.find(m => m.id === value)
  selectedLlmModel.value = model || null
}

/** 模型已按当前 provider+key 拉取过 (供「展开自动刷新一次」判断) */
const modelsFetchedFor = ref('')

async function fetchLlmModels(): Promise<boolean> {
  if (!llmProvider.value) { toast(t('llm.settings.err_no_provider'), 'error'); return false }
  if (!llmApiKey.value) { toast(t('llm.settings.err_no_key'), 'error'); return false }
  llmFetchingModels.value = true
  const data = await post<{ ok?: boolean; models?: ModelOption[]; error?: string }>('/api/llm/models', {
    provider: llmProvider.value,
    api_key: llmApiKey.value,
    base_url: llmBaseUrl.value,
  })
  llmFetchingModels.value = false
  // 非 2xx 已由 useApiFetch 统一提示; 这里只判业务层 ok, 避免同一次失败弹两条
  if (!data) return false
  if (!data.ok) {
    toast(apiErrorText(data, t('llm.settings.model.fetch_failed')), 'error')
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
    if (first) {
      llmModel.value = first.id
      selectedLlmModel.value = first
    }
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
  if (!llmProvider.value) { toast(t('llm.settings.err_no_provider'), 'error'); return false }
  if (!llmApiKey.value) { toast(t('llm.settings.err_no_key'), 'error'); return false }
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
    llmSnapshot.value = snapshotLlm()
    return true
  }
  toast(apiErrorText(data, t('llm.settings.save_failed')), 'error')
  return false
}

async function testLlmConnection() {
  if (!llmProvider.value) { toast(t('llm.settings.err_no_provider'), 'error'); return }
  if (!llmApiKey.value) { toast(t('llm.settings.err_no_key'), 'error'); return }
  if (!llmModel.value) { toast(t('llm.settings.err_no_model'), 'error'); return }
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
    llmTestResult.value = { ok: true, message: `${t('llm.settings.test_success')}${extra ? ' ' + extra : ''}` }
  } else {
    llmTestResult.value = { ok: false, message: `${t('llm.settings.test_failed')}: ${apiErrorText(data, t('llm.settings.unknown_error'))}` }
  }
}

// ─── 保存并关闭 / 关闭守卫 ────────────────────────────────────────────────────

async function onSave(): Promise<void> {
  if (!await saveLlmConfig()) return
  toast(t('llm.settings.config_saved'), 'success')
  emit('saved')
  emit('update:modelValue', false)
}

// ─── 关闭守卫: 取消 / Esc / 遮罩 / 关闭按钮统一经过未保存检查 ────────────────

const requestClose = useModalCloseGuard({
  dirty: () => llmFormDirty.value,
  saving: () => llmSaving.value,
  texts: {
    title: () => t('llm.settings.discard_title'),
    message: () => t('llm.settings.discard_message'),
    discard: () => t('llm.settings.discard_button'),
    cancel: () => t('common.btn.cancel'),
  },
  onClose: () => emit('update:modelValue', false),
})
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('llm.settings.title')"
    icon="auto_awesome"
    width="600px"
    :close-on-overlay="!llmSaving"
    :close-on-esc="!llmSaving"
    @update:model-value="requestClose()"
  >
    <div v-if="loading" class="settings-skeleton" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="settings-skeleton__row">
        <div class="settings-skeleton__lines">
          <div class="settings-skeleton__line settings-skeleton__line--text" />
          <div class="settings-skeleton__line settings-skeleton__line--text-sm" />
        </div>
        <div class="settings-skeleton__line settings-skeleton__line--control" />
      </div>
    </div>

    <!-- 加载失败: 错误 + 重试 (不渲染表单, 防止初值冒充服务端值) -->
    <div v-else-if="loadError">
      <EmptyState icon="error_outline" :message="t('common.load_failed')">
        <BaseButton size="sm" @click="loadAll">{{ t('common.btn.retry') }}</BaseButton>
      </EmptyState>
    </div>

    <div v-else class="settings-lines">
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('llm.settings.provider.label') }}
            <HelpTip :text="t('llm.settings.provider.help')" />
          </div>
          <div class="settings-row__desc">{{ t('llm.settings.provider.label_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <BaseSelect
            v-model="llmProvider"
            :options="llmProviderOptions"
            :placeholder="t('llm.settings.provider.select_placeholder')"
            @change="onLlmProviderChange"
          />
        </div>
      </div>
      <div v-if="showLlmBaseUrl" class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('llm.settings.provider.base_url') }}</div>
          <div class="settings-row__desc">{{ llmBaseUrlHelp }}</div>
        </div>
        <div class="settings-row__control">
          <input type="url" v-model="llmBaseUrl" class="form-input" :placeholder="llmBaseUrlPlaceholder" />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">{{ t('llm.settings.provider.api_key') }}</div>
          <div class="settings-row__desc">{{ t('llm.settings.provider.api_key_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <SecretInput
            v-model="llmApiKey"
            :placeholder="t('llm.settings.provider.api_key_placeholder')"
            autocomplete="off"
          />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('llm.settings.model.label') }}
            <HelpTip :text="t('llm.settings.model.model_help')" />
          </div>
          <div v-if="llmModelInfo" class="settings-row__desc">{{ llmModelInfo }}</div>
        </div>
        <div class="settings-row__control settings-row__control--stack">
          <div class="settings-row__control-row">
            <BaseSelect
              v-model="llmModel"
              :options="llmModelSelectOptions"
              searchable
              allow-custom
              :placeholder="t('llm.settings.model.input_placeholder')"
              :search-placeholder="t('llm.settings.model.search_placeholder')"
              :empty-text="t('llm.settings.model.no_match')"
              @change="selectLlmModel"
              @open="onModelSelectOpen"
            />
            <BaseButton size="sm" :loading="llmTesting" :title="t('llm.settings.test_title')" @click="testLlmConnection">
              {{ t('llm.settings.test_btn') }}
            </BaseButton>
          </div>
          <div
            v-if="llmTestResult"
            class="settings-row__feedback"
            :class="llmTestResult.ok ? 'settings-row__feedback--ok' : 'settings-row__feedback--err'"
          >
            {{ llmTestResult.message }}
          </div>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('llm.settings.params.temperature') }}
            <HelpTip :text="t('llm.settings.params.temperature_help')" />
          </div>
          <div class="settings-row__desc">{{ t('llm.settings.params.temperature_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input type="number" v-model.number="llmTemperature" min="0" max="2" step="0.1" class="form-number" />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">
            {{ t('llm.settings.params.max_tokens') }}
            <HelpTip :text="t('llm.settings.params.max_tokens_help')" />
          </div>
          <div class="settings-row__desc">{{ t('llm.settings.params.max_tokens_desc') }}</div>
        </div>
        <div class="settings-row__control">
          <input type="number" v-model.number="llmMaxTokens" min="100" max="16000" step="100" class="form-number" />
        </div>
      </div>
      <SettingsGroupToggleRow
        :label="t('llm.settings.params.stream')"
        :desc="t('llm.settings.params.stream_desc')"
        :help="t('llm.settings.params.stream_help')"
        v-model="llmStream"
      />
    </div>

    <template #footer>
      <BaseButton :disabled="llmSaving" @click="requestClose()">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!llmFormDirty || loading || loadError"
        :loading="llmSaving"
        @click="onSave"
      >{{ t('common.btn.save') }}</BaseButton>
    </template>
  </BaseModal>
</template>