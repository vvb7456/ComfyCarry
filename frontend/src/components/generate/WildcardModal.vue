<script setup lang="ts">
/**
 * WildcardModal — Wildcard file manager (CRUD + folder + insert).
 *
 * Layout: 700px BaseModal with folder filter + scrollable list.
 * Sub-views: inline rename, edit sub-modal, new-folder prompt.
 *
 * Legacy: gen-wc-modal / gen-wc-edit-modal / gen-wc-newfolder-modal in dashboard.html
 */
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import type { UseWildcardManagerReturn, WildcardItem } from '@/composables/generate/useWildcardManager'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'WildcardModal' })

const props = defineProps<{
  modelValue: boolean
  wc: UseWildcardManagerReturn
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  insert: [token: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const { confirm } = useConfirm()
const { toast } = useToast()

/* ── Folder select options ── */
const folderOptions = ref<{ value: string; label: string }[]>([])

watch(
  () => props.wc.folders.value,
  (dirs) => {
    const opts: { value: string; label: string }[] = [
      { value: '', label: t('generate.wildcard.all') },
      { value: '(root)', label: t('generate.wildcard.root') },
    ]
    for (const f of dirs) {
      opts.push({ value: f, label: f })
    }
    opts.push({ value: '__new__', label: t('generate.wildcard.new_folder') })
    folderOptions.value = opts
  },
  { immediate: true },
)

function onFolderChange(val: string | number | boolean) {
  const v = String(val)
  if (v === '__new__') {
    openNewFolder()
    return
  }
  props.wc.activeFolder.value = v
}

/* ── Rename inline ── */
const renamingName = ref<string | null>(null)
const renameInput = ref('')
const renameInputEl = ref<HTMLInputElement | null>(null)

function startRename(item: WildcardItem) {
  renamingName.value = item.name
  renameInput.value = item.name.split('/').pop() || item.name
  nextTick(() => {
    renameInputEl.value?.focus()
    renameInputEl.value?.select()
  })
}

async function commitRename(item: WildcardItem) {
  const newBase = renameInput.value.trim().replace(/[\\/]/g, '')
  const oldBase = item.name.split('/').pop() || ''
  if (!newBase || newBase === oldBase) {
    renamingName.value = null
    return
  }
  const parts = item.name.split('/')
  parts[parts.length - 1] = newBase
  const newFullName = parts.join('/')
  const ok = await props.wc.rename(item.name, newFullName)
  if (ok) toast(t('generate.wildcard.renamed'), 'success')
  else toast(t('generate.wildcard.rename_failed'), 'error')
  renamingName.value = null
}

function cancelRename() {
  renamingName.value = null
}

/* ── Edit sub-modal ── */
const editVisible = ref(false)
const editName = ref('')
const editContent = ref('')
const editLoading = ref(false)
async function openEdit(item: WildcardItem) {
  editName.value = item.name
  editContent.value = ''
  editLoading.value = true
  editVisible.value = true
  const content = await props.wc.editContent(item.name)
  editContent.value = content ?? ''
  editLoading.value = false
}

async function saveEdit() {
  const ok = await props.wc.saveContent(editName.value, editContent.value)
  if (ok) {
    toast(t('generate.wildcard.saved'), 'success')
    editVisible.value = false
  } else {
    toast(t('generate.wildcard.save_failed'), 'error')
  }
}

/* ── New folder prompt ── */
const newFolderVisible = ref(false)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement | null>(null)

function openNewFolder() {
  newFolderName.value = ''
  newFolderVisible.value = true
  nextTick(() => newFolderInput.value?.focus())
}

async function confirmNewFolder() {
  const name = newFolderName.value.trim().replace(/[\\/]/g, '')
  if (!name) {
    toast(t('generate.wildcard.folder_name'), 'warning')
    return
  }
  const ok = await props.wc.createFolder(name)
  if (ok) {
    newFolderVisible.value = false
  } else {
    toast(t('generate.wildcard.create_folder_failed'), 'error')
  }
}

/* ── Create wildcard ── */
async function onCreate() {
  const fullName = await props.wc.createWildcard()
  if (fullName) {
    // Auto-enter rename mode for the new item
    nextTick(() => {
      const item = props.wc.wildcards.value.find(w => w.name === fullName)
      if (item) startRename(item)
    })
  } else {
    toast(t('generate.wildcard.create_failed'), 'error')
  }
}

/* ── Delete ── */
async function onDelete(item: WildcardItem) {
  const yes = await confirm({
    title: t('generate.wildcard.confirm_delete'),
    message: item.name,
    variant: 'danger',
    confirmText: t('common.btn.delete'),
  })
  if (!yes) return
  const ok = await props.wc.remove(item.name)
  if (ok) toast(t('generate.wildcard.deleted'), 'success')
}

/* ── Insert ── */
function onInsert(item: WildcardItem) {
  const token = `__${item.name}__`
  emit('insert', token)
  toast(t('generate.wildcard.inserted', { name: item.name }), 'success')
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('generate.wildcard.title')"
    icon="shuffle"
    icon-color="none"
    width="700px"
    density="default"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- Toolbar: folder select (right-aligned) -->
    <div class="wc-toolbar">
      <BaseSelect
        :model-value="wc.activeFolder.value"
        :options="folderOptions"
        size="sm"
        class="wc-folder-select"
        @update:model-value="onFolderChange"
      />
    </div>

    <!-- List -->
    <div class="wc-list">
      <!-- Loading -->
      <div v-if="wc.loading.value" class="wc-empty">
        <Spinner size="md" />
      </div>

      <!-- Empty -->
      <div v-else-if="wc.filtered.value.length === 0" class="wc-empty">
        <MsIcon name="draft" size="lg" color="var(--t3)" />
        <span>{{ t('generate.wildcard.no_files') }}</span>
      </div>

      <!-- Items -->
      <template v-else>
        <div
          v-for="item in wc.filtered.value"
          :key="item.name"
          class="wc-row"
        >
          <!-- Name (click to rename) -->
          <template v-if="renamingName === item.name">
            <input
              ref="renameInputEl"
              v-model="renameInput"
              class="wc-rename-input"
              @blur="commitRename(item)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              @keydown.escape.prevent="cancelRename"
            >
          </template>
          <span
            v-else
            class="wc-row__name text-truncate"
            :title="t('generate.wildcard.click_rename')"
            @click="startRename(item)"
          >
            {{ item.name.split('/').pop() }}
          </span>

          <!-- Entry count -->
          <span class="wc-row__count">{{ item.entries }} {{ t('generate.wildcard.items') }}</span>

          <!-- Actions -->
          <button class="wc-icon-btn" :title="t('generate.wildcard.edit_content')" @click="openEdit(item)">
            <MsIcon name="edit" size="sm" color="none" />
          </button>
          <button class="wc-icon-btn" :title="t('generate.wildcard.insert_positive')" @click="onInsert(item)">
            <MsIcon name="add_circle" size="sm" color="none" />
          </button>
          <button class="wc-icon-btn wc-icon-btn--danger" :title="t('common.btn.delete')" @click="onDelete(item)">
            <MsIcon name="delete" size="sm" color="var(--red)" />
          </button>
        </div>
      </template>

      <!-- New wildcard button -->
      <div class="wc-new-row" @click="onCreate">
        <MsIcon name="add_circle" size="sm" color="var(--ac)" />
        <span>{{ t('generate.wildcard.new_file') }}</span>
      </div>
    </div>
  </BaseModal>

  <!-- Edit sub-modal (teleported) -->
  <Teleport to="body">
    <div v-if="editVisible" class="wc-overlay" @click.self="editVisible = false">
      <div class="wc-edit-box">
        <div class="wc-edit-header">
          <MsIcon name="edit_note" size="sm" color="none" />
          <h3 class="wc-edit-title">{{ editName.split('/').pop() }}</h3>
          <button class="wc-icon-btn" @click="editVisible = false">
            <MsIcon name="close" size="sm" color="var(--red)" />
          </button>
        </div>
        <textarea
          v-model="editContent"
          class="wc-edit-textarea"
          :placeholder="t('generate.wildcard.edit_placeholder')"
          :disabled="editLoading"
        />
        <div class="wc-edit-footer">
          <BaseButton size="sm" @click="editVisible = false">{{ t('common.btn.cancel') }}</BaseButton>
          <BaseButton size="sm" variant="primary" :loading="editLoading" @click="saveEdit">{{ t('common.btn.save') }}</BaseButton>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- New folder sub-modal (teleported) -->
  <Teleport to="body">
    <div v-if="newFolderVisible" class="wc-overlay" @click.self="newFolderVisible = false">
      <div class="wc-edit-box wc-edit-box--sm">
        <div class="wc-edit-header">
          <MsIcon name="create_new_folder" size="sm" color="none" />
          <h3 class="wc-edit-title">{{ t('generate.wildcard.new_folder_title') }}</h3>
          <button class="wc-icon-btn" @click="newFolderVisible = false">
            <MsIcon name="close" size="sm" color="var(--red)" />
          </button>
        </div>
        <input
          ref="newFolderInput"
          v-model="newFolderName"
          class="wc-folder-input"
          :placeholder="t('generate.wildcard.folder_placeholder')"
          @keydown.enter.prevent="confirmNewFolder"
        >
        <div class="wc-edit-footer">
          <BaseButton size="sm" @click="newFolderVisible = false">{{ t('common.btn.cancel') }}</BaseButton>
          <BaseButton size="sm" variant="primary" @click="confirmNewFolder">{{ t('generate.wildcard.create') }}</BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wc-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--sp-3);
}
.wc-folder-select { width: 50%; }

/* ── List ── */
.wc-list {
  max-height: 50vh;
  overflow-y: auto;
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
}

.wc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--t3);
  font-size: .86rem;
}

/* ── Row ── */
.wc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--bd);
  font-size: .86rem;
}
.wc-row:last-of-type { border-bottom: none; }

.wc-row__name {
  flex: 1;
  cursor: pointer;
  color: var(--t1);
}
.wc-row__name:hover { color: var(--ac); }

.wc-row__count {
  color: var(--t3);
  font-size: .76rem;
  white-space: nowrap;
}

.wc-rename-input {
  flex: 1;
  font-size: .86rem;
  padding: 2px 6px;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--ac);
  border-radius: var(--r-sm);
  color: var(--t1);
  outline: none;
}

/* ── Icon button ── */
.wc-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  background: none;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
  color: var(--t2);
  transition: background .15s;
}
.wc-icon-btn:hover { background: var(--bg3); }

/* ── New wildcard row ── */
.wc-new-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: .86rem;
  cursor: pointer;
  color: var(--ac);
  opacity: .8;
  transition: opacity .15s;
}
.wc-new-row:hover { opacity: 1; }

/* ── Overlay (sub-modals, above BaseModal z-1000 but below ConfirmDialog) ── */
.wc-overlay {
  position: fixed;
  inset: 0;
  z-index: 1001;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wc-edit-box {
  width: 560px;
  max-height: 70vh;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .3);
}
.wc-edit-box--sm { width: 400px; max-height: none; }

.wc-edit-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.wc-edit-title {
  margin: 0;
  flex: 1;
  font-size: 1rem;
  font-weight: 600;
  color: var(--t1);
}

.wc-edit-textarea {
  flex: 1;
  min-height: 200px;
  font-family: monospace;
  font-size: .85rem;
  padding: var(--sp-2);
  background: var(--bg);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  color: var(--t1);
  resize: vertical;
  outline: none;
}
.wc-edit-textarea:focus { border-color: var(--ac); }

.wc-edit-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
  flex-shrink: 0;
  padding-top: 10px;
  border-top: 1px solid var(--bd);
}

.wc-folder-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: .86rem;
  background: var(--bg);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  color: var(--t1);
  margin-bottom: 12px;
  outline: none;
}
.wc-folder-input:focus { border-color: var(--ac); }
</style>
