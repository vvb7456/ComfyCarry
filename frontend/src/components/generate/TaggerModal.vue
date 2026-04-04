<script setup lang="ts">
/**
 * TaggerModal — WD14 Tag Interrogation modal.
 *
 * Layout: 900px BaseModal, left-right split (320px left + flexible right).
 *   Left: FileUploadZone (pick from input / upload / drag) + parameter panel + submit button
 *   Right: Result area (empty / running spinner / tags + action buttons)
 *
 * Legacy: gen-tag-modal → gen-tag-split (flex left-right)
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TAG_PARAMS_DEF, type useTagInterrogation } from '@/composables/generate/useTagInterrogation'
import { useRefImagePicker } from '@/composables/generate/useRefImagePicker'
import type { UseModelDependencyReturn } from '@/composables/generate/useModelDependency'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import RangeField from '@/components/form/RangeField.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import RefImageModal from '@/components/generate/RefImageModal.vue'
import ModelDependencyGate from '@/components/generate/ModelDependencyGate.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'TaggerModal' })

const props = defineProps<{
  modelValue: boolean
  tagger: ReturnType<typeof useTagInterrogation>
  ready: boolean
  dep?: UseModelDependencyReturn
  depTitle?: string
  depMinOptional?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  apply: [tags: string]
  'dep-enter': []
  'dep-download': []
}>()

const { t } = useI18n({ useScope: 'global' })

// ── Image preview URL ─────────────────────────────────────────────────────

const previewUrl = ref('')

function updatePreview() {
  // Revoke old blob URL
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)

  if (props.tagger.sourceFile.value) {
    previewUrl.value = URL.createObjectURL(props.tagger.sourceFile.value)
  } else if (props.tagger.sourceInputName.value) {
    previewUrl.value = `/api/generate/input_image_preview?name=${encodeURIComponent(props.tagger.sourceInputName.value)}`
  } else {
    previewUrl.value = ''
  }
}

// Watch source changes
watch([() => props.tagger.sourceFile.value, () => props.tagger.sourceInputName.value], updatePreview)

// ── Image source display name ─────────────────────────────────────────────

const sourceName = computed(() => {
  if (props.tagger.sourceFile.value) return props.tagger.sourceFile.value.name
  if (props.tagger.sourceInputName.value) {
    const n = props.tagger.sourceInputName.value
    return n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
  }
  return ''
})

// ── Ref image picker (for "from input" button) ───────────────────────────

const tagPicker = useRefImagePicker('tagger', '')

function onPickInput() {
  tagPicker.open()
}

function onPickSelect(name: string) {
  props.tagger.setInputImage(name)
  tagPicker.close()
}

async function onPickUpload(file: File) {
  const result = await tagPicker.uploadFile(file)
  if (result) {
    props.tagger.setInputImage(result.filename)
  }
  tagPicker.close()
}

async function onFileFromZone(file: File) {
  const result = await tagPicker.uploadFile(file)
  if (result) {
    props.tagger.setInputImage(result.filename)
  }
}

function onClearSource() {
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  props.tagger.clearSource()
}

// ── Model select options ──────────────────────────────────────────────────

const modelOptions = computed(() =>
  props.tagger.models.value.map(m => ({ value: m, label: m }))
)

// ── Submit ────────────────────────────────────────────────────────────────

function onSubmit() {
  if (!props.tagger.hasSource.value || props.tagger.running.value) return
  props.tagger.interrogate()
}

// ── Apply result ──────────────────────────────────────────────────────────

function onApply() {
  const text = props.tagger.applyToPrompt()
  if (text) emit('apply', text)
}

function onCopy() {
  navigator.clipboard.writeText(props.tagger.resultText.value).then(
    () => { /* toast already in clipboard API */ },
    () => { /* fallback */ },
  )
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('generate.interrogate.modal_title')"
    icon="image_search"
    icon-color="none"
    :width="ready ? '900px' : '520px'"
    density="default"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- Gate: model not ready -->
    <ModelDependencyGate
      v-if="!ready && dep"
      :dep="dep"
      :title="depTitle || ''"
      :min-optional="depMinOptional"
      @enter="$emit('dep-enter')"
      @download="$emit('dep-download')"
    />

    <!-- Main content: ready -->
    <div v-else class="tag-split">
      <!-- ── Left: image + params + submit ── -->
      <div class="tag-left">
        <FileUploadZone
          mode="pick"
          accept="image/png,image/jpeg,image/webp,image/bmp"
          :preview="previewUrl"
          :file-name="sourceName"
          :pick-label="t('generate.image_source.from_input')"
          pick-icon="folder_open"
          :upload-label="t('generate.image_source.upload_local')"
          class="tag-source-zone"
          @pick="onPickInput"
          @file="onFileFromZone"
          @clear="onClearSource"
        />

        <!-- Parameters -->
        <div class="tag-params">
          <div class="tag-params__title">{{ t('generate.interrogate.title') }}</div>

          <div v-for="p in TAG_PARAMS_DEF" :key="p.key" class="tag-param-row" :class="{ 'tag-param-row--block': p.type === 'slider' || p.type === 'text' }">
            <!-- Select (model) -->
            <template v-if="p.type === 'select'">
              <span class="tag-param-row__label">
                {{ t(p.labelKey) }}
              </span>
              <BaseSelect
                :model-value="tagger.paramValues.value[p.key] as string"
                :options="p.key === 'model' ? modelOptions : (p.options || [])"
                :disabled="p.key === 'model' && modelOptions.length === 0"
                size="sm"
                teleport
                class="tag-param-row__select"
                @update:model-value="tagger.paramValues.value[p.key] = String($event)"
              />
            </template>

            <!-- Slider -->
            <template v-else-if="p.type === 'slider'">
              <RangeField
                :model-value="Number(tagger.paramValues.value[p.key])"
                :min="p.min!"
                :max="p.max!"
                :step="p.step!"
                :label="t(p.labelKey)"
                :value-format="(v: number) => v.toFixed(2)"
                editable
                @update:model-value="tagger.paramValues.value[p.key] = $event"
              >
                <template v-if="p.helpKey" #label-append>
                  <HelpTip :text="t(p.helpKey)" />
                </template>
              </RangeField>
            </template>

            <!-- Toggle -->
            <template v-else-if="p.type === 'toggle'">
              <span class="tag-param-row__label">
                {{ t(p.labelKey) }}
                <HelpTip v-if="p.helpKey" :text="t(p.helpKey)" />
              </span>
              <ToggleSwitch
                :model-value="!!tagger.paramValues.value[p.key]"
                size="sm"
                @update:model-value="tagger.paramValues.value[p.key] = $event"
              />
            </template>

            <!-- Text input -->
            <template v-else-if="p.type === 'text'">
              <label class="tag-param-row__label">
                {{ t(p.labelKey) }}
                <HelpTip v-if="p.helpKey" :text="t(p.helpKey)" />
              </label>
              <input
                type="text"
                class="tag-text-input"
                :value="tagger.paramValues.value[p.key] as string"
                :placeholder="p.placeholder ? t(p.placeholder) : ''"
                @input="tagger.paramValues.value[p.key] = ($event.target as HTMLInputElement).value"
              >
            </template>
          </div>
        </div>

        <!-- Submit button -->
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="!tagger.hasSource.value || tagger.running.value"
          class="tag-submit-btn"
          @click="onSubmit"
        >
          <MsIcon name="play_arrow" size="xs" color="none" />
          {{ t('generate.interrogate.start_btn') }}
        </BaseButton>
      </div>

      <!-- ── Right: result area ── -->
      <div class="tag-result-area">
        <!-- Running -->
        <div v-if="tagger.running.value" class="tag-result-empty">
          <Spinner size="lg" />
          <p class="tag-result-hint">{{ t('generate.interrogate.running') }}</p>
        </div>

        <!-- Has result -->
        <div v-else-if="tagger.resultText.value" class="tag-result-content">
          <div class="tag-result-tags">{{ tagger.resultText.value }}</div>
          <div class="tag-result-actions">
            <BaseButton size="sm" variant="primary" @click="onApply">
              <MsIcon name="input" size="xs" color="none" />
              {{ t('generate.interrogate.use_prompt') }}
            </BaseButton>
            <BaseButton size="sm" @click="onCopy">
              <MsIcon name="content_copy" size="xs" color="none" />
              {{ t('generate.interrogate.copy') }}
            </BaseButton>
          </div>
        </div>

        <!-- Empty / idle -->
        <div v-else class="tag-result-empty">
          <MsIcon name="sell" size="xl" color="var(--t3)" />
          <p class="tag-result-hint">{{ t('generate.interrogate.result_hint') }}</p>
        </div>
      </div>
    </div>
  </BaseModal>

  <!-- Nested RefImageModal for "from input" picker -->
  <RefImageModal
    v-model="tagPicker.visible.value"
    :title="t('generate.image_source.select_image')"
    icon="folder_open"
    :images="tagPicker.images.value"
    :loading="tagPicker.loading.value"
    :uploading="tagPicker.uploading.value"
    :preview-url-fn="tagPicker.previewUrl"
    @select="onPickSelect"
    @upload="onPickUpload"
  />
</template>

<style scoped>
/* ── Left-right split (legacy: gen-tag-split) ── */
.tag-split {
  display: flex;
  gap: var(--sp-4);
}

.tag-left {
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.tag-source-zone {
  height: 260px;
}

/* ── Parameters ── */
.tag-params {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.tag-params__title {
  font-size: var(--text-xs);
  color: var(--t2);
  font-weight: 600;
}

.tag-param-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}

.tag-param-row--block {
  flex-direction: column;
  align-items: stretch;
}

.tag-param-row__label {
  font-size: var(--text-xs);
  color: var(--t2);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.tag-param-row__select {
  min-width: 160px;
}

.tag-text-input {
  width: 100%;
  padding: 6px 10px;
  font-size: var(--text-sm);
  color: var(--t1);
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  outline: none;
  transition: border-color 0.15s;
}
.tag-text-input:focus {
  border-color: var(--ac);
}
.tag-text-input::placeholder {
  color: var(--t3);
}

.tag-submit-btn {
  width: 100%;
  margin-top: auto;
}

/* ── Result area ── */
.tag-result-area {
  flex: 1 1 0;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: var(--sp-3);
  overflow-y: auto;
}

.tag-result-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.tag-result-hint {
  color: var(--t3);
  margin: 0;
  font-size: var(--text-sm);
}

.tag-result-content {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  flex: 1;
}

.tag-result-tags {
  flex: 1;
  overflow-y: auto;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--t1);
  word-break: break-word;
  white-space: pre-wrap;
}

.tag-result-actions {
  display: flex;
  gap: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--bd);
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .tag-split {
    flex-direction: column;
  }
  .tag-left {
    flex: none;
    width: 100%;
  }
}
</style>
