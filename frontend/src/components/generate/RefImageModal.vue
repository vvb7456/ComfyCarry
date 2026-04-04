<script setup lang="ts">
/**
 * RefImageModal — Shared modal for picking reference images from ComfyUI input/.
 *
 * Used by I2I panel and ControlNet panels.
 * Legacy behavior: simple grid of image cards + upload card at the end.
 * No search/filter (matches old frontend gen-ref-modal).
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { InputImage } from '@/composables/generate/useRefImagePicker'
import BaseModal from '@/components/ui/BaseModal.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'RefImageModal' })

const props = defineProps<{
  modelValue: boolean
  title: string
  icon?: string
  images: InputImage[]
  loading: boolean
  uploading: boolean
  previewUrlFn: (name: string) => string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [name: string]
  upload: [file: File]
}>()

const { t } = useI18n({ useScope: 'global' })
const fileInputRef = ref<HTMLInputElement | null>(null)

function onSelect(name: string) {
  emit('select', name)
  emit('update:modelValue', false)
}

function onUploadClick() {
  fileInputRef.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    emit('upload', file)
    emit('update:modelValue', false)
    input.value = ''
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="title"
    :icon="icon || 'image'"
    size="lg"
    density="default"
    scroll="content"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="ref-modal">
      <!-- Loading -->
      <div v-if="loading" class="ref-state">
        <Spinner size="md" />
      </div>

      <!-- Image grid (legacy gen-ref-grid) + upload card always present -->
      <div v-else class="ref-grid">
        <div
          v-for="img in images"
          :key="img.name"
          class="ref-card"
          :title="img.name"
          @click="onSelect(img.name)"
        >
          <div class="ref-card__img-wrap">
            <img :src="previewUrlFn(img.name)" :alt="img.name" class="ref-card__img" loading="lazy">
          </div>
          <div class="ref-card__body">
            <span class="ref-card__name">{{ img.name.split('/').pop() }}</span>
            <span class="ref-card__size">{{ formatSize(img.size) }}</span>
          </div>
        </div>

        <!-- Upload card (legacy .upload-card) -->
        <div class="ref-card ref-card--upload" @click="onUploadClick">
          <MsIcon name="upload_file" color="none" class="ref-card__upload-icon" />
          <span>{{ t('generate.i2i.upload_local') }}</span>
        </div>
      </div>

      <input
        ref="fileInputRef"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        style="display: none"
        @change="onFileChange"
      >
    </div>
  </BaseModal>
</template>

<style scoped>
.ref-modal {
  min-height: 200px;
}

/* ── States ── */
.ref-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-6);
  color: var(--t3);
  font-size: .85rem;
}
.ref-state__icon {
  font-size: 2rem;
  opacity: .3;
}

/* ── Grid (legacy .gen-ref-grid) ── */
.ref-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--sp-2);
}

.ref-card {
  background: var(--bg3);
  border: 2px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  cursor: pointer;
  transition: border-color .15s, transform .15s, box-shadow .15s;
}
.ref-card:hover {
  border-color: var(--ac);
  transform: translateY(-1px);
  box-shadow: var(--sh);
}

.ref-card__img-wrap {
  width: 100%;
  aspect-ratio: 1;
  background: var(--bg-in, var(--bg2));
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ref-card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ref-card__body {
  padding: 6px 8px;
  min-width: 0; /* allow children to shrink below content size */
}
.ref-card__name {
  display: block;
  font-size: .72rem;
  color: var(--t2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ref-card__size {
  display: block;
  font-size: .65rem;
  color: var(--t3);
}

/* ── Upload card (legacy .upload-card) ── */
.ref-card--upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 130px;
  color: var(--t3);
  gap: 8px;
  font-size: .82rem;
  border-style: dashed;
}
.ref-card--upload:hover {
  color: var(--ac);
  border-color: var(--ac);
}
.ref-card__upload-icon {
  font-size: 2rem;
}
</style>
