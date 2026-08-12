import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from './useWizardState'
import type { LlmProvider, LlmModel } from '@/types/wizard'
import { apiErrorText } from '@/utils/apiError'

type WizardLlmProviderOption = LlmProvider & {
  labelKey: string
  baseUrlKind: 'openai' | 'anthropic' | 'none'
}

const WIZARD_LLM_PROVIDERS: WizardLlmProviderOption[] = [
  { id: 'openai', name: '', labelKey: 'wizard.step6.openai', baseUrlKind: 'none' },
  { id: 'deepseek', name: '', labelKey: 'wizard.step6.deepseek', baseUrlKind: 'none' },
  { id: 'openrouter', name: '', labelKey: 'wizard.step6.openrouter', baseUrlKind: 'none' },
  { id: 'anthropic', name: '', labelKey: 'wizard.step6.anthropic', baseUrlKind: 'none' },
  { id: 'gemini', name: '', labelKey: 'wizard.step6.gemini', baseUrlKind: 'none' },
  { id: 'custom_openai', name: '', labelKey: 'wizard.step6.custom_openai', baseUrlKind: 'openai' },
  { id: 'custom_responses', name: '', labelKey: 'wizard.step6.custom_responses', baseUrlKind: 'openai' },
  { id: 'custom_anthropic', name: '', labelKey: 'wizard.step6.custom_anthropic', baseUrlKind: 'anthropic' },
]

function providerOption(providerId: string): WizardLlmProviderOption | undefined {
  return WIZARD_LLM_PROVIDERS.find(p => p.id === providerId)
}

export function useWizardLlm() {
  const { t } = useI18n({ useScope: 'global' })
  const { config } = useWizardState()

  const models = ref<LlmModel[]>([])
  const modelsLoading = ref(false)
  const modelsError = ref('')
  const inited = ref(false)

  const providers = computed(() =>
    WIZARD_LLM_PROVIDERS.map(p => ({ ...p, name: t(p.labelKey) }))
  )

  const showBaseUrl = computed(() => {
    const kind = providerOption(config.llm_provider)?.baseUrlKind
    return !!kind && kind !== 'none'
  })
  const baseUrlPlaceholder = computed(() =>
    providerOption(config.llm_provider)?.baseUrlKind === 'anthropic'
      ? t('wizard.step6.base_url_placeholder_anthropic')
      : t('wizard.step6.base_url_placeholder_openai'),
  )
  const baseUrlHelp = computed(() =>
    providerOption(config.llm_provider)?.baseUrlKind === 'anthropic'
      ? t('wizard.step6.base_url_help_anthropic')
      : t('wizard.step6.base_url_help_openai'),
  )

  /** Show model group when a provider is selected */
  const showModelGroup = computed(() => !!config.llm_provider)

  // ── Get provider display name ───────────────────────────────

  function getProviderName(id: string): string {
    const p = providerOption(id)
    return p ? t(p.labelKey) : id
  }

  // ── Provider change ─────────────────────────────────────────

  function onProviderChange() {
    // Clear model state on provider change
    config.llm_model = ''
    models.value = []
    modelsError.value = ''
  }

  // ── Fetch models from backend ───────────────────────────────

  async function fetchModels(preselect?: string) {
    if (!config.llm_provider || !config.llm_api_key) return

    modelsLoading.value = true
    modelsError.value = ''

    try {
      const res = await fetch('/api/llm/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: config.llm_provider,
          api_key: config.llm_api_key,
          base_url: config.llm_base_url,
        }),
      })
      const d = await res.json()
      if (d.ok && d.models) {
        models.value = (d.models as LlmModel[]).sort((a, b) =>
          (a.name || a.id).localeCompare(b.name || b.id),
        )
        if (preselect) {
          selectModel(preselect)
        } else if (!config.llm_model && models.value.length > 0) {
          selectModel(models.value[0].id)
        }
      } else {
        modelsError.value = apiErrorText(d, t('wizard.step6.fetch_fail'))
      }
    } catch (e: any) {
      modelsError.value = `${t('wizard.step6.request_fail')} ${e.message}`
    } finally {
      modelsLoading.value = false
    }
  }

  // ── Select model ────────────────────────────────────────────

  function selectModel(modelId: string) {
    config.llm_model = modelId
  }

  // ── Init step (called when entering step 6) ────────────────

  function initStep() {
    if (inited.value) return
    inited.value = true

    // Auto-fetch models if provider + key already restored from state/import
    if (config.llm_provider && config.llm_api_key) {
      fetchModels(config.llm_model || undefined)
    }
  }

  return {
    // Constants
    providers,

    // State
    models,
    modelsLoading,
    modelsError,

    // Computed
    showBaseUrl,
    baseUrlPlaceholder,
    baseUrlHelp,
    showModelGroup,

    // Actions
    getProviderName,
    onProviderChange,
    fetchModels,
    selectModel,
    initStep,
  }
}
