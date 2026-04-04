<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import WizardStepLayout from './WizardStepLayout.vue'
import FormField from '@/components/form/FormField.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SecretInput from '@/components/ui/SecretInput.vue'

defineOptions({ name: 'StepCivitai' })

const { t } = useI18n({ useScope: 'global' })
const { config, envVars, nextStep, prevStep } = useWizardState()

const hasEnvCivitai = computed(() => !!envVars.value.civitai_token)

const nextLabel = computed(() =>
  config.civitai_token ? t('wizard.btn.next') : t('wizard.btn.skip'),
)

function onNext() { nextStep() }
function onPrev() { prevStep() }
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step5.title')"
    icon="palette"
    icon-color="#f472b6"
    :description="t('wizard.step5.desc')"
    :next-label="nextLabel"
    @prev="onPrev"
    @next="onNext"
  >
    <AlertBanner v-if="hasEnvCivitai" tone="info" dense>
      {{ t('wizard.step5.env_civitai_hint') }}
    </AlertBanner>

    <FormField>
      <template #label>
        {{ t('wizard.step5.api_key_label') }}
      </template>
      <template #label-right>
        <span class="step-civitai__hint" v-html="t('wizard.step5.api_key_hint')" />
      </template>
      <SecretInput
        v-model="config.civitai_token"
        :placeholder="t('wizard.step5.api_key_placeholder')"
      />
    </FormField>
  </WizardStepLayout>
</template>

<style scoped>
.step-civitai__hint {
  font-size: .78rem;
  font-weight: 400;
  color: var(--t3);
}

.step-civitai__hint :deep(a) {
  color: var(--ac);
  text-decoration: none;
}
</style>
