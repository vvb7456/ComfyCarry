<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardRclone } from '@/composables/useWizardRclone'
import WizardStepLayout from './WizardStepLayout.vue'
import ModeCard from '@/components/ui/ModeCard.vue'
import FormField from '@/components/form/FormField.vue'
import FieldControlRow from '@/components/form/FieldControlRow.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

const { t } = useI18n({ useScope: 'global' })
const { config, envVars, remoteTypeDefs, nextStep, prevStep } = useWizardState()
const {
  selectedMethod, detectedRemotes, fileStatus,
  hasRcloneEnv, allRemoteNames,
  selectMethod, handleFile, submitRemote, removeRemote, initFromEnv,
} = useWizardRclone()

// Manual remote form state
const remoteName = ref('')
const remoteType = ref('')
const remoteParams = ref<Record<string, string>>({})
const remoteError = ref('')

const currentTypeDef = computed(() => {
  if (!remoteType.value) return null
  return remoteTypeDefs.value[remoteType.value] || null
})

const remoteTypeOptions = computed(() => {
  const entries = Object.entries(remoteTypeDefs.value)
  return entries.map(([key, def]) => ({ value: key, label: def.label }))
})

const nextLabel = computed(() => {
  if (selectedMethod.value) return t('wizard.btn.next')
  return t('wizard.btn.skip')
})

// Reset params when type changes
watch(remoteType, () => {
  remoteParams.value = {}
  remoteError.value = ''
})

onMounted(() => {
  initFromEnv()
})

function onFileUpload(file: File) {
  handleFile(file)
}

function onSubmitRemote() {
  remoteError.value = ''
  const result = submitRemote(remoteName.value, remoteType.value, { ...remoteParams.value })
  if (!result.ok) {
    remoteError.value = result.error || ''
    return
  }
  // Reset form
  remoteName.value = ''
  remoteType.value = ''
  remoteParams.value = {}
}

function onNext() { nextStep() }
function onPrev() { prevStep() }
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step3.title')"
    icon="cloud_sync"
    icon-color="#34d399"
    :next-label="nextLabel"
    @prev="onPrev"
    @next="onNext"
  >
    <template #description>
      <span>{{ t('wizard.step3.desc') }}</span>
      <HelpTip :text="t('wizard.step3.rclone_help')" />
    </template>

    <!-- Rclone helper hint -->
    <AlertBanner tone="info" dense icon="lightbulb">
      <span v-html="t('wizard.step3.rclone_helper_hint')" />
    </AlertBanner>

    <!-- Env hint -->
    <AlertBanner v-if="hasRcloneEnv" tone="info" dense>
      {{ t('wizard.step3.env_rclone_hint') }}
    </AlertBanner>

    <!-- Rclone method cards -->
    <div class="step-rclone__cards">
      <ModeCard
        v-if="hasRcloneEnv"
        icon="key"
        icon-color="#fbbf24"
        :title="t('wizard.step3.env_var')"
        :description="t('wizard.step3.env_var_desc')"
        :selected="selectedMethod === 'base64_env'"
        @click="selectMethod('base64_env')"
      />
      <ModeCard
        icon="folder_open"
        icon-color="#fbbf24"
        :title="t('wizard.step3.upload_file')"
        :description="t('wizard.step3.upload_file_desc')"
        :selected="selectedMethod === 'file'"
        @click="selectMethod('file')"
      />
      <ModeCard
        icon="build"
        icon-color="#fb923c"
        :title="t('wizard.step3.manual_create')"
        :description="t('wizard.step3.manual_create_desc')"
        :selected="selectedMethod === 'manual'"
        @click="selectMethod('manual')"
      />
    </div>

    <!-- File upload area -->
    <div v-if="selectedMethod === 'file'" class="step-rclone__manual-form">
      <FileUploadZone accept=".conf,.txt" mode="drop" @file="onFileUpload" />
      <span v-if="fileStatus" class="step-rclone__file-status">{{ fileStatus }}</span>
    </div>

    <!-- Manual remote form -->
    <div v-if="selectedMethod === 'manual'" class="step-rclone__manual-form">
      <FormField :label="t('wizard.step3.remote_name')">
        <input
          v-model="remoteName"
          type="text"
          class="form-input"
          :placeholder="t('wizard.step3.remote_name_placeholder')"
        />
      </FormField>

      <FormField :label="t('wizard.step3.remote_type')">
        <BaseSelect
          v-model="remoteType"
          :options="remoteTypeOptions"
          :placeholder="t('wizard.step3.select_type')"
        />
      </FormField>

      <!-- Dynamic fields from remote type definition -->
      <template v-if="currentTypeDef">
        <FormField
          v-for="field in currentTypeDef.fields"
          :key="field.key"
          :label="field.label"
          :required="field.required"
          :hint="field.help"
        >
          <BaseSelect
            v-if="field.type === 'select'"
            v-model="remoteParams[field.key]"
            :options="(field.options || []).map(o => ({ value: o, label: o }))"
            :placeholder="field.placeholder || ''"
          />
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="remoteParams[field.key]"
            class="form-input form-input--textarea"
            :placeholder="field.placeholder"
            rows="3"
          />
          <SecretInput
            v-else-if="field.type === 'password'"
            v-model="remoteParams[field.key]"
            is-password
            :placeholder="field.placeholder"
          />
          <input
            v-else
            v-model="remoteParams[field.key]"
            type="text"
            class="form-input"
            :placeholder="field.placeholder"
          />
        </FormField>
      </template>

      <AlertBanner v-if="remoteError" tone="danger" dense>{{ remoteError }}</AlertBanner>

      <FieldControlRow>
        <span aria-hidden="true" />
        <BaseButton variant="default" size="sm" @click="onSubmitRemote">
          {{ t('wizard.step3.add_remote') }}
        </BaseButton>
      </FieldControlRow>
    </div>

    <!-- Detected remotes -->
    <div v-if="detectedRemotes.length > 0" class="step-rclone__remotes-section">
      <label class="step-rclone__section-label">
        <MsIcon name="settings_input_antenna" size="sm" style="color: #34d399" />
        {{ t('wizard.step3.detected_remotes') }}
      </label>
      <div class="step-rclone__remote-chips">
        <span v-for="r in detectedRemotes" :key="r.name" class="step-rclone__chip">
          {{ r.name }} <span class="step-rclone__chip-type">{{ r.type }}</span>
        </span>
      </div>
    </div>

    <!-- Manually added remotes -->
    <div v-if="config.wizard_remotes.length > 0" class="step-rclone__remotes-section">
      <label class="step-rclone__section-label">
        <MsIcon name="build" size="sm" style="color: #fb923c" />
        {{ t('wizard.step3.manual_remotes') }}
      </label>
      <div class="step-rclone__remote-chips">
        <span v-for="r in config.wizard_remotes" :key="r.name" class="step-rclone__chip step-rclone__chip--removable">
          {{ r.name }} <span class="step-rclone__chip-type">{{ r.type }}</span>
          <BaseButton variant="ghost" size="xs" square :aria-label="t('wizard.step3.remove')" @click="removeRemote(r.name)">
            <MsIcon name="close" size="xs" />
          </BaseButton>
        </span>
      </div>
    </div>
  </WizardStepLayout>
</template>

<style scoped>
.step-rclone__cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 16px 0;
}

.step-rclone__input-area {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}

.step-rclone__file-status {
  font-size: .82rem;
  color: var(--t3);
}

.step-rclone__manual-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.step-rclone__remotes-section {
  margin-bottom: 20px;
}

.step-rclone__section-label {
  font-size: .92rem;
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.step-rclone__remote-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.step-rclone__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: 6px;
  font-size: .82rem;
  color: var(--t1);
}

.step-rclone__chip-type {
  color: var(--t3);
  font-size: .72rem;
}

.step-rclone__chip--removable {
  padding-right: 4px;
}
</style>
