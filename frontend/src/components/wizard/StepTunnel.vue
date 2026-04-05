<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardTunnel } from '@/composables/useWizardTunnel'
import WizardStepLayout from './WizardStepLayout.vue'
import ModeCard from '@/components/ui/ModeCard.vue'
import FormField from '@/components/form/FormField.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'StepTunnel' })

const { t } = useI18n({ useScope: 'global' })
const { config, envVars, activeTunnelMode, activeTunnelUrls, nextStep, prevStep } = useWizardState()
const {
  capacity, capacityLoading, capacityError,
  validating, validateResult, tunnelLocked,
  selectMode, loadCapacity, validateCfToken, initFromEnv,
} = useWizardTunnel()

const hasEnvCfToken = computed(() => !!envVars.value.cf_api_token)

const tunnelActiveHint = computed(() => {
  if (!activeTunnelMode.value) return ''
  if (activeTunnelMode.value === 'public') {
    const url = activeTunnelUrls.value.dashboard || ''
    return t('wizard.env_hint.tunnel_active_public', { url })
  }
  return t('wizard.env_hint.tunnel_active_custom')
})

const nextLabel = computed(() => {
  if (config.tunnel_mode === 'public' || config.tunnel_mode === 'custom') {
    return t('wizard.btn.next')
  }
  return t('wizard.btn.skip')
})

const nextDisabled = computed(() => {
  if (config.tunnel_mode === 'custom') {
    return !config.cf_api_token?.trim() || !config.cf_domain?.trim()
  }
  return false
})

const capacityText = computed(() => {
  if (capacityLoading.value) return t('wizard.step2.public.capacity_loading')
  if (capacityError.value) return t('wizard.step2.public.capacity_error')
  if (!capacity.value) return ''
  const c = capacity.value
  if (!c.available) return t('wizard.step2.public.capacity_full')
  return t('wizard.step2.public.capacity_info', {
    active: c.active_tunnels,
    max: c.max_tunnels,
  })
})

onMounted(() => {
  initFromEnv()
  loadCapacity()
})

function onNext() { nextStep() }
function onPrev() { prevStep() }
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step2.title')"
    icon="language"
    icon-color="#60a5fa"
    :description="t('wizard.step2.desc')"
    :next-label="nextLabel"
    :next-disabled="nextDisabled"
    @prev="onPrev"
    @next="onNext"
  >
    <AlertBanner v-if="tunnelActiveHint" tone="success" dense>
      {{ tunnelActiveHint }}
    </AlertBanner>

    <AlertBanner v-else-if="hasEnvCfToken" tone="info" dense>
      {{ t('wizard.env_hint.cf_detected') }}
    </AlertBanner>

    <!-- Tunnel mode cards -->
    <div class="step-tunnel__cards">
      <ModeCard
        icon="public"
        :title="t('wizard.step2.public.title')"
        :description="t('wizard.step2.public.desc')"
        :selected="config.tunnel_mode === 'public'"
        :active="activeTunnelMode === 'public'"
        :active-label="activeTunnelMode === 'public' ? t('wizard.step2.current_active') : ''"
        :disabled="tunnelLocked"
        @click="selectMode('public')"
      >
        <span class="step-tunnel__capacity">{{ capacityText }}</span>
      </ModeCard>

      <ModeCard
        icon="build"
        :title="t('wizard.step2.custom.title')"
        :description="t('wizard.step2.custom.desc')"
        :selected="config.tunnel_mode === 'custom'"
        :active="activeTunnelMode === 'custom'"
        :active-label="activeTunnelMode === 'custom' ? t('wizard.step2.current_active') : ''"
        :disabled="tunnelLocked"
        @click="selectMode('custom')"
      >
        <span class="step-tunnel__requirement">{{ t('wizard.step2.custom.requirement') }}</span>
      </ModeCard>
    </div>

    <!-- Public tunnel config (hidden when locked) -->
    <div v-if="config.tunnel_mode === 'public' && !tunnelLocked" class="step-tunnel__fields">
      <FormField>
        <template #label>{{ t('wizard.step2.subdomain') }} <span class="step-tunnel__optional">{{ t('wizard.common.optional') }}</span></template>
        <template #default>
          <div class="step-tunnel__subdomain-row">
            <input
              v-model="config.public_tunnel_subdomain"
              type="text"
              class="form-input"
              :placeholder="t('wizard.step2.public.subdomain_placeholder')"
              maxlength="32"
            />
            <span class="step-tunnel__suffix">.erocraft.org</span>
          </div>
        </template>
      </FormField>
    </div>

    <!-- Custom tunnel config (hidden when locked) -->
    <div v-if="config.tunnel_mode === 'custom' && !tunnelLocked" class="step-tunnel__fields">
      <FormField>
        <template #label>
          {{ t('wizard.step2.cf_token') }}
        </template>
        <template #label-right>
          <span class="step-tunnel__cf-hint" v-html="t('wizard.step2.cf_token_hint')" />
        </template>
        <SecretInput
          v-model="config.cf_api_token"
          is-password
          :placeholder="t('wizard.step2.cf_token_placeholder')"
        />
      </FormField>

      <FormField :label="t('wizard.step2.domain')">
        <input
          v-model="config.cf_domain"
          type="text"
          class="form-input"
          :placeholder="t('wizard.step2.domain_placeholder')"
        />
      </FormField>

      <FormField>
        <template #label>{{ t('wizard.step2.subdomain_prefix') }} <span class="step-tunnel__optional">{{ t('wizard.common.optional') }}</span></template>
        <input
          v-model="config.cf_subdomain"
          type="text"
          class="form-input"
          :placeholder="t('wizard.step2.subdomain_prefix_placeholder')"
        />
      </FormField>

      <div class="step-tunnel__validate-row">
        <BaseButton variant="default" size="sm" :loading="validating" @click="validateCfToken">
          <MsIcon name="search" size="sm" />
          {{ t('wizard.step2.validate_token') }}
        </BaseButton>
        <span v-if="validateResult" class="step-tunnel__validate-msg" :class="{ 'step-tunnel__validate-msg--ok': validateResult.ok, 'step-tunnel__validate-msg--err': !validateResult.ok }">
          {{ validateResult.message }}
        </span>
      </div>
    </div>
  </WizardStepLayout>
</template>

<style scoped>
.step-tunnel__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.step-tunnel__capacity {
  font-size: .72rem;
  color: var(--t3);
  margin-top: 6px;
  display: block;
}

.step-tunnel__requirement {
  font-size: .72rem;
  color: var(--t3);
  margin-top: 6px;
  display: block;
}

.step-tunnel__fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.step-tunnel__subdomain-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.step-tunnel__subdomain-row .form-input {
  flex: 1;
}

.step-tunnel__suffix {
  font-size: .82rem;
  color: var(--t3);
  flex-shrink: 0;
}

.step-tunnel__validate-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.step-tunnel__validate-msg {
  font-size: .85rem;
}

.step-tunnel__validate-msg--ok {
  color: var(--green);
}

.step-tunnel__validate-msg--err {
  color: var(--red);
}

.step-tunnel__optional {
  color: var(--t3);
  font-weight: 400;
  font-size: .82rem;
}

.step-tunnel__cf-hint {
  font-size: .78rem;
  font-weight: 400;
  color: var(--t3);
}

.step-tunnel__cf-hint :deep(a) {
  color: var(--ac);
  text-decoration: none;
}
</style>
