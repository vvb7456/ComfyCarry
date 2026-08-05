<script setup lang="ts">
import ModelMetaModal from './ModelMetaModal.vue'
import type { ModelMeta } from '@/types/models'

defineOptions({ name: 'CivitaiModelModal' })

defineProps<{
  modelValue: boolean
  meta: ModelMeta | null
  showDownload?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  preview: [images: string[], index: number]
}>()

function handlePreview(images: string[], index: number) {
  emit('preview', images, index)
}
</script>

<template>
  <ModelMetaModal
    :model-value="modelValue"
    :meta="meta"
    :show-download="showDownload"
    @update:model-value="emit('update:modelValue', $event)"
    @preview="handlePreview"
  />
</template>
