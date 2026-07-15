<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'FileUploadZone' })

const props = withDefaults(defineProps<{
  mode?: 'drop' | 'pick'
  accept?: string
  preview?: string
  fileName?: string
  pickLabel?: string
  uploadLabel?: string
  pickIcon?: string
  /** When set, replaces the bottom upload area with a custom action button */
  actionLabel?: string
  actionIcon?: string
  disabled?: boolean
  compact?: boolean
}>(), {
  mode: 'drop',
  accept: '',
  pickIcon: 'folder_open',
  actionIcon: 'auto_fix_high',
})

const emit = defineEmits<{
  file: [file: File]
  pick: []
  clear: []
  action: []
  error: [message: string]
}>()

const { t } = useI18n({ useScope: 'global' })

const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()
const loadedName = ref('')

const isPreview = computed(() => props.mode === 'pick' && !!props.preview)
const isLoaded = computed(() => props.mode === 'drop' && !!loadedName.value)

function triggerPick() {
  if (props.disabled) return
  fileInput.value?.click()
}

function onInputChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    loadedName.value = file.name
    emit('file', file)
  }
  if (fileInput.value) fileInput.value.value = ''
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (!props.disabled) dragging.value = true
}

function onDragLeave() {
  dragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  if (props.disabled) return

  const file = e.dataTransfer?.files?.[0]
  if (file) {
    if (props.accept && !matchAccept(file, props.accept)) {
      emit('error', t('common.upload.unsupported_type', { name: file.name }))
      return
    }
    loadedName.value = file.name
    emit('file', file)
  }
}

function clearFile() {
  loadedName.value = ''
  emit('clear')
}

function matchAccept(file: File, accept: string): boolean {
  return accept.split(',').some((pattern) => {
    const p = pattern.trim()
    if (p.startsWith('.')) return file.name.toLowerCase().endsWith(p.toLowerCase())
    if (p.endsWith('/*')) return file.type.startsWith(p.slice(0, -1))
    return file.type === p
  })
}

defineExpose({ clearFile })
</script>

<template>
  <div
    :class="[
      'upload-zone',
      {
        'upload-zone--dragging': dragging,
        'upload-zone--disabled': disabled,
        'upload-zone--preview': isPreview,
        'upload-zone--compact': compact,
        'upload-zone--loaded': isLoaded,
      },
    ]"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <input
      ref="fileInput"
      type="file"
      :accept="accept"
      class="upload-zone__input"
      @change="onInputChange"
    >

    <!-- Drop mode: file loaded -->
    <div v-if="mode === 'drop' && isLoaded" class="upload-zone__loaded">
      <MsIcon name="check_circle" color="none" class="upload-zone__loaded-icon" />
      <span class="upload-zone__loaded-name text-truncate">{{ loadedName }}</span>
      <button type="button" class="upload-zone__loaded-clear" @click.stop="clearFile">
        <MsIcon name="close" color="none" />
      </button>
    </div>

    <!-- Drop mode: empty -->
    <div v-else-if="mode === 'drop'" class="upload-zone__body" @click="triggerPick">
      <slot>
        <MsIcon name="upload_file" color="none" class="upload-zone__icon" />
        <p class="upload-zone__text">{{ t('common.upload.drop_hint') }}</p>
        <p class="upload-zone__hint">{{ t('common.upload.click_hint') }}</p>
      </slot>
    </div>

    <!-- Pick mode: with preview -->
    <template v-else-if="isPreview">
      <img :src="preview" class="upload-zone__img" alt="">
      <span class="upload-zone__clear" @click.stop="$emit('clear')">
        <MsIcon name="close" color="none" />
      </span>
      <span v-if="fileName" class="upload-zone__fname">{{ fileName }}</span>
    </template>

    <!-- Pick mode: no preview -->
    <template v-else>
      <div class="upload-zone__pick" @click="$emit('pick')">
        <MsIcon :name="pickIcon" color="none" />
        <span>{{ pickLabel || t('common.upload.pick_label') }}</span>
      </div>
      <div class="upload-zone__divider">{{ t('common.upload.or_divider') }}</div>
      <!-- Action variant: custom bottom action (e.g. open preprocess modal) -->
      <div v-if="actionLabel" class="upload-zone__drop" @click.stop="$emit('action')">
        <MsIcon :name="actionIcon" color="none" />
        <span>{{ actionLabel }}</span>
      </div>
      <!-- Default: upload local file -->
      <div v-else class="upload-zone__drop" @click="triggerPick">
        <MsIcon name="add_photo_alternate" color="none" />
        <span>{{ uploadLabel || t('common.upload.upload_label') }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.upload-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--bd);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color .15s, background .15s;
  overflow: hidden;
}

.upload-zone:hover,
.upload-zone--dragging { border-color: var(--ac); background: color-mix(in srgb, var(--ac) 5%, transparent); }
.upload-zone--disabled { opacity: .5; pointer-events: none; }
.upload-zone--loaded,
.upload-zone--preview { cursor: default; }

.upload-zone__input { display: none; }

.upload-zone__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 40px 20px;
  text-align: center;
  width: 100%;
}

.upload-zone__icon { font-size: 48px; color: var(--t3); margin-bottom: 8px; }
.upload-zone__text { color: var(--t2); font-size: .9rem; margin: 0; }
.upload-zone__hint { color: var(--t3); font-size: .8rem; margin: 0; }

.upload-zone--compact .upload-zone__body { padding: 16px 14px; flex-direction: row; gap: 8px; }
.upload-zone--compact .upload-zone__icon { font-size: 24px; margin-bottom: 0; }
.upload-zone--compact .upload-zone__text { font-size: .85rem; }
.upload-zone--compact .upload-zone__hint { font-size: .75rem; }

.upload-zone__img { width: 100%; height: 100%; object-fit: contain; border-radius: var(--r-sm); }

.upload-zone__clear {
  position: absolute;
  top: 6px; right: 6px;
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  background: #0000008c;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: opacity .15s;
}
.upload-zone:hover .upload-zone__clear { opacity: 1; }
.upload-zone__clear .ms { font-size: 16px; color: #fff; }

.upload-zone__fname {
  position: absolute;
  bottom: 6px; left: 50%; transform: translate(-50%);
  font-size: .65rem; color: var(--t3);
  background: #0006;
  padding: 2px 8px; border-radius: 4px;
  max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.upload-zone__loaded {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; width: 100%;
}
.upload-zone__loaded-icon { font-size: 20px; color: var(--green); }
.upload-zone__loaded-name { font-size: .88rem; color: var(--t1); flex: 1; }
.upload-zone__loaded-clear {
  background: none; border: none; color: var(--t3); cursor: pointer;
  padding: 2px; border-radius: 50%; display: inline-flex; align-items: center;
  transition: color .15s;
}
.upload-zone__loaded-clear:hover { color: var(--red); }
.upload-zone__loaded-clear .ms { font-size: 18px; }

.upload-zone__pick,
.upload-zone__drop {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  color: var(--t3); font-size: var(--text-xs);
  flex: 1; width: 100%; justify-content: center;
  cursor: pointer; transition: background .15s;
}
.upload-zone__pick:hover,
.upload-zone__drop:hover { background: color-mix(in srgb, var(--ac) 5%, transparent); }
.upload-zone__pick .ms,
.upload-zone__drop .ms { font-size: 2rem; opacity: .4; }

.upload-zone__divider {
  width: 80%; text-align: center; font-size: .7rem; color: var(--t3);
  position: relative; padding: 0 12px;
}
.upload-zone__divider::before,
.upload-zone__divider::after {
  content: ''; position: absolute; top: 50%; height: 1px; background: var(--bd);
  width: calc(50% - 16px);
}
.upload-zone__divider::before { left: 0; }
.upload-zone__divider::after { right: 0; }
</style>
