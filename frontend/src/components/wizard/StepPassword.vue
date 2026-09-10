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

defineOptions({ name: 'StepPassword' })

const { t } = useI18n({ useScope: 'global' })
const { config, envVars, nextStep, prevStep } = useWizardState()

const confirmPassword = ref(config.password || '')
const sshKeysText = ref((config.ssh_keys || []).join('\n'))

// SSH 密码跟随开关 (默认开, 与面板密码保持一致)。
// 默认值在此物化: 否则用户不拨动开关时 config.ssh_pw_follow 恒为
// undefined, 部署端 _step_ssh 会按 False 处理, 与 UI/摘要展示矛盾。
if (config.ssh_pw_follow === undefined) config.ssh_pw_follow = true
const sshPwFollow = computed({
  get: () => config.ssh_pw_follow !== false,
  set: (v: boolean) => { config.ssh_pw_follow = v },
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
      <ToggleSwitch v-model="sshPwFollow">
        <span class="step-password__ssh-label">
          {{ t('wizard.step1.ssh_pw_follow') }}
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
