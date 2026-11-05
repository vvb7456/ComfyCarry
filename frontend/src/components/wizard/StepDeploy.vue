<script setup lang="ts">
import { ref, computed, watchEffect, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from '@/composables/useWizardState'
import { useApiFetch } from '@/composables/useApiFetch'
import WizardStepLayout from './WizardStepLayout.vue'
import EnvInfoCard from './EnvInfoCard.vue'
import ModeCard from '@/components/ui/ModeCard.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import CloudReadConfigModal from '@/components/settings/CloudReadConfigModal.vue'
import type { CloudBackupSlot, CloudBackupsListResponse, CloudBackupSummary, ExportedConfig } from '@/types/config-export'

defineOptions({ name: 'StepDeploy' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const {
  config, gpuInfo, prebuiltInfo, detectedImageType, isUnsupported,
  importedConfig, selectedBackupName, managedTunnel,
  nextStep, applyImportedConfig, handleImportFile, selectMode: selectWizardMode,
} = useWizardState()

// Explicit mode selection — NOT derived from importedConfig
const selectedMode = ref<'fresh' | 'import'>('fresh')
const importError = ref('')
const readModalOpen = ref(false)
const uploadRef = ref<InstanceType<typeof FileUploadZone>>()
const pendingRecovery = ref<CloudBackupSlot | null>(null)
const dismissingRecovery = ref(false)

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function summaryTags(s?: CloudBackupSummary): string[] {
  if (!s) return []
  const tags: string[] = []
  if (s.has_rclone) tags.push(t('settings.config.summary_rclone'))
  if (s.sync_rules_count > 0) tags.push(t('settings.config.summary_rules', { count: s.sync_rules_count }))
  if (s.extra_plugins_count > 0) tags.push(t('settings.config.summary_plugins', { count: s.extra_plugins_count }))
  if (s.favorites_count > 0) tags.push(t('settings.config.summary_favorites', { count: s.favorites_count }))
  if (s.prompt_history_count > 0) tags.push(t('settings.config.summary_history', { count: s.prompt_history_count }))
  if (s.has_generate_state) tags.push(t('settings.config.summary_workspace'))
  return tags
}

async function checkPendingRecovery() {
  if (!managedTunnel.value) return
  const data = await get<CloudBackupsListResponse>('/api/settings/cloud-backups', { silent: true })
  if (data && data.pending_recovery) {
    pendingRecovery.value = data.pending_recovery
  }
}

watch(managedTunnel, (isManaged) => {
  if (isManaged) {
    void checkPendingRecovery()
  }
}, { immediate: true })

function applyPendingRecovery() {
  const snap = pendingRecovery.value
  if (!snap) return
  const payload = snap.config_json || snap.payload
  if (!payload) return
  importError.value = ''
  const label = t('settings.config.recovery_slot_name')
  const result = applyImportedConfig(payload, label)
  if (!result.ok) {
    importError.value = result.message
    return
  }
  selectedMode.value = 'import'
  nextStep()
}

async function dismissPendingRecovery() {
  if (dismissingRecovery.value) return
  dismissingRecovery.value = true
  await post('/api/settings/cloud-backups/recovery/dismiss', {}, { silent: true })
  dismissingRecovery.value = false
  pendingRecovery.value = null
}

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
  selectWizardMode(m)
  if (m === 'fresh') {
    importError.value = ''
    uploadRef.value?.clearFile()
  } else if (managedTunnel.value) {
    readModalOpen.value = true
  }
}

function onSelectCloudOrFileConfig(payload: { config: ExportedConfig; label: string; source: 'cloud' | 'file' }) {
  importError.value = ''
  const result = applyImportedConfig(payload.config, payload.label)
  if (!result.ok) {
    importError.value = result.message
  } else {
    selectedMode.value = 'import'
  }
}

async function onImportFile(file: File) {
  importError.value = ''
  const result = await handleImportFile(file)
  if (!result.ok) {
    importError.value = result.message
    uploadRef.value?.clearFile()
  }
}

function clearImport() {
  selectWizardMode('fresh')
  importError.value = ''
}

function onNext() {
  if (selectedMode.value === 'fresh') config.comfyui_args = ''
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

    <EnvInfoCard :gpu-info="gpuInfo ?? undefined" :prebuilt-info="prebuiltInfo ?? undefined" />

    <!-- 异常中断临时快照恢复提示卡片 (Office AutoRecover 风格) -->
    <div v-if="!isUnsupported && managedTunnel && pendingRecovery" class="step-deploy__recovery-card">
      <div class="step-deploy__recovery-main">
        <div class="step-deploy__recovery-header">
          <MsIcon name="history" size="sm" class="step-deploy__recovery-icon" />
          <span class="step-deploy__recovery-title">
            {{ t('wizard.step0.recovery.title', { gpu: pendingRecovery.gpu_name || 'GPU' }) }}
          </span>
          <span class="step-deploy__recovery-badge">{{ t('settings.config.recovery_slot_badge') }}</span>
        </div>
        <div class="step-deploy__recovery-meta">
          <span>{{ formatDate(pendingRecovery.updated_at) }}</span>
          <span v-for="tag in summaryTags(pendingRecovery.summary)" :key="tag" class="step-deploy__recovery-tag">
            {{ tag }}
          </span>
        </div>
      </div>
      <div class="step-deploy__recovery-actions">
        <BaseButton
          size="sm"
          :loading="dismissingRecovery"
          @click="dismissPendingRecovery"
        >
          {{ t('wizard.step0.recovery.dismiss_btn') }}
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          @click="applyPendingRecovery"
        >
          <MsIcon name="bolt" size="xs" /> {{ t('wizard.step0.recovery.restore_btn') }}
        </BaseButton>
      </div>
    </div>

    <div v-if="!isUnsupported" class="step-deploy__cards">
      <ModeCard
        icon="rocket_launch"
        :title="t('wizard.step0.fresh.title')"
        :description="t('wizard.step0.fresh.desc')"
        :selected="selectedMode === 'fresh'"
        @click="selectMode('fresh')"
      />

      <ModeCard
        icon="inventory_2"
        :title="managedTunnel ? t('wizard.step0.import_managed.title') : t('wizard.step0.import.title')"
        :description="managedTunnel ? t('wizard.step0.import_managed.desc') : t('wizard.step0.import.desc')"
        :selected="selectedMode === 'import'"
        @click="selectMode('import')"
      >
        <div v-if="managedTunnel && selectedBackupName" class="step-deploy__selected-tag">
          <MsIcon name="check_circle" size="xs" />
          <span>{{ t('wizard.step0.import_managed.selected_slot', { name: selectedBackupName }) }}</span>
        </div>
      </ModeCard>
    </div>

    <div v-if="selectedMode === 'import' && managedTunnel" class="step-deploy__import">
      <div v-if="importedConfig" class="step-deploy__selected-bar">
        <div class="step-deploy__selected-bar-info">
          <MsIcon name="check_circle" size="xs" />
          <span>{{ t('wizard.step0.import_managed.selected_slot', { name: selectedBackupName }) }}</span>
        </div>
        <BaseButton size="sm" @click="readModalOpen = true">
          <MsIcon name="swap_horiz" size="xs" /> {{ t('wizard.step0.import_managed.reselect') }}
        </BaseButton>
      </div>
      <div v-else class="step-deploy__selected-bar step-deploy__selected-bar--empty">
        <div class="step-deploy__selected-bar-info step-deploy__selected-bar-info--muted">
          <MsIcon name="inventory_2" size="xs" />
          <span>{{ t('wizard.step0.import_managed.none_selected') }}</span>
        </div>
        <BaseButton variant="primary" size="sm" @click="readModalOpen = true">
          <MsIcon name="cloud_download" size="xs" /> {{ t('wizard.step0.import_managed.choose_btn') }}
        </BaseButton>
      </div>
      <AlertBanner v-if="importError" tone="danger" dense>
        {{ importError }}
      </AlertBanner>
    </div>

    <div v-else-if="selectedMode === 'import'" class="step-deploy__import">
      <p class="step-deploy__import-hint" v-html="t('wizard.step0.import_upload.hint')" />
      <FileUploadZone
        ref="uploadRef"
        accept=".json"
        mode="drop"
        @file="onImportFile"
        @clear="clearImport"
        @error="importError = $event"
      />

      <AlertBanner v-if="importError" tone="danger" dense>
        {{ importError }}
      </AlertBanner>
    </div>

    <CloudReadConfigModal
      v-if="managedTunnel"
      v-model="readModalOpen"
      @select-config="onSelectCloudOrFileConfig"
    />
  </WizardStepLayout>
</template>

<style scoped>
.step-deploy__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
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
  font-family: var(--font-mono);
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

.step-deploy__selected-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ac);
  font-weight: 600;
  margin-top: 4px;
}

.step-deploy__selected-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r);
}

.step-deploy__selected-bar-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: .88rem;
  font-weight: 600;
  color: var(--green);
}

.step-deploy__selected-bar-info--muted {
  color: var(--t2);
  font-weight: 500;
}

.step-deploy__recovery-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  margin-bottom: 16px;
  border-radius: var(--r);
  border: 1px solid color-mix(in srgb, var(--ac) 45%, var(--bd));
  background: color-mix(in srgb, var(--ac) 8%, var(--bg2));
}

.step-deploy__recovery-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-deploy__recovery-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.step-deploy__recovery-icon {
  color: var(--ac);
}

.step-deploy__recovery-title {
  font-size: .9rem;
  font-weight: 600;
  color: var(--t1);
}

.step-deploy__recovery-badge {
  font-size: .68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ac) 18%, transparent);
  color: var(--ac);
  border: 1px solid color-mix(in srgb, var(--ac) 38%, transparent);
}

.step-deploy__recovery-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: .76rem;
  color: var(--t3);
  padding-left: 24px;
}

.step-deploy__recovery-tag {
  background: var(--bg3);
  border: 1px solid var(--bd);
  padding: 0 6px;
  border-radius: 4px;
  font-size: .7rem;
  color: var(--t2);
}

.step-deploy__recovery-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
</style>
