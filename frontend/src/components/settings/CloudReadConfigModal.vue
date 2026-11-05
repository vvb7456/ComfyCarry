<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { errorMessage } from '@/utils/errorMessage'
import type {
  CloudBackupSlot,
  CloudBackupsListResponse,
  CloudBackupDetailResponse,
  CloudBackupSummary,
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
const uploadRef = ref<InstanceType<typeof FileUploadZone>>()

const allSlots = computed<CloudBackupSlot[]>(() => {
  const list: CloudBackupSlot[] = []
  if (pendingRecovery.value) {
    list.push(pendingRecovery.value)
  }
  for (const item of items.value) {
    if (!item.is_auto) {
      list.push(item)
    }
  }
  return list
})

function slotDisplayName(slot: CloudBackupSlot): string {
  if (slot.is_auto || slot.slot_type === 'recovery') {
    return t('settings.config.recovery_slot_name')
  }
  return slot.name
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
  const isRecovery = Boolean(slot.is_auto || slot.slot_type === 'recovery' || slot.id.startsWith('recovery-'))
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

async function deleteSlot(slot: CloudBackupSlot, ev: Event) {
  ev.stopPropagation()
  if (slot.is_auto) return
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

async function onLocalFile(file: File) {
  fileError.value = ''
  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as ExportedConfig
    if (!parsed || typeof parsed !== 'object' || !parsed._version) {
      fileError.value = t('settings.config.invalid_format')
      uploadRef.value?.clearFile()
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
    uploadRef.value?.clearFile()
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    fileError.value = ''
    uploadRef.value?.clearFile()
    void fetchSlots()
  }
})
</script>

<template>
  <BaseModal
    v-model="show"
    :title="t('settings.config.cloud_read_modal_title')"
    icon="cloud_download"
    size="md"
  >
    <div class="read-modal">
      <div class="read-modal__section">
        <div class="read-modal__section-title">
          <MsIcon name="cloud" size="xs" />
          <span>{{ t('settings.config.cloud_section_title') }}</span>
        </div>

        <div v-if="loadingList" class="read-modal__loading">
          <Spinner size="md" />
        </div>

        <div v-else-if="loadError" class="read-modal__error">
          <EmptyState icon="error_outline" :message="t('settings.config.cloud_load_failed')">
            <BaseButton size="sm" @click="fetchSlots">{{ t('common.btn.retry') }}</BaseButton>
          </EmptyState>
        </div>

        <div v-else-if="allSlots.length === 0" class="read-modal__empty">
          <EmptyState icon="inventory_2" :message="t('settings.config.cloud_empty')" />
        </div>

        <div v-else class="slot-list">
          <div
            v-for="slot in allSlots"
            :key="slot.id"
            class="slot-item"
            tabindex="0"
            @click="chooseSlot(slot)"
            @keydown.enter.prevent="chooseSlot(slot)"
          >
            <div class="slot-item__main">
              <div class="slot-item__title-row">
                <span class="slot-item__name">{{ slotDisplayName(slot) }}</span>
                <span v-if="slot.is_auto" class="slot-item__badge--auto">
                  {{ t('settings.config.recovery_slot_badge') }}
                </span>
                <span v-if="slot.gpu_name" class="slot-item__gpu">{{ slot.gpu_name }}</span>
              </div>
              <div class="slot-item__meta">
                <span>{{ formatDate(slot.updated_at) }}</span>
                <span v-for="tag in summaryTags(slot.summary)" :key="tag" class="slot-item__tag">{{ tag }}</span>
              </div>
            </div>
            <div class="slot-item__actions" @click.stop>
              <button
                v-if="!slot.is_auto"
                type="button"
                class="slot-item__del-btn"
                :disabled="deletingId === slot.id"
                :title="t('common.btn.delete')"
                @click="deleteSlot(slot, $event)"
              >
                <MsIcon name="delete" size="xs" />
              </button>
              <BaseButton
                size="sm"
                variant="primary"
                :loading="loadingSlotId === slot.id"
                @click="chooseSlot(slot)"
              >
                {{ t('settings.config.restore_slot_btn') }}
              </BaseButton>
            </div>
          </div>
        </div>
      </div>

      <div class="read-modal__divider" />

      <div class="read-modal__section">
        <div class="read-modal__section-title">
          <MsIcon name="upload_file" size="xs" />
          <span>{{ t('settings.config.local_section_title') }}</span>
        </div>
        <FileUploadZone
          ref="uploadRef"
          accept=".json"
          mode="drop"
          @file="onLocalFile"
          @clear="fileError = ''"
          @error="fileError = $event"
        />
        <AlertBanner v-if="fileError" tone="danger" dense>
          {{ fileError }}
        </AlertBanner>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.read-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.read-modal__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.read-modal__section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .82rem;
  font-weight: 600;
  color: var(--t2);
}

.read-modal__loading {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

.read-modal__divider {
  height: 1px;
  background: var(--bd);
}

.slot-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
}

.slot-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--rs);
  border: 1px solid var(--bd);
  background: var(--bg2);
  cursor: pointer;
  transition: border-color .15s, background .15s;
}

.slot-item:hover {
  border-color: var(--ac);
  background: var(--bg4);
}

.slot-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.slot-item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.slot-item__name {
  font-weight: 600;
  font-size: .88rem;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slot-item__badge--auto {
  font-size: .68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ac) 18%, transparent);
  color: var(--ac);
  border: 1px solid color-mix(in srgb, var(--ac) 38%, transparent);
}

.slot-item__gpu {
  font-size: .72rem;
  color: var(--t3);
  background: var(--bg3);
  padding: 1px 6px;
  border-radius: 4px;
}

.slot-item__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: .75rem;
  color: var(--t3);
}

.slot-item__tag {
  background: var(--bg3);
  border: 1px solid var(--bd);
  padding: 0 5px;
  border-radius: 4px;
  font-size: .7rem;
  color: var(--t2);
}

.slot-item__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.slot-item__del-btn {
  background: none;
  border: none;
  color: var(--t3);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--rs);
  display: flex;
  align-items: center;
  justify-content: center;
}

.slot-item__del-btn:hover {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 12%, transparent);
}
</style>
