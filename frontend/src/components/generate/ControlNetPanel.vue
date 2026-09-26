<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UseControlNetReturn } from '@/composables/generate/useControlNet'
import { CN_LABEL_KEYS } from '@/composables/generate/useControlNet'
import { IMAGE_ACCEPT } from '@/composables/generate/useRefImagePicker'
import { useToast } from '@/composables/useToast'
import RangeField from '@/components/form/RangeField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'

defineOptions({ name: 'ControlNetPanel' })

const props = defineProps<{
  cn: UseControlNetReturn
}>()

const emit = defineEmits<{
  pick: []
  file: [file: File]
  clear: []
  'open-preprocess': []
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()

const config = computed(() => props.cn.config.value)

const previewUrl = computed(() => {
  const img = config.value.image
  if (!img) return undefined
  return `/api/generate/input_image_preview?name=${encodeURIComponent(img)}`
})

const displayName = computed(() => {
  const img = config.value.image
  if (!img) return undefined
  return img.includes('/') ? img.slice(img.lastIndexOf('/') + 1) : img
})

const modelOptions = computed(() => props.cn.models.value)

/**
 * 缺失的选中项要保留在下拉里 (带提示), 否则 BaseSelect 找不到值会显示空占位 ——
 * 看上去像"没选", 而实际选的是一个本机不存在的模型。
 */
const modelSelectOptions = computed(() => {
  const list = modelOptions.value.map(value => ({ value, label: value }))
  const cur = config.value.model
  if (cur && !modelOptions.value.includes(cur)) {
    return [{ value: cur, label: cur, hint: t('generate.missing.tag') }, ...list]
  }
  return list
})

const pickLabel = computed(() => {
  const labelKey = CN_LABEL_KEYS[props.cn.type] || 'generate.controlnet.ref_image'
  return t('generate.controlnet.pick_ref', { label: t(labelKey) })
})

const isProcessing = computed(() => props.cn.preprocessStatus.value === 'running')
</script>

<template>
  <div class="cn-split-container">
    <div class="cn-split">
      <div class="cn-split__media">
        <label class="field-lbl">{{ t(cn.refLabelKey) }}</label>

        <div class="cn-media-wrap">
          <div v-if="isProcessing" class="cn-ref-processing">
            <Spinner size="sm" />
            <span>{{ t('generate.controlnet.preprocessing') }}</span>
            <span v-if="cn.preprocessElapsed.value > 0" class="cn-pp-timer">{{ cn.preprocessElapsed.value }}s</span>
          </div>

          <FileUploadZone
            v-else
            mode="pick"
            :accept="IMAGE_ACCEPT"
            :preview="previewUrl"
            :file-name="displayName"
            :pick-label="pickLabel"
            :action-label="t('generate.image_source.generate_new')"
            action-icon="auto_fix_high"
            class="cn-ref-zone"
            @pick="emit('pick')"
            @file="emit('file', $event)"
            @action="emit('open-preprocess')"
            @clear="emit('clear')"
            @error="toast($event, 'warning')"
          />
        </div>
      </div>

      <div class="cn-split__params">
        <div class="cn-field">
          <label class="field-lbl">{{ t('generate.controlnet.model') }}</label>
          <BaseSelect
            :model-value="config.model"
            :options="modelSelectOptions"
            :placeholder="cn.hasModels.value ? t('generate.controlnet.model') : t('generate.controlnet.need_model')"
            :disabled="!cn.hasModels.value"
            @update:model-value="config.model = String($event)"
          />
          <div v-if="cn.modelMissing.value" class="cn-missing">
            <MsIcon name="error_outline" size="xs" />
            {{ t('generate.missing.tag_hint') }}
          </div>
        </div>

        <RangeField
          :model-value="config.strength"
          :min="0.1"
          :max="2"
          :step="0.05"
          :label="t('generate.controlnet.strength')"
          :marks="2"
          :value-format="(v: number) => v.toFixed(2)"
          editable
          @update:model-value="config.strength = $event"
        >
          <template #label-append>
            <HelpTip :text="t(cn.strengthHelpKey)" />
          </template>
        </RangeField>

        <RangeField
          :model-value="config.start"
          :min="0"
          :max="1"
          :step="0.05"
          :label="t('generate.controlnet.start')"
          :marks="2"
          :value-format="(v: number) => v.toFixed(2)"
          editable
          @update:model-value="config.start = $event"
        >
          <template #label-append>
            <HelpTip :text="t('generate.controlnet.start_help')" />
          </template>
        </RangeField>

        <RangeField
          :model-value="config.end"
          :min="0"
          :max="1"
          :step="0.05"
          :label="t('generate.controlnet.end')"
          :marks="2"
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
  </div>
</template>

<style scoped>
.cn-split-container {
  min-width: 0;
  container: gen-controlnet / inline-size;
}

/* Legacy gen-mod-split layout */
.cn-split {
  display: flex;
  gap: var(--sp-4);
  align-items: stretch;
  max-width: var(--gen-module-w);
  margin: 0 auto;
}

.cn-split__params {
  flex: 1;
  min-width: 200px;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--sp-3);
}

.cn-split__media {
  flex: 0 0 auto;
  width: 280px;
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

@container gen-controlnet (max-width: 520px) {
  .cn-split { flex-direction: column; }
  .cn-split__media { max-width: 420px; width: 100%; }
}

.cn-missing {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: var(--sp-1);
  font-size: var(--text-xs);
  color: var(--c-caution);
}
</style>
