<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import WizardStepLayout from './WizardStepLayout.vue'
import FormField from '@/components/form/FormField.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'

const { t } = useI18n({ useScope: 'global' })
const { config, envVars, nextStep, prevStep } = useWizardState()

const confirmPassword = ref(config.password || '')
const sshKeysText = ref((config.ssh_keys || []).join('\n'))

// SSH password sync checkbox
const sshPwSync = computed({
  get: () => config.ssh_pw_sync !== false,
  set: (v: boolean) => { config.ssh_pw_sync = v },
})

// Sync SSH password when checkbox is on
watch(() => config.password, (pw) => {
  if (sshPwSync.value) {
    config.ssh_password = pw
  }
})

watch(sshPwSync, (sync) => {
  if (sync) config.ssh_password = config.password
})

// Sync SSH keys from textarea
watch(sshKeysText, (text) => {
  config.ssh_keys = text.split('\n').map(l => l.trim()).filter(Boolean)
})

const hasEnvPassword = computed(() => !!envVars.value.password)

const passwordMismatch = computed(() =>
  confirmPassword.value.length > 0 && config.password !== confirmPassword.value,
)

const nextDisabled = computed(() => {
  if (!config.password) return true
  if (passwordMismatch.value) return true
  if (!confirmPassword.value) return true
  return false
})

function onNext() {
  nextStep()
}

function onPrev() {
  prevStep()
}
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step1.title')"
    icon="lock"
    icon-color="#fbbf24"
    :description="t('wizard.step1.desc')"
    :next-disabled="nextDisabled"
    @prev="onPrev"
    @next="onNext"
  >
    <AlertBanner v-if="hasEnvPassword" tone="info" dense>
      {{ t('wizard.step1.env_password_hint') }}
    </AlertBanner>

    <FormField :label="t('wizard.step1.password')">
      <SecretInput
        v-model="config.password"
        is-password
        :placeholder="t('wizard.step1.password_placeholder')"
      />
    </FormField>

    <FormField :label="t('wizard.step1.confirm_password')" :error="passwordMismatch ? t('wizard.step1.mismatch') : undefined">
      <SecretInput
        v-model="confirmPassword"
        is-password
        :placeholder="t('wizard.step1.confirm_placeholder')"
      />
    </FormField>

    <!-- SSH section -->
    <div class="step-password__ssh-section">
      <ToggleSwitch v-model="sshPwSync">
        <span class="step-password__ssh-label">
          {{ t('wizard.step1.ssh_sync') }}
          <span class="step-password__ssh-hint" v-html="t('wizard.step1.ssh_sync_hint')" />
        </span>
      </ToggleSwitch>

      <CollapsibleGroup :title="t('wizard.step1.ssh_keys')" :suffix="t('wizard.common.optional')" :default-open="false">
        <textarea
          v-model="sshKeysText"
          rows="3"
          class="step-password__ssh-textarea"
          :placeholder="t('wizard.step1.ssh_keys_placeholder')"
        />
        <div class="step-password__hint" v-html="t('wizard.step1.ssh_keys_hint')" />
      </CollapsibleGroup>
    </div>
  </WizardStepLayout>
</template>

<style scoped>
.step-password__ssh-section {
  border-top: 1px solid var(--bd);
  margin-top: 16px;
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-password__ssh-label {
  font-size: .88rem;
}

.step-password__ssh-hint {
  font-size: .72rem;
  color: var(--t3);
}

.step-password__ssh-textarea {
  font-family: var(--mono);
  font-size: .82rem;
  resize: vertical;
  width: 100%;
  background: var(--bg2);
  color: var(--t1);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 10px 14px;
}

.step-password__hint {
  font-size: .78rem;
  color: var(--t3);
  margin-top: 4px;
  line-height: 1.5;
}

.step-password__hint :deep(code) {
  background: var(--bg3);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: .76rem;
}
</style>
