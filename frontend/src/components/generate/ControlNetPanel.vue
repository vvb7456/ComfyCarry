<script setup lang="ts">
/**
 * ControlNetPanel — Single ControlNet module panel (pose / canny / depth).
 *
 * Legacy layout (gen-mod-split): left=media area (280px) | right=params area (flex:1)
 *
 * Media area uses FileUploadZone with actionLabel to replace the bottom upload
 * with "从新图片生成" (opens PreprocessModal). Processing state is overlaid.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UseControlNetReturn } from '@/composables/generate/useControlNet'
import { CN_LABEL_KEYS } from '@/composables/generate/useControlNet'
import RangeField from '@/components/form/RangeField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import Spinner from '@/components/ui/Spinner.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'

defineOptions({ name: 'ControlNetPanel' })

const props = defineProps<{
  cn: UseControlNetReturn
}>()

const emit = defineEmits<{
  pick: []
  clear: []
  'open-preprocess': []
}>()

const { t } = useI18n({ useScope: 'global' })

const config = computed(() => props.cn.config.value)

/** Preview URL for the currently selected reference image */
const previewUrl = computed(() => {
  const img = config.value.image
  if (!img) return undefined
  return `/api/generate/input_image_preview?name=${encodeURIComponent(img)}`
})

/** Display name for the selected image */
const displayName = computed(() => {
  const img = config.value.image
  if (!img) return undefined
  return img.includes('/') ? img.slice(img.lastIndexOf('/') + 1) : img
})

/** Model select options — string array from options */
const modelOptions = computed(() => props.cn.models.value)

/** Pick label text: "点击选择骨骼图" etc. */
const pickLabel = computed(() => {
  const labelKey = CN_LABEL_KEYS[props.cn.type] || 'generate.controlnet.ref_image'
  return t('generate.controlnet.pick_ref', { label: t(labelKey) })
})

/** Media zone is in the processing state */
const isProcessing = computed(() => props.cn.preprocessStatus.value === 'running')
</script>

<template>
  <div class="cn-split">
    <!-- Left: media area (reference image) -->
    <div class="cn-split__media">
      <label class="field-lbl">{{ t(cn.refLabelKey) }}</label>

      <div class="cn-media-wrap">
        <!-- Processing overlay -->
        <div v-if="isProcessing" class="cn-ref-processing">
          <Spinner size="sm" />
          <span>{{ t('generate.controlnet.preprocessing') }}</span>
          <span v-if="cn.preprocessElapsed.value > 0" class="cn-pp-timer">{{ cn.preprocessElapsed.value }}s</span>
        </div>

        <!-- FileUploadZone: pick (top) + action "从新图片生成" (bottom) -->
        <FileUploadZone
          v-else
          mode="pick"
          accept="image/png,image/jpeg,image/webp,image/bmp"
          :preview="previewUrl"
          :file-name="displayName"
          :pick-label="pickLabel"
          pick-icon="image"
          :action-label="t('generate.image_source.generate_new')"
          action-icon="auto_fix_high"
          class="cn-ref-zone"
          @pick="emit('pick')"
          @action="emit('open-preprocess')"
          @clear="emit('clear')"
        />
      </div>
    </div>

    <!-- Right: parameters area -->
    <div class="cn-split__params">
      <!-- Model selector -->
      <div class="cn-field">
        <label class="field-lbl">{{ t('generate.controlnet.model') }}</label>
        <BaseSelect
          :model-value="config.model"
          :options="modelOptions"
          :placeholder="cn.hasModels.value ? t('generate.controlnet.model') : t('generate.controlnet.need_model')"
          :disabled="!cn.hasModels.value"
          teleport
          @update:model-value="config.model = String($event)"
        />
      </div>

      <!-- Strength slider -->
      <RangeField
        :model-value="config.strength"
        :min="0.1"
        :max="2"
        :step="0.05"
        :label="t('generate.controlnet.strength')"
        :marks="['0.1', '1.0', '2.0']"
        :value-format="(v: number) => v.toFixed(2)"
        editable
        @update:model-value="config.strength = $event"
      >
        <template #label-append>
          <HelpTip :text="t(cn.strengthHelpKey)" />
        </template>
      </RangeField>

      <!-- Start step slider -->
      <RangeField
        :model-value="config.start"
        :min="0"
        :max="1"
        :step="0.05"
        :label="t('generate.controlnet.start')"
        :marks="['0', '0.5', '1.0']"
        :value-format="(v: number) => v.toFixed(2)"
        editable
        @update:model-value="config.start = $event"
      >
        <template #label-append>
          <HelpTip :text="t('generate.controlnet.start_help')" />
        </template>
      </RangeField>

      <!-- End step slider -->
      <RangeField
        :model-value="config.end"
        :min="0"
        :max="1"
        :step="0.05"
        :label="t('generate.controlnet.end')"
        :marks="['0', '0.5', '1.0']"
        :value-format="(v: number) => v.toFixed(2)"
        editable
        @update:model-value="config.end = $event"
      >
        <template #label-append>
          <HelpTip :text="t('generate.controlnet.end_help')" />
        </template>
      </RangeField>
    </div>
  </div>
</template>

<style scoped>
/* Legacy gen-mod-split layout */
.cn-split {
  display: flex;
  gap: var(--sp-4);
  align-items: stretch;
}

.cn-split__params {
  flex: 1;
  min-width: 200px;
  max-width: 420px;
  order: 2;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--sp-3);
}

.cn-split__media {
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

.cn-media-wrap {
  position: relative;
}

.cn-ref-zone {
  height: 280px;
}

.cn-field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

/* ── Processing overlay ── */
.cn-ref-processing {
  height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--t3);
  font-size: .82rem;
  border: 2px dashed var(--bd);
  border-radius: var(--r-md);
}

.cn-pp-timer {
  font-size: .75rem;
  opacity: .7;
}

@media (max-width: 900px) {
  .cn-split { flex-direction: column; }
  .cn-split__media { max-width: 420px; width: 100%; }
  .cn-split__params,
  .cn-split__media { order: unset; }
}
</style>
