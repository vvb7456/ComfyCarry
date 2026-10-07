<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import WizardStepLayout from './WizardStepLayout.vue'
import OptionCard from '@/components/ui/OptionCard.vue'

defineOptions({ name: 'StepAttention' })

const { t } = useI18n({ useScope: 'global' })
const { config, supportsAcceleratedAttention, nextStep, prevStep } = useWizardState()

function onNext() { nextStep() }
function onPrev() { prevStep() }
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step8.title')"
    icon="bolt"
    :description="t('wizard.step8.desc')"
    @prev="onPrev"
    @next="onNext"
  >
    <div class="step-attn__cards">
      <OptionCard
        class="step-attn__card"
        icon="tune"
        :title="t('wizard.step8.default_title')"
        :description="t('wizard.step8.default_desc')"
        :selected="config.attention === 'default'"
        @toggle="config.attention = 'default'"
      />

      <OptionCard
        class="step-attn__card"
        icon="local_fire_department"
        title="FlashAttention-2"
        :description="t('wizard.step8.fa2_desc')"
        :selected="config.attention === 'flash'"
        :disabled="!supportsAcceleratedAttention"
        @toggle="config.attention = 'flash'"
      >
        <div class="step-attn__param">{{ t('wizard.step8.fa2_param') }}</div>
      </OptionCard>

      <OptionCard
        class="step-attn__card"
        icon="eco"
        title="SageAttention-2"
        :description="t('wizard.step8.sa2_desc')"
        :selected="config.attention === 'sage'"
        :disabled="!supportsAcceleratedAttention"
        @toggle="config.attention = 'sage'"
      >
        <div class="step-attn__param">{{ t('wizard.step8.sa2_param') }}</div>
      </OptionCard>
    </div>
  </WizardStepLayout>
</template>

<style scoped>
.step-attn__cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 640px) {
  .step-attn__cards {
    grid-template-columns: 1fr;
  }
}

.step-attn__param {
  font-size: .72rem;
  color: var(--t3);
  margin-top: 6px;
}
</style>
