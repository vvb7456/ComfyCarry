<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
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
const { get, post, del } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const loadingList = ref(false)
const loadError = ref(false)
const saving = ref(false)
const deletingId = ref('')
const items = ref<CloudBackupSlot[]>([])
const maxManualSlots = ref(10)
const instanceGpuName = ref('')

// 'new' | slot.id
const selectedTarget = ref<string>('new')
const newSlotName = ref('')
const newNameInputRef = ref<HTMLInputElement | null>(null)

const manualSlots = computed(() => items.value.filter(item => !item.is_auto))
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
  maxManualSlots.value = data.max_manual_slots ?? 10
  if (data.instance_gpu_name) {
    instanceGpuName.value = data.instance_gpu_name
  }
  if (canCreateNew.value) {
    selectedTarget.value = 'new'
    if (!newSlotName.value) {
      newSlotName.value = formatDefaultName()
    }
  } else if (manualSlots.value[0]) {
    selectedTarget.value = manualSlots.value[0].id
  }
}

function selectNewSlot() {
  if (!canCreateNew.value) return
  selectedTarget.value = 'new'
  if (!newSlotName.value) {
    newSlotName.value = formatDefaultName()
  }
  nextTick(() => {
    newNameInputRef.value?.focus()
    newNameInputRef.value?.select()
  })
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
    if (selectedTarget.value === slot.id) {
      if (canCreateNew.value) {
        selectNewSlot()
      } else if (manualSlots.value[0]) {
        selectedTarget.value = manualSlots.value[0].id
      }
    }
  }
}

async function confirmSave() {
  saving.value = true
  let body: Record<string, unknown>
  if (selectedTarget.value === 'new') {
    const trimmed = newSlotName.value.trim() || formatDefaultName()
    body = { mode: 'new', name: trimmed }
  } else {
    body = { mode: 'overwrite', slot_id: selectedTarget.value }
  }
  const saved = await post<CloudBackupSlot>('/api/settings/cloud-backups', body)
  saving.value = false
  if (!saved) return
  toast(t('settings.config.cloud_saved'), 'success')
  emit('saved', saved)
  show.value = false
}

watch(() => props.modelValue, (open) => {
  if (open) {
    selectedTarget.value = 'new'
    newSlotName.value = ''
    void fetchSlots()
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
    <div v-if="loadingList" class="slot-modal__loading">
      <Spinner size="md" />
    </div>

    <div v-else-if="loadError" class="slot-modal__error">
      <EmptyState icon="error_outline" :message="t('settings.config.cloud_load_failed')">
        <BaseButton size="sm" @click="fetchSlots">{{ t('common.btn.retry') }}</BaseButton>
      </EmptyState>
    </div>

    <div v-else class="slot-list">
      <!-- 已有手动存档槽 -->
      <div
        v-for="slot in manualSlots"
        :key="slot.id"
        class="slot-item"
        :class="{ 'slot-item--selected': selectedTarget === slot.id }"
        role="radio"
        :aria-checked="selectedTarget === slot.id"
        tabindex="0"
        @click="selectedTarget = slot.id"
        @keydown.enter.prevent="selectedTarget = slot.id"
        @keydown.space.prevent="selectedTarget = slot.id"
      >
        <div class="slot-item__main">
          <div class="slot-item__title-row">
            <span class="slot-item__radio" :class="{ 'slot-item__radio--checked': selectedTarget === slot.id }" />
            <span class="slot-item__name">{{ slot.name }}</span>
            <span v-if="slot.gpu_name" class="slot-item__gpu">{{ slot.gpu_name }}</span>
          </div>
          <div class="slot-item__meta">
            <span>{{ formatDate(slot.updated_at) }}</span>
            <span v-for="tag in summaryTags(slot.summary)" :key="tag" class="slot-item__tag">{{ tag }}</span>
          </div>
        </div>
        <div class="slot-item__actions">
          <button
            type="button"
            class="slot-item__del-btn"
            :disabled="deletingId === slot.id"
            :title="t('common.btn.delete')"
            @click="deleteSlot(slot, $event)"
          >
            <MsIcon name="delete" size="xs" />
          </button>
        </div>
      </div>

      <!-- 新建存档槽 -->
      <div
        v-if="canCreateNew"
        class="slot-item slot-item--new"
        :class="{ 'slot-item--selected': selectedTarget === 'new' }"
        role="radio"
        :aria-checked="selectedTarget === 'new'"
        tabindex="0"
        @click="selectNewSlot"
        @keydown.enter.prevent="selectNewSlot"
        @keydown.space.prevent="selectNewSlot"
      >
        <div class="slot-item__main">
          <div class="slot-item__title-row">
            <span class="slot-item__radio" :class="{ 'slot-item__radio--checked': selectedTarget === 'new' }" />
            <span class="slot-item__name slot-item__name--new">{{ t('settings.config.new_slot_btn') }}</span>
          </div>
          <div v-if="selectedTarget === 'new'" class="slot-item__new-input-wrap" @click.stop>
            <input
              ref="newNameInputRef"
              v-model="newSlotName"
              type="text"
              class="form-input slot-item__new-input"
              maxlength="100"
              :placeholder="t('settings.config.new_slot_placeholder')"
              @keydown.enter.prevent="confirmSave"
            />
          </div>
        </div>
      </div>

      <div v-else class="slot-list__limit-hint">
        {{ t('settings.config.slot_limit_reached', { max: maxManualSlots }) }}
      </div>
    </div>

    <template #footer>
      <BaseButton size="sm" @click="emit('downloadLocal')">
        <MsIcon name="download" /> {{ t('settings.config.download_local_btn') }}
      </BaseButton>
      <BaseButton
        variant="primary"
        size="sm"
        :loading="saving"
        :disabled="loadingList || loadError"
        @click="confirmSave"
      >
        <MsIcon name="save" /> {{ t('settings.config.confirm_save_btn') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.slot-modal__loading {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}

.slot-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slot-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--rs);
  border: 1px solid var(--bd);
  background: var(--bg2);
  cursor: pointer;
  transition: border-color .15s, background .15s;
}

.slot-item:hover {
  border-color: var(--bd-f);
  background: var(--bg4);
}

.slot-item--selected {
  border-color: var(--ac);
  background: color-mix(in srgb, var(--ac) 8%, var(--bg2));
}

.slot-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slot-item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.slot-item__radio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--t3);
  flex-shrink: 0;
  position: relative;
}

.slot-item__radio--checked {
  border-color: var(--ac);
}

.slot-item__radio--checked::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: var(--ac);
}

.slot-item__name {
  font-weight: 600;
  font-size: .88rem;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slot-item__name--new {
  color: var(--ac);
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
  padding-left: 22px;
}

.slot-item__meta--muted {
  font-style: italic;
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

.slot-item__new-input-wrap {
  padding-left: 22px;
  margin-top: 4px;
}

.slot-item__new-input {
  width: 100%;
  font-size: .84rem;
  padding: 6px 10px;
}

.slot-list__limit-hint {
  font-size: .76rem;
  color: var(--t3);
  text-align: center;
  padding: 6px 4px;
}
</style>
