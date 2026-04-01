import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from './useWizardState'
import type { LlmProvider, LlmModel } from '@/types/wizard'

const WIZARD_LLM_PROVIDERS: LlmProvider[] = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'custom', name: '自定义 (OpenAI 兼容)' },
]

export function useWizardLlm() {
  const { t } = useI18n({ useScope: 'global' })
  const { config } = useWizardState()

  const models = ref<LlmModel[]>([])
  const modelsLoading = ref(false)
  const modelsError = ref('')
  const inited = ref(false)

  const providers = computed(() =>
    WIZARD_LLM_PROVIDERS.map(p =>
      p.id === 'custom' ? { ...p, name: t('wizard.step6.custom_provider') } : p
    )
  )

  /** Show base_url field only for custom provider */
  const showBaseUrl = computed(() => config.llm_provider === 'custom')

  /** Show model group when a provider is selected */
  const showModelGroup = computed(() => !!config.llm_provider)

  // ── Get provider display name ───────────────────────────────

  function getProviderName(id: string): string {
    if (id === 'custom') return t('wizard.step6.custom_provider')
    const p = WIZARD_LLM_PROVIDERS.find(p => p.id === id)
    return p?.name || id
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
        }
      } else {
        modelsError.value = d.error || t('wizard.step6.fetch_fail')
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
    showModelGroup,

    // Actions
    getProviderName,
    onProviderChange,
    fetchModels,
    selectModel,
    initStep,
  }
}
