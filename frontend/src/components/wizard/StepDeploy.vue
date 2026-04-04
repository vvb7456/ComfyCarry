<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useWizardRclone } from '@/composables/useWizardRclone'
import WizardStepLayout from './WizardStepLayout.vue'
import EnvInfoCard from './EnvInfoCard.vue'
import ModeCard from '@/components/ui/ModeCard.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'StepDeploy' })

const { t } = useI18n({ useScope: 'global' })
const {
  config, gpuInfo, prebuiltInfo, detectedImageType, isUnsupported,
  importedConfig, nextStep, handleImportFile,
} = useWizardState()
const { loadImportedRemotes, resetDetectedRemotes } = useWizardRclone()

// Explicit mode selection — NOT derived from importedConfig
const selectedMode = ref<'fresh' | 'import'>('fresh')
const importError = ref('')
const uploadRef = ref<InstanceType<typeof FileUploadZone>>()

// If importedConfig was already loaded (e.g. page reload), sync mode
watchEffect(() => {
  if (importedConfig.value) selectedMode.value = 'import'
})

const nextDisabled = computed(() => {
  if (isUnsupported.value) return true
  if (selectedMode.value === 'import' && !importedConfig.value) return true
  return false
})

function selectMode(m: 'fresh' | 'import') {
  selectedMode.value = m
  if (m === 'fresh') {
    importedConfig.value = null
    importError.value = ''
    uploadRef.value?.clearFile()
    // Clear import-originated rclone remotes
    resetDetectedRemotes()
  }
}

async function onImportFile(file: File) {
  importError.value = ''
  const result = await handleImportFile(file)
  if (!result.ok) {
    importError.value = result.message
    uploadRef.value?.clearFile()
  } else if (config.rclone_config_value) {
    loadImportedRemotes(config.rclone_config_value)
  }
}

function clearImport() {
  importedConfig.value = null
  importError.value = ''
  resetDetectedRemotes()
}

function onNext() {
  nextStep()
}
</script>

<template>
  <WizardStepLayout
    :title="t('wizard.step0.title')"
    :show-prev="false"
    :next-disabled="nextDisabled"
    @next="onNext"
  >
    <template #description>
      <span v-if="detectedImageType === 'prebuilt'" class="step-deploy__env-ok">
        <MsIcon name="check_circle" size="xs" /> {{ t('wizard.step0.env_ok') }}
      </span>
      <span v-else-if="isUnsupported" class="step-deploy__env-fail">
        <MsIcon name="cancel" size="xs" /> {{ t('wizard.step0.env_fail') }}
      </span>
      <span v-else>{{ t('wizard.step0.detecting') }}</span>
    </template>

    <!-- GPU / Image info -->
    <EnvInfoCard :gpu-info="gpuInfo ?? undefined" :prebuilt-info="prebuiltInfo ?? undefined" />

    <!-- Deploy mode cards -->
    <div v-if="!isUnsupported" class="step-deploy__cards">
      <ModeCard
        icon="rocket_launch"
        icon-color="#f472b6"
        :title="t('wizard.step0.fresh.title')"
        :description="t('wizard.step0.fresh.desc')"
        :selected="selectedMode === 'fresh'"
        @click="selectMode('fresh')"
      >
        <span class="step-deploy__time">
          <MsIcon name="timer" size="xs" style="color: var(--amber)" />
          {{ t('wizard.step0.fresh.time_hint') }}
        </span>
      </ModeCard>

      <ModeCard
        icon="inventory_2"
        icon-color="#a78bfa"
        :title="t('wizard.step0.import.title')"
        :description="t('wizard.step0.import.desc')"
        :selected="selectedMode === 'import'"
        @click="selectMode('import')"
      >
        <span class="step-deploy__time">
          <MsIcon name="timer" size="xs" style="color: var(--amber)" />
          {{ t('wizard.step0.import.skip_hint') }}
        </span>
      </ModeCard>
    </div>

    <!-- Import file upload -->
    <div v-if="selectedMode === 'import'" class="step-deploy__import">
      <p class="step-deploy__import-hint" v-html="t('wizard.step0.import_upload.hint')" />
      <FileUploadZone
        ref="uploadRef"
        accept=".json"
        mode="drop"
        @file="onImportFile"
        @clear="clearImport"
      />

      <AlertBanner v-if="importError" tone="danger" dense>
        {{ importError }}
      </AlertBanner>
    </div>
  </WizardStepLayout>
</template>

<style scoped>
.step-deploy__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
}

.step-deploy__time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: .72rem;
  color: var(--t3);
  margin-top: 6px;
}

.step-deploy__import {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.step-deploy__import-hint {
  color: var(--t2);
  font-size: .88rem;
  margin: 0;
}

.step-deploy__import-hint :deep(code) {
  background: rgba(255, 255, 255, .08);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: .9em;
}

.step-deploy__env-ok {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--green);
}

.step-deploy__env-fail {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--red);
}
</style>
