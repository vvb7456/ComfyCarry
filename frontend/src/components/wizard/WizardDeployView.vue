<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useWizardDeploy } from '@/composables/useWizardDeploy'
import DeployStepList from './DeployStepList.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

const { t } = useI18n({ useScope: 'global' })

const {
  steps, logLines, status, elapsed, errorMsg, attnWarnings,
  retry,
} = useWizardDeploy()

const emit = defineEmits<{
  backToWizard: []
}>()

function enterDashboard() {
  location.reload()
}

async function onRetry() {
  await retry()
}
</script>

<template>
  <div class="wizard-deploy">
    <h2 class="wizard-deploy__title">
      <MsIcon v-if="status === 'success'" name="check_circle" size="sm" style="color: var(--green)" />
      <MsIcon v-else-if="status === 'error'" name="cancel" size="sm" style="color: var(--red)" />
      <MsIcon v-else name="settings" size="sm" style="color: #94a3b8" />
      <template v-if="status === 'success'">
        {{ t('wizard.deploy.done_title') }}
      </template>
      <template v-else-if="status === 'error'">
        {{ t('wizard.deploy.failed_title') }}
      </template>
      <template v-else>
        {{ t('wizard.deploy.deploying') }}
      </template>
    </h2>
    <p class="wizard-deploy__elapsed">{{ elapsed }}</p>

    <div class="wizard-deploy__content">
      <DeployStepList :steps="steps" />
      <LogPanel
        :lines="logLines"
        :status="status === 'deploying' ? 'live' : status === 'error' ? 'error' : 'standby'"
        height="100%"
        class="wizard-deploy__log"
      />
    </div>

    <!-- Error banner -->
    <AlertBanner v-if="status === 'error' && errorMsg" tone="danger">
      {{ errorMsg }}
    </AlertBanner>

    <!-- Attention warnings -->
    <AlertBanner v-if="attnWarnings.length > 0" tone="warning">
      {{ t('wizard.deploy.attn_warn', { names: attnWarnings.join(' / ') }) }}
    </AlertBanner>

    <!-- Success buttons -->
    <div v-if="status === 'success'" class="wizard-deploy__actions">
      <BaseButton variant="primary" size="lg" @click="enterDashboard">
        <MsIcon name="celebration" size="sm" style="color: #fbbf24" />
        {{ t('wizard.deploy.enter') }}
      </BaseButton>
    </div>

    <!-- Error buttons -->
    <div v-if="status === 'error'" class="wizard-deploy__actions">
      <BaseButton variant="default" @click="emit('backToWizard')">
        <MsIcon name="arrow_back" size="sm" style="color: #94a3b8" />
        {{ t('wizard.deploy.back_to_config') }}
      </BaseButton>
      <BaseButton variant="primary" size="lg" @click="onRetry">
        <MsIcon name="refresh" size="sm" style="color: #34d399" />
        {{ t('wizard.deploy.retry') }}
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.wizard-deploy__title {
  font-size: 1.3rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.wizard-deploy__elapsed {
  color: var(--t3);
  font-size: .88rem;
  margin-bottom: 16px;
}

.wizard-deploy__content {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  margin-bottom: 16px;
  height: 420px;
}

@media (max-width: 640px) {
  .wizard-deploy__content {
    grid-template-columns: 1fr;
    height: auto;
  }

  .wizard-deploy__log {
    height: 260px;
  }
}

.wizard-deploy__actions {
  display: flex;
  gap: 14px;
  margin-top: 16px;
}
</style>
