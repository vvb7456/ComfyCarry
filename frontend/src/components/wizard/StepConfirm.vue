<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardDeploy } from '@/composables/useWizardDeploy'
import { useToast } from '@/composables/useToast'
import WizardStepLayout from './WizardStepLayout.vue'
import WizardSummary from './WizardSummary.vue'
import WizardDeployView from './WizardDeployView.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

defineOptions({ name: 'StepConfirm' })

const { t } = useI18n({ useScope: 'global' })
const { config, deployState, importedConfig, prevStep, goToStep } = useWizardState()
const { startDeploy, resume } = useWizardDeploy()
const { toast } = useToast()

async function onDeploy() {
  const { ok, error } = await startDeploy()
  if (!ok) toast(error || t('wizard.deploy.start_fail'), 'error')
}

function onPrev() {
  prevStep()
}

function backToWizard() {
  deployState.value = 'idle'
  goToStep(0)
}

// Resume deploy if we're already deploying (e.g. page refresh during deploy)
if (deployState.value === 'deploying') {
  resume()
}
</script>

<template>
  <!-- Confirmation view (before deploy) -->
  <WizardStepLayout
    v-if="deployState === 'idle'"
    :title="t('wizard.step9.title')"
    icon="checklist"
    icon-color="#a78bfa"
    :description="t('wizard.step9.desc')"
    :next-label="t('wizard.btn.deploy')"
    next-variant="success"
    @prev="onPrev"
    @next="onDeploy"
  >
    <template #icon>
      <span class="ms ms-sm" style="color: #a78bfa">checklist</span>
    </template>

    <template #footer>
      <BaseButton variant="default" size="lg" @click="onPrev">
        {{ t('wizard.btn.prev') }}
      </BaseButton>
      <BaseButton variant="primary" size="lg" @click="onDeploy">
        <span class="ms ms-xs">rocket_launch</span>
        {{ t('wizard.btn.deploy') }}
      </BaseButton>
    </template>

    <WizardSummary :config="config" :imported-config="importedConfig" />
  </WizardStepLayout>

  <!-- Deploy in progress / done / error -->
  <WizardDeployView
    v-else
    @back-to-wizard="backToWizard"
  />
</template>
