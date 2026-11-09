<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AddCard from '@/components/ui/AddCard.vue'
import OptionCard from '@/components/ui/OptionCard.vue'
import Badge from '@/components/ui/Badge.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import BaseInput from '@/components/form/BaseInput.vue'
import FormField from '@/components/form/FormField.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import type { CloudBackupSlot, CloudBackupsListResponse, CloudBackupSummary } from '@/types/config-export'

defineOptions({ name: 'CloudSaveConfigModal' })

const props = defineProps<{
  modelValue: boolean
  gpuName?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [slot: CloudBackupSlot]
  downloadLocal: []
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const loadingList = ref(false)
const loadError = ref(false)
const saving = ref(false)
const items = ref<CloudBackupSlot[]>([])
const maxManualSlots = ref(10)
const instanceGpuName = ref('')
const selectedTarget = ref<string>('')
const nameModalOpen = ref(false)
const newSlotName = ref('')

function isRecoverySlot(slot: CloudBackupSlot): boolean {
  return Boolean(slot.is_auto || slot.slot_type === 'recovery' || slot.id?.startsWith('recovery-'))
}

const manualSlots = computed(() => items.value.filter(item => !isRecoverySlot(item)))
const canCreateNew = computed(() => manualSlots.value.length < maxManualSlots.value)

function formatDefaultName(): string {
  const gpu = (instanceGpuName.value || props.gpuName || 'GPU').trim() || 'GPU'
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  return `${gpu} · ${mm}-${dd} ${hh}:${min}`
}

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

function slotDescription(slot: CloudBackupSlot): string {
  const s: CloudBackupSummary | undefined = slot.summary
  const parts: string[] = []
  const formatted = formatDate(slot.updated_at)
  if (formatted) parts.push(formatted)
  if (s) {
    if (s.has_rclone) parts.push(t('settings.config.summary_rclone'))
    if (s.sync_rules_count > 0) parts.push(t('settings.config.summary_rules', { count: s.sync_rules_count }))
    if (s.extra_plugins_count > 0) parts.push(t('settings.config.summary_plugins', { count: s.extra_plugins_count }))
    if (s.favorites_count > 0) parts.push(t('settings.config.summary_favorites', { count: s.favorites_count }))
    if (s.prompt_history_count > 0) parts.push(t('settings.config.summary_history', { count: s.prompt_history_count }))
    if (s.has_generate_state) parts.push(t('settings.config.summary_workspace'))
  }
  return parts.join(' · ')
}

async function fetchSlots() {
  loadingList.value = true
  loadError.value = false
  const data = await get<CloudBackupsListResponse>('/api/settings/cloud-backups')
  loadingList.value = false
  if (!data) {
    loadError.value = true
    return
  }
  items.value = data.items || []
  maxManualSlots.value = data.max_manual_slots ?? 10
  if (data.instance_gpu_name) {
    instanceGpuName.value = data.instance_gpu_name
  }
}

function openNameModal() {
  if (!canCreateNew.value) return
  newSlotName.value = formatDefaultName()
  nameModalOpen.value = true
}

async function confirmCreateNew() {
  if (saving.value) return
  saving.value = true
  const trimmed = newSlotName.value.trim() || formatDefaultName()
  const saved = await post<{ slot?: CloudBackupSlot } & CloudBackupSlot>('/api/settings/cloud-backups', {
    mode: 'new',
    name: trimmed,
  })
  saving.value = false
  if (!saved) return
  toast(t('settings.config.cloud_saved'), 'success')
  nameModalOpen.value = false
  emit('saved', saved.slot ?? saved)
  show.value = false
}

async function confirmOverwrite() {
  if (!selectedTarget.value || saving.value) return
  saving.value = true
  const saved = await post<{ slot?: CloudBackupSlot } & CloudBackupSlot>('/api/settings/cloud-backups', {
    mode: 'overwrite',
    slot_id: selectedTarget.value,
  })
  saving.value = false
  if (!saved) return
  toast(t('settings.config.cloud_saved'), 'success')
  emit('saved', saved.slot ?? saved)
  show.value = false
}

watch(() => props.modelValue, (open) => {
  if (open) {
    selectedTarget.value = ''
    nameModalOpen.value = false
    newSlotName.value = ''
    void fetchSlots()
  } else {
    nameModalOpen.value = false
  }
})
</script>

<template>
  <BaseModal
    v-model="show"
    :title="t('settings.config.cloud_save_modal_title')"
    icon="cloud_upload"
    size="md"
    footer-align="between"
  >
    <LoadingCenter v-if="loadingList" />

    <EmptyState v-else-if="loadError" icon="error_outline" :message="t('settings.config.cloud_load_failed')">
      <BaseButton size="sm" @click="fetchSlots">{{ t('common.btn.retry') }}</BaseButton>
    </EmptyState>

    <div v-else class="slot-stack">
      <AddCard
        v-if="canCreateNew"
        inline
        size="compact"
        :stretch="false"
        :label="t('settings.config.new_slot_btn')"
        @click="openNameModal"
      />

      <AlertBanner v-else tone="info" dense>
        {{ t('settings.config.slot_limit_reached', { max: maxManualSlots }) }}
      </AlertBanner>

      <OptionCard
        v-for="slot in manualSlots"
        :key="slot.id"
        variant="bg2"
        :selected="selectedTarget === slot.id"
        :title="slot.name"
        :description="slotDescription(slot)"
        @toggle="selectedTarget = slot.id"
      >
        <template v-if="slot.gpu_name" #badge>
          <Badge tone="neutral">{{ slot.gpu_name }}</Badge>
        </template>
      </OptionCard>
    </div>

    <template #footer>
      <BaseButton size="sm" @click="emit('downloadLocal')">
        <MsIcon name="download" /> {{ t('settings.config.download_local_btn') }}
      </BaseButton>
      <BaseButton
        variant="primary"
        size="sm"
        :loading="saving && !nameModalOpen"
        :disabled="loadingList || loadError || !selectedTarget"
        @click="confirmOverwrite"
      >
        <MsIcon name="save" /> {{ t('settings.config.confirm_save_btn') }}
      </BaseButton>
    </template>
  </BaseModal>

  <BaseModal
    v-model="nameModalOpen"
    :title="t('settings.config.new_slot_btn')"
    icon="add"
    size="sm"
    :z-index="1010"
  >
    <FormField :label="t('settings.config.new_slot_placeholder')">
      <BaseInput
        v-model="newSlotName"
        :placeholder="formatDefaultName()"
        @keydown.enter.prevent="confirmCreateNew"
      />
    </FormField>

    <template #footer>
      <BaseButton variant="ghost" size="sm" @click="nameModalOpen = false">
        {{ t('common.btn.cancel') }}
      </BaseButton>
      <BaseButton
        variant="primary"
        size="sm"
        :loading="saving"
        @click="confirmCreateNew"
      >
        <MsIcon name="save" /> {{ t('settings.config.confirm_save_btn') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.slot-stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
</style>
