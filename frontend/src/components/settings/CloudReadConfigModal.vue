<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import ListRow, { type ListRowBadge } from '@/components/ui/ListRow.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { errorMessage } from '@/utils/errorMessage'
import { buildSlotFacts, isRecoverySlot } from '@/utils/cloudBackup'
import type {
  CloudBackupSlot,
  CloudBackupsListResponse,
  CloudBackupDetailResponse,
  ExportedConfig,
} from '@/types/config-export'

defineOptions({ name: 'CloudReadConfigModal' })

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  selectConfig: [payload: { config: ExportedConfig; label: string; source: 'cloud' | 'file'; isRecovery?: boolean }]
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, del } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const loadingList = ref(false)
const loadError = ref(false)
const loadingSlotId = ref('')
const deletingId = ref('')
const items = ref<CloudBackupSlot[]>([])
const pendingRecovery = ref<CloudBackupSlot | null>(null)
const fileError = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

const allSlots = computed<CloudBackupSlot[]>(() => {
  const list: CloudBackupSlot[] = []
  if (pendingRecovery.value) {
    list.push(pendingRecovery.value)
  }
  for (const item of items.value) {
    if (!isRecoverySlot(item)) {
      list.push(item)
    }
  }
  return list
})

function slotDisplayName(slot: CloudBackupSlot): string {
  if (isRecoverySlot(slot)) {
    return t('settings.config.recovery_slot_name')
  }
  return slot.name
}

function slotBadges(slot: CloudBackupSlot): ListRowBadge[] {
  const badges: ListRowBadge[] = []
  if (isRecoverySlot(slot)) {
    badges.push({ text: t('settings.config.recovery_slot_badge'), tone: 'caution' })
  }
  if (slot.gpu_name) {
    badges.push({ text: slot.gpu_name, tone: 'neutral' })
  }
  return badges
}

function slotFacts(slot: CloudBackupSlot): string[] {
  return buildSlotFacts(slot, t)
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
  pendingRecovery.value = data.pending_recovery || null
}

async function chooseSlot(slot: CloudBackupSlot) {
  if (loadingSlotId.value) return
  const label = slotDisplayName(slot)
  const isRecovery = isRecoverySlot(slot)
  const embedded = slot.config_json || slot.payload
  if (embedded && embedded._version) {
    emit('selectConfig', {
      config: embedded,
      label,
      source: 'cloud',
      isRecovery,
    })
    show.value = false
    return
  }
  loadingSlotId.value = slot.id
  const detail = await get<CloudBackupDetailResponse>(
    `/api/settings/cloud-backups/${encodeURIComponent(slot.id)}`,
  )
  loadingSlotId.value = ''
  if (!detail || !detail.config_json) return
  emit('selectConfig', {
    config: detail.config_json,
    label,
    source: 'cloud',
    isRecovery,
  })
  show.value = false
}

async function deleteSlot(slot: CloudBackupSlot) {
  if (isRecoverySlot(slot)) return
  const ok = await confirm({
    title: t('settings.config.delete_slot_confirm_title'),
    message: t('settings.config.delete_slot_confirm_msg', { name: slot.name }),
    variant: 'danger',
    confirmText: t('common.btn.delete'),
  })
  if (!ok) return
  deletingId.value = slot.id
  const res = await del<{ ok?: boolean }>(`/api/settings/cloud-backups/${encodeURIComponent(slot.id)}`)
  deletingId.value = ''
  if (res) {
    toast(t('settings.config.slot_deleted'), 'success')
    items.value = items.value.filter(i => i.id !== slot.id)
  }
}

async function onLocalFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  fileError.value = ''
  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as ExportedConfig
    if (!parsed || typeof parsed !== 'object' || !parsed._version) {
      fileError.value = t('settings.config.invalid_format')
      return
    }
    emit('selectConfig', {
      config: parsed,
      label: file.name,
      source: 'file',
    })
    show.value = false
  } catch (e: unknown) {
    fileError.value = `${t('settings.config.invalid_format')}: ${errorMessage(e)}`
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    fileError.value = ''
    void fetchSlots()
  }
})
</script>

<template>
  <BaseModal
    v-model="show"
    :title="t('settings.config.cloud_read_modal_title')"
    icon="cloud_download"
    size="lg"
    footer-align="start"
  >
    <LoadingCenter v-if="loadingList" />

    <EmptyState v-else-if="loadError" icon="error_outline" :message="t('settings.config.cloud_load_failed')">
      <BaseButton size="sm" @click="fetchSlots">{{ t('common.btn.retry') }}</BaseButton>
    </EmptyState>

    <EmptyState v-else-if="allSlots.length === 0" icon="inventory_2" :message="t('settings.config.cloud_empty')" />

    <ul v-else class="list-plain">
      <ListRow
        v-for="slot in allSlots"
        :key="slot.id"
        :icon="isRecoverySlot(slot) ? 'cloud_sync' : 'inventory_2'"
        :title="slotDisplayName(slot)"
        :badges="slotBadges(slot)"
        :facts="slotFacts(slot)"
      >
        <template #actions>
          <BaseButton
            size="sm"
            variant="primary"
            :loading="loadingSlotId === slot.id"
            @click="chooseSlot(slot)"
          >
            {{ t('settings.config.restore_slot_btn') }}
          </BaseButton>
          <BaseButton
            v-if="!isRecoverySlot(slot)"
            variant="ghost"
            size="sm"
            icon-only
            :disabled="deletingId === slot.id"
            :aria-label="t('common.btn.delete')"
            :title="t('common.btn.delete')"
            @click="deleteSlot(slot)"
          >
            <MsIcon name="delete" />
          </BaseButton>
        </template>
      </ListRow>
    </ul>

    <AlertBanner v-if="fileError" tone="danger" dense>
      {{ fileError }}
    </AlertBanner>

    <template #footer>
      <BaseButton size="sm" @click="fileInputRef?.click()">
        <MsIcon name="upload" /> {{ t('settings.config.local_section_title') }}
      </BaseButton>
      <input
        ref="fileInputRef"
        type="file"
        accept=".json"
        style="display: none"
        @change="onLocalFileChange"
      />
    </template>
  </BaseModal>
</template>
