<script setup lang="ts">
/**
 * I2IPanel — Image-to-Image / Inpainting unified module panel.
 *
 * Layout: horizontal split — left: params (flex:1), right: ref image area (280px).
 * Mode switch (ToggleSwitch): i2i / inpaint — both share the same FileUploadZone.
 * In inpaint mode, extra controls: growMaskBy slider + "Edit Mask" button.
 * In i2i mode, inpaint-specific controls are disabled (greyed out).
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import RangeField from '@/components/form/RangeField.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'I2IPanel' })

const emit = defineEmits<{
  pick: []
  file: [file: File]
  clear: []
  'mask-edit': []
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const store = useGenerateStore()
const state = computed(() => store.currentState)

const isInpaint = computed(() => state.value.i2i.mode === 'inpaint')
const hasImage = computed(() => !!state.value.i2i.image)
const hasMask = computed(() => !!state.value.i2i.mask)

/** Denoise range: slider always 0.10-1.00, but i2i mode soft-caps at 0.90 */
const denoiseSoftMax = computed(() => isInpaint.value ? undefined : 0.90)

// Clamp denoise when switching from inpaint to i2i
watch(() => state.value.i2i.mode, (mode) => {
  if (mode === 'i2i' && state.value.i2i.denoise > 0.90) {
    state.value.i2i.denoise = 0.90
  }
})

/** Build preview URL for the selected image */
const previewUrl = computed(() => {
  const img = state.value.i2i.image
  if (!img) return undefined
  return `/api/generate/input_image_preview?name=${encodeURIComponent(img)}`
})

/** Build preview URL for the mask overlay */
const maskPreviewUrl = computed(() => {
  const mask = state.value.i2i.mask
  if (!mask) return undefined
  return `/api/generate/input_image_preview?name=${encodeURIComponent(mask)}`
})

/** Extract just the filename for display */
const displayName = computed(() => {
  const img = state.value.i2i.image
  if (!img) return undefined
  return img.includes('/') ? img.slice(img.lastIndexOf('/') + 1) : img
})

/** Resolution display */
const resDisplay = computed(() => {
  if (!hasImage.value) return ''
  return `${state.value.width} × ${state.value.height}`
})

/** Handle "Edit Mask" button click */
function onEditMask() {
  if (!hasImage.value) {
    toast(t('generate.i2i.no_image_for_mask'), 'warning')
    return
  }
  emit('mask-edit')
}

/** Handle denoise update with correct clamping */
function onDenoiseUpdate(v: number) {
  const ceiling = denoiseSoftMax.value ?? 1.0
  state.value.i2i.denoise = Math.max(0.10, Math.min(ceiling, v))
}
</script>

<template>
  <div class="i2i-split">
    <!-- Left: parameters -->
    <div class="i2i-split__params">
      <!-- Mode switch -->
      <div class="i2i-mode-switch">
        <span class="i2i-mode-label" :class="{ active: !isInpaint }">{{ t('generate.i2i.mode_i2i') }}</span>
        <ToggleSwitch
          :model-value="isInpaint"
          size="md"
          @update:model-value="state.i2i.mode = $event ? 'inpaint' : 'i2i'"
        />
        <span class="i2i-mode-label" :class="{ active: isInpaint }">{{ t('generate.i2i.mode_inpaint') }}</span>
      </div>

      <!-- Denoise -->
      <RangeField
        :model-value="state.i2i.denoise"
        :min="0.10"
        :max="1.0"
        :soft-max="denoiseSoftMax"
        :step="0.01"
        :label="t('generate.i2i.denoise')"
        :marks="['0.10', '0.50', '1.00']"
        :value-format="(v: number) => v.toFixed(2)"
        editable
        @update:model-value="onDenoiseUpdate"
      >
        <template #label-append>
          <HelpTip :text="t('generate.i2i.denoise_help')" />
        </template>
      </RangeField>

      <!-- Grow Mask By (disabled in i2i mode, always visible) -->
      <RangeField
        :model-value="state.i2i.growMaskBy"
        :min="0"
        :max="64"
        :step="1"
        :label="t('generate.i2i.grow_mask_by')"
        :marks="['0', '16', '32', '64']"
        :disabled="!isInpaint"
        editable
        @update:model-value="state.i2i.growMaskBy = Math.max(0, Math.min(64, $event))"
      >
        <template #label-append>
          <HelpTip :text="t('generate.i2i.grow_mask_by_help')" />
        </template>
      </RangeField>

      <!-- Edit Mask button -->
      <BaseButton
        variant="default"
        :disabled="!isInpaint"
        size="sm"
        @click="onEditMask"
      >
        {{ t('generate.i2i.edit_mask') }}
      </BaseButton>
    </div>

    <!-- Right: reference image (FileUploadZone pick mode) -->
    <div class="i2i-split__media">
      <label class="field-lbl">{{ t('generate.i2i.ref_image') }}</label>
      <div class="i2i-ref-wrap">
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
        <!-- Mask overlay (shown when inpaint mode + has mask) -->
        <img
          v-if="isInpaint && hasMask && hasImage && maskPreviewUrl"
          :src="maskPreviewUrl"
          class="i2i-mask-overlay"
          alt="mask"
        />
      </div>
      <div v-if="resDisplay" class="i2i-ref-res">{{ resDisplay }}</div>
    </div>
  </div>
</template>

<style scoped>
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

/* Wrapper for image + mask overlay */
.i2i-ref-wrap {
  position: relative;
}

.i2i-ref-zone {
  height: 280px;
}

/* Mask overlay: semi-transparent red on top of reference image */
.i2i-mask-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  opacity: 0.45;
  mix-blend-mode: multiply;
  /* Tint white mask areas red via CSS filter */
  filter: sepia(1) saturate(5) hue-rotate(-30deg);
  border-radius: var(--r-md);
}

/* Mode switch: toggle with left/right labels */
.i2i-mode-switch {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.i2i-mode-label {
  font-size: var(--text-xs);
  color: var(--t3);
  transition: color .15s;
}
.i2i-mode-label.active {
  color: var(--t1);
  font-weight: 500;
}


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
