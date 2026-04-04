<script setup lang="ts">
/**
 * PreprocessModal — Modal for generating ControlNet reference images from source images.
 *
 * Legacy: _openPPModal(type) — left-right split (gen-mod-split) inside a 720px modal.
 * Left: FileUploadZone (pick from input / upload local)
 * Right: per-type parameters + submit button
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PP_PARAMS_DEF, type CnType } from '@/composables/generate/useControlNet'
import { useRefImagePicker } from '@/composables/generate/useRefImagePicker'
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

const def = computed(() => PP_PARAMS_DEF[props.type])
const title = computed(() =>
  t('generate.controlnet.generate_title', { title: t(def.value.titleKey) }),
)

// ── Image source ──────────────────────────────────────────────────────────

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

// Ref image picker for "from input" (no subfolder — show all images)
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

// ── Parameters ────────────────────────────────────────────────────────────

const paramValues = ref<Record<string, unknown>>({})

// ── Reset on open ─────────────────────────────────────────────────────────

watch(() => props.modelValue, (open) => {
  if (open) {
    clearSource()
    const defaults: Record<string, unknown> = {}
    for (const p of def.value.params) defaults[p.key] = p.default
    paramValues.value = defaults
  }
})

// ── Submit ────────────────────────────────────────────────────────────────

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
    width="720px"
    density="default"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- gen-mod-split: left image + right params -->
    <div class="pp-split">
      <!-- Left: image source (FileUploadZone) -->
      <div class="pp-split__media">
        <FileUploadZone
          mode="pick"
          accept="image/png,image/jpeg,image/webp,image/bmp"
          :preview="sourcePreviewUrl"
          :file-name="sourceName"
          :pick-label="t('generate.image_source.from_input')"
          pick-icon="folder_open"
          :upload-label="t('generate.image_source.upload_local')"
          class="pp-source-zone"
          @pick="onPickInput"
          @file="onFileFromZone"
          @clear="clearSource"
        />
      </div>

      <!-- Right: parameters + submit -->
      <div class="pp-split__params">
        <div v-if="def.params.length" class="pp-params">
          <div class="pp-params__title">{{ t('generate.controlnet.param_settings') }}</div>

          <div v-for="p in def.params" :key="p.key" :class="['pp-param-row', { 'pp-param-row--block': p.type === 'slider' }]">
            <!-- Toggle -->
            <template v-if="p.type === 'toggle'">
              <span class="pp-param-row__label">{{ t(p.labelKey) }}</span>
              <ToggleSwitch
                :model-value="!!paramValues[p.key]"
                size="sm"
                @update:model-value="paramValues[p.key] = $event"
              />
            </template>

            <!-- Slider (full-width with optional HelpTip) -->
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

            <!-- Select -->
            <template v-else-if="p.type === 'select'">
              <span class="pp-param-row__label">
                {{ t(p.labelKey) }}
                <HelpTip v-if="p.helpKey" :text="t(p.helpKey)" />
              </span>
              <BaseSelect
                :model-value="paramValues[p.key] as number"
                :options="p.options!.map(o => ({ value: o.value, label: o.label }))"
                size="sm"
                teleport
                class="pp-param-row__select"
                @update:model-value="paramValues[p.key] = Number($event)"
              />
            </template>
          </div>
        </div>

        <!-- Submit button at bottom -->
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
  </BaseModal>

  <!-- Nested RefImageModal for "from input" picker -->
  <RefImageModal
    v-model="ppPicker.visible.value"
    :title="t('generate.image_source.select_image')"
    icon="folder_open"
    :images="ppPicker.images.value"
    :loading="ppPicker.loading.value"
    :uploading="ppPicker.uploading.value"
    :preview-url-fn="ppPicker.previewUrl"
    @select="onPickSelect"
    @upload="onPickUpload"
  />
</template>

<style scoped>
/* ── Left-right split (mirrors gen-mod-split) ── */
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

/* ── Parameters ── */
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

/* Submit button at bottom of right column */
.pp-submit-btn {
  width: 100%;
  margin-top: auto;
}

@media (max-width: 600px) {
  .pp-split { flex-direction: column; }
  .pp-split__media { width: 100%; max-width: 320px; }
}
</style>
