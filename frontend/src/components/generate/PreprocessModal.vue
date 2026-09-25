<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PP_PARAMS_DEF, type CnType } from '@/composables/generate/useControlNet'
import { IMAGE_ACCEPT, useRefImagePicker } from '@/composables/generate/useRefImagePicker'
import { useToast } from '@/composables/useToast'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import RangeField from '@/components/form/RangeField.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import RefImageModal from '@/components/generate/RefImageModal.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'PreprocessModal' })

const props = defineProps<{
  modelValue: boolean
  type: CnType
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: { file: File | string; params: Record<string, unknown> }]
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()

const def = computed(() => PP_PARAMS_DEF[props.type])
const title = computed(() =>
  t('generate.controlnet.generate_title', { title: t(def.value.titleKey) }),
)

const sourceFile = ref<File | null>(null)
const sourceInputName = ref('')
const sourcePreviewUrl = ref('')
const sourceName = computed(() => {
  if (sourceFile.value) return sourceFile.value.name
  if (sourceInputName.value) {
    const n = sourceInputName.value
    return n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
  }
  return ''
})
const hasSource = computed(() => !!sourceFile.value || !!sourceInputName.value)

const ppPicker = useRefImagePicker('__pp__', '')

function onPickInput() {
  ppPicker.open()
}

function onPickSelect(name: string) {
  sourceFile.value = null
  sourceInputName.value = name
  sourcePreviewUrl.value = `/api/generate/input_image_preview?name=${encodeURIComponent(name)}`
  ppPicker.close()
}

function onPickUpload(file: File) {
  setLocalFile(file)
  ppPicker.close()
}

function setLocalFile(file: File) {
  sourceFile.value = file
  sourceInputName.value = ''
  if (sourcePreviewUrl.value.startsWith('blob:')) URL.revokeObjectURL(sourcePreviewUrl.value)
  sourcePreviewUrl.value = URL.createObjectURL(file)
}

function onFileFromZone(file: File) {
  setLocalFile(file)
}

function clearSource() {
  if (sourcePreviewUrl.value.startsWith('blob:')) URL.revokeObjectURL(sourcePreviewUrl.value)
  sourceFile.value = null
  sourceInputName.value = ''
  sourcePreviewUrl.value = ''
}

const paramValues = ref<Record<string, unknown>>({})

watch(() => props.modelValue, (open) => {
  if (open) {
    clearSource()
    const defaults: Record<string, unknown> = {}
    for (const p of def.value.params) defaults[p.key] = p.default
    paramValues.value = defaults
  }
})

function onSubmit() {
  const file = sourceFile.value || sourceInputName.value
  if (!file) return
  emit('submit', { file, params: { ...paramValues.value } })
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="title"
    :icon="def.icon"
    icon-color="none"
    size="lg"
    width="720px"
    density="default"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="pp-wrap">
      <div class="pp-split">
        <div class="pp-split__media">
          <FileUploadZone
            mode="pick"
            :accept="IMAGE_ACCEPT"
            :preview="sourcePreviewUrl"
            :file-name="sourceName"
            :pick-label="t('generate.image_source.from_input')"
            :upload-label="t('generate.image_source.upload_local')"
            class="pp-source-zone"
            @pick="onPickInput"
            @file="onFileFromZone"
            @clear="clearSource"
            @error="toast($event, 'warning')"
          />
        </div>

        <div class="pp-split__params">
          <div v-if="def.params.length" class="pp-params">
            <div class="pp-params__title">{{ t('generate.controlnet.param_settings') }}</div>

            <div v-for="p in def.params" :key="p.key" :class="['pp-param-row', { 'pp-param-row--block': p.type === 'slider' }]">
              <template v-if="p.type === 'toggle'">
                <span class="pp-param-row__label">{{ t(p.labelKey) }}</span>
                <ToggleSwitch
                  :model-value="!!paramValues[p.key]"
                  :label="t(p.labelKey)"
                  size="sm"
                  @update:model-value="paramValues[p.key] = $event"
                />
              </template>

              <template v-else-if="p.type === 'slider'">
                <RangeField
                  :model-value="Number(paramValues[p.key])"
                  :min="p.min!"
                  :max="p.max!"
                  :step="p.step!"
                  :label="t(p.labelKey)"
                  editable
                  @update:model-value="paramValues[p.key] = $event"
                >
                  <template v-if="p.helpKey" #label-append>
                    <HelpTip :text="t(p.helpKey)" />
                  </template>
                </RangeField>
              </template>

              <template v-else-if="p.type === 'select'">
                <span class="pp-param-row__label">
                  {{ t(p.labelKey) }}
                  <HelpTip v-if="p.helpKey" :text="t(p.helpKey)" />
                </span>
                <BaseSelect
                  :model-value="paramValues[p.key] as number"
                  :options="p.options!.map(o => ({ value: o.value, label: o.label }))"
                  size="sm"
                  class="pp-param-row__select"
                  @update:model-value="paramValues[p.key] = Number($event)"
                />
              </template>
            </div>
          </div>

          <BaseButton
            size="sm"
            variant="primary"
            :disabled="!hasSource"
            class="pp-submit-btn"
            @click="onSubmit"
          >
            <MsIcon name="play_arrow" size="xs" color="none" />
            {{ t('generate.image_source.start_generate') }}
          </BaseButton>
        </div>
      </div>
    </div>
  </BaseModal>

  <RefImageModal
    v-model="ppPicker.visible.value"
    :title="t('generate.image_source.select_image')"
    :images="ppPicker.images.value"
    :loading="ppPicker.loading.value"
    :uploading="ppPicker.uploading.value"
    :preview-url-fn="ppPicker.previewUrl"
    @select="onPickSelect"
    @upload="onPickUpload"
  />
</template>

<style scoped>
/* ── Left-right split (mirrors gen-mod-split) ──
   容器查询按弹窗正文实际宽度判定 (窄屏 modal 铺满视口时同样命中) */
.pp-wrap {
  container: pp-wrap / inline-size;
}

.pp-split {
  display: flex;
  gap: var(--sp-4);
  align-items: stretch;
}

.pp-split__media {
  flex: 0 0 auto;
  width: 280px;
}

.pp-source-zone {
  height: 280px;
}

.pp-split__params {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.pp-params {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.pp-params__title {
  font-size: .82rem;
  font-weight: 500;
  color: var(--t2);
  margin-bottom: var(--sp-1);
}

.pp-param-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: 6px 10px;
  border-radius: var(--r);
  font-size: .82rem;
  color: var(--t1);
}

.pp-param-row--block {
  display: block;
}

.pp-param-row + .pp-param-row {
  border-top: 1px solid var(--bd);
}

.pp-param-row__label {
  font-size: .8rem;
  color: var(--t2);
  white-space: nowrap;
}

.pp-param-row__select {
  flex: 1;
  min-width: 0;
  max-width: 160px;
}

.pp-submit-btn {
  width: 100%;
  margin-top: auto;
}

@container pp-wrap (max-width: 600px) {
  .pp-split { flex-direction: column; }
  .pp-split__media { width: 100%; max-width: 320px; }
}
</style>
