<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardLlm } from '@/composables/useWizardLlm'
import WizardStepLayout from './WizardStepLayout.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'StepLlm' })

const { t } = useI18n({ useScope: 'global' })
const { config, nextStep, prevStep } = useWizardState()
const {
  providers, models, modelsLoading, modelsError,
  showBaseUrl, showModelGroup,
  onProviderChange, fetchModels, initStep,
} = useWizardLlm()

const providerOptions = computed(() =>
  providers.value.map(p => ({
    value: p.id,
    label: p.id === 'custom' ? t('wizard.step6.custom_provider') : p.name,
  })),
)

const modelOptions = computed(() =>
  models.value.map(m => ({
    value: m.id,
    label: m.name || m.id,
  })),
)

const nextLabel = computed(() => {
  const hasApiKey = !!config.llm_api_key?.trim()
  const hasModel = !!config.llm_model
  return hasApiKey && hasModel ? t('wizard.btn.next') : t('wizard.btn.skip')
})

onMounted(() => {
  initStep()
})

function handleProviderChange(v: string | number | boolean) {
  config.llm_provider = String(v)
  onProviderChange()
}

function handleFetchModels() {
  fetchModels()
}

function onNext() { nextStep() }
function onPrev() { prevStep() }
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step6.title')"
    icon="psychology"
    icon-color="#818cf8"
    :description="t('wizard.step6.desc')"
    :next-label="nextLabel"
    @prev="onPrev"
    @next="onNext"
  >
    <FormField :label="t('wizard.step6.provider')">
      <BaseSelect
        :model-value="config.llm_provider"
        :options="providerOptions"
        :placeholder="t('wizard.step6.select_provider')"
        @update:model-value="handleProviderChange"
      />
    </FormField>

    <FormField :label="t('wizard.step6.api_key')">
      <SecretInput
        v-model="config.llm_api_key"
        :placeholder="t('wizard.step6.api_key_placeholder')"
      />
    </FormField>

    <FormField v-if="showBaseUrl" :label="t('wizard.step6.base_url')">
      <input
        v-model="config.llm_base_url"
        type="text"
        class="form-input"
        :placeholder="t('wizard.step6.base_url_placeholder')"
      />
    </FormField>

    <div v-if="showModelGroup" class="step-llm__model-group">
      <FormField :label="t('wizard.step6.model')">
        <div class="step-llm__model-row">
          <BaseSelect
            v-model="config.llm_model"
            :options="modelOptions"
            :placeholder="t('wizard.step6.model_placeholder')"
            searchable
            :search-placeholder="t('wizard.step6.search_model')"
            class="step-llm__model-select"
          />
          <BaseButton variant="default" size="sm" :loading="modelsLoading" @click="handleFetchModels">
            {{ t('wizard.step6.fetch_models') }}
          </BaseButton>
        </div>
        <template #below>
          <AlertBanner v-if="modelsError" tone="danger" dense>
            {{ modelsError }}
          </AlertBanner>
        </template>
      </FormField>
    </div>
  </WizardStepLayout>
</template>

<style scoped>
.step-llm__model-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.step-llm__model-select {
  flex: 1;
}

</style>
