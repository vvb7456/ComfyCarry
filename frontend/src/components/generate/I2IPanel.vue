<script setup lang="ts">
/**
 * I2IPanel — Image-to-Image module panel.
 *
 * Legacy layout (§10): horizontal split — left: denoise params, right: ref image area.
 * Uses FileUploadZone (mode="pick") for the reference image area.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import RangeField from '@/components/form/RangeField.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'

defineOptions({ name: 'I2IPanel' })

const emit = defineEmits<{
  pick: []
  file: [file: File]
  clear: []
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)

/** Build preview URL for the selected image */
const previewUrl = computed(() => {
  const img = state.value.i2i.image
  if (!img) return undefined
  return `/api/generate/input_image_preview?name=${encodeURIComponent(img)}`
})

/** Extract just the filename for display */
const displayName = computed(() => {
  const img = state.value.i2i.image
  if (!img) return undefined
  return img.includes('/') ? img.slice(img.lastIndexOf('/') + 1) : img
})

/** Resolution display (shown below the upload zone, like legacy .gen-ref-res) */
const hasImage = computed(() => !!state.value.i2i.image)
const resDisplay = computed(() => {
  if (!hasImage.value) return ''
  return `${state.value.width} × ${state.value.height}`
})
</script>

<template>
  <div class="i2i-split">
    <!-- Left: parameters -->
    <div class="i2i-split__params">
      <RangeField
        :model-value="state.i2i.denoise"
        :min="0.10"
        :max="0.90"
        :step="0.01"
        :label="t('generate.i2i.denoise')"
        :marks="['0.10', '0.50', '0.90']"
        :value-format="(v: number) => v.toFixed(2)"
        editable
        @update:model-value="state.i2i.denoise = Math.max(0.10, Math.min(0.90, $event))"
      >
        <template #label-append>
          <HelpTip :text="t('generate.i2i.denoise_help')" />
        </template>
      </RangeField>
    </div>

    <!-- Right: reference image (FileUploadZone pick mode) -->
    <div class="i2i-split__media">
      <label class="field-lbl">{{ t('generate.i2i.ref_image') }}</label>
      <FileUploadZone
        mode="pick"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        :preview="previewUrl"
        :file-name="displayName"
        :pick-label="t('generate.i2i.pick_from_input')"
        :upload-label="t('generate.i2i.upload_local')"
        pick-icon="image"
        class="i2i-ref-zone"
        @pick="emit('pick')"
        @file="emit('file', $event)"
        @clear="emit('clear')"
      />
      <div v-if="resDisplay" class="i2i-ref-res">{{ resDisplay }}</div>
    </div>
  </div>
</template>

<style scoped>
/* Legacy layout: flex with order swap — left=media(280px) right=params(flex) */
.i2i-split {
  display: flex;
  gap: var(--sp-4);
  align-items: stretch;
}

.i2i-split__params {
  flex: 1;
  min-width: 200px;
  max-width: 420px;
  order: 2;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--sp-3);
}

.i2i-split__media {
  flex: 0 0 auto;
  width: 280px;
  order: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.field-lbl {
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
}

.i2i-ref-zone {
  height: 280px;
}

/* Legacy .gen-ref-res — shown below the upload zone */
.i2i-ref-res {
  font-size: .6rem;
  color: var(--t3);
  opacity: .7;
  margin-top: 4px;
  text-align: center;
}

@media (max-width: 900px) {
  .i2i-split { flex-direction: column; }
  .i2i-split__media { max-width: 420px; width: 100%; }
  .i2i-split__params,
  .i2i-split__media { order: unset; }
}
</style>
