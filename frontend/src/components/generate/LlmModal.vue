<script setup lang="ts">
/**
 * LlmModal — AI Prompt Generation modal.
 *
 * Layout: 900px BaseModal (configured) / 520px (not configured), left-right split.
 *   Left: mode tabs (text/image) + textarea or FileUploadZone + model label + submit button
 *   Right: result area (empty / running stream or spinner / result with positive+negative + action buttons)
 *
 * Legacy: gen-llm-modal in generate-llm.js
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { UseLlmAssistReturn } from '@/composables/generate/useLlmAssist'
import { useRefImagePicker } from '@/composables/generate/useRefImagePicker'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import RefImageModal from '@/components/generate/RefImageModal.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'LlmModal' })

const props = defineProps<{
  modelValue: boolean
  llm: UseLlmAssistReturn
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  apply: [result: { positive: string; negative?: string }]
}>()

const { t } = useI18n({ useScope: 'global' })
const router = useRouter()

// ── Text input ────────────────────────────────────────────────────────

const textInput = ref('')

// ── Image preview URL ─────────────────────────────────────────────────

const previewUrl = ref('')

function updatePreview() {
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)

  if (props.llm.imageFile.value) {
    previewUrl.value = URL.createObjectURL(props.llm.imageFile.value)
  } else if (props.llm.inputImageName.value) {
    previewUrl.value = `/api/generate/input_image_preview?name=${encodeURIComponent(props.llm.inputImageName.value)}`
  } else {
    previewUrl.value = ''
  }
}

watch([() => props.llm.imageFile.value, () => props.llm.inputImageName.value], updatePreview)

const imageName = computed(() => {
  if (props.llm.imageFile.value) return props.llm.imageFile.value.name
  if (props.llm.inputImageName.value) {
    const n = props.llm.inputImageName.value
    return n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
  }
  return ''
})

// ── Image picker from input ───────────────────────────────────────────

const imgPicker = useRefImagePicker('__llm__', '')

function onPickInput() {
  imgPicker.open()
}

function onPickSelect(name: string) {
  props.llm.setInputImage(name)
  imgPicker.close()
}

function onPickUpload(file: File) {
  props.llm.setLocalFile(file)
  imgPicker.close()
}

function onFileFromZone(file: File) {
  props.llm.setLocalFile(file)
}

function onClearImage() {
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  props.llm.clearImage()
}

// ── Submit ────────────────────────────────────────────────────────────

function onSubmit() {
  if (props.llm.running.value) return
  props.llm.submit(textInput.value)
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    onSubmit()
  }
}

// ── Result actions ────────────────────────────────────────────────────

function onUsePrompt() {
  const r = props.llm.applyResult('positive')
  if (r) emit('apply', r)
}

function onUseAll() {
  const r = props.llm.applyResult('all')
  if (r) emit('apply', r)
}

function onCopy() {
  props.llm.applyResult('copy')
}

// ── Go to settings ────────────────────────────────────────────────────

function goSettings() {
  emit('update:modelValue', false)
  router.push({ name: 'settings', query: { tab: 'llm' } })
}

// ── Submit button label ───────────────────────────────────────────────

const submitLabel = computed(() =>
  props.llm.mode.value === 'text'
    ? t('generate.llm_modal.generate')
    : t('generate.llm_modal.reverse'),
)

// ── Show negative block (hidden for flux targets) ─────────────────────

const showNegative = computed(() =>
  !!props.llm.result.value?.negative,
)
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('generate.llm_modal.title')"
    icon="auto_awesome"
    icon-color="none"
    :width="llm.configured.value ? '900px' : '520px'"
    density="default"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- Not configured state -->
    <div v-if="!llm.configured.value" class="llm-not-configured">
      <MsIcon name="settings" size="xl" color="var(--t3)" />
      <p class="llm-not-configured__text">{{ t('generate.llm_modal.not_configured') }}</p>
      <BaseButton size="sm" variant="primary" @click="goSettings">
        <MsIcon name="settings" size="xs" color="none" />
        {{ t('generate.llm_modal.go_settings') }}
      </BaseButton>
    </div>

    <!-- Main content: configured -->
    <div v-else class="llm-split">
      <!-- ── Left: mode tabs + input + submit ── -->
      <div class="llm-left">
        <!-- Mode tabs -->
        <div class="llm-mode-tabs">
          <button
            class="llm-mode-tab"
            :class="{ active: llm.mode.value === 'text' }"
            @click="llm.setMode('text')"
          >
            <MsIcon name="edit_note" size="xs" color="none" />
            {{ t('generate.llm_modal.text_mode') }}
          </button>
          <button
            class="llm-mode-tab"
            :class="{ active: llm.mode.value === 'image', disabled: !llm.visionSupported.value }"
            :disabled="!llm.visionSupported.value"
            :title="!llm.visionSupported.value ? t('generate.llm_modal.no_vision') : ''"
            @click="llm.setMode('image')"
          >
            <MsIcon name="image" size="xs" color="none" />
            {{ t('generate.llm_modal.image_mode') }}
          </button>
        </div>

        <!-- Text mode: textarea -->
        <div v-if="llm.mode.value === 'text'" class="llm-text-area">
          <textarea
            v-model="textInput"
            class="llm-textarea"
            :placeholder="t('generate.llm_modal.text_placeholder')"
            rows="8"
            @keydown="onKeydown"
          />
        </div>

        <!-- Image mode: file upload zone -->
        <div v-else class="llm-image-area">
          <FileUploadZone
            mode="pick"
            accept="image/png,image/jpeg,image/webp,image/bmp"
            :preview="previewUrl"
            :file-name="imageName"
            :pick-label="t('generate.image_source.from_input')"
            pick-icon="folder_open"
            :upload-label="t('generate.image_source.upload_local')"
            class="llm-image-zone"
            @pick="onPickInput"
            @file="onFileFromZone"
            @clear="onClearImage"
          />
        </div>

        <!-- Model label -->
        <div v-if="llm.modelName.value" class="llm-model-label">
          {{ t('generate.llm_modal.model_label', { model: llm.modelName.value }) }}
        </div>

        <!-- Submit button -->
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="llm.running.value"
          class="llm-submit-btn"
          @click="onSubmit"
        >
          <MsIcon name="play_arrow" size="xs" color="none" />
          {{ submitLabel }}
        </BaseButton>
      </div>

      <!-- ── Right: result area ── -->
      <div class="llm-result-area">
        <!-- Running: streaming -->
        <div v-if="llm.running.value && llm.streaming.value" class="llm-result-content">
          <div class="llm-stream-text">{{ llm.streamText.value }}</div>
        </div>

        <!-- Running: non-streaming spinner -->
        <div v-else-if="llm.running.value" class="llm-result-empty">
          <Spinner size="lg" />
          <p class="llm-result-hint">{{ t('generate.llm_modal.generating') }}</p>
        </div>

        <!-- Has result -->
        <div v-else-if="llm.result.value" class="llm-result-content">
          <div class="llm-result-blocks">
            <!-- Positive -->
            <div class="llm-result-block">
              <div class="llm-result-block__label">
                <MsIcon name="add_circle" size="xs" color="none" />
                Positive
              </div>
              <div class="llm-result-block__text llm-result-block__text--pos">{{ llm.result.value.positive }}</div>
            </div>
            <!-- Negative (hidden for flux or when empty) -->
            <div v-if="showNegative" class="llm-result-block">
              <div class="llm-result-block__label">
                <MsIcon name="remove_circle" size="xs" color="none" />
                Negative
              </div>
              <div class="llm-result-block__text llm-result-block__text--neg">{{ llm.result.value.negative }}</div>
            </div>
          </div>
          <div class="llm-result-actions">
            <BaseButton size="sm" variant="primary" @click="onUsePrompt">
              <MsIcon name="input" size="xs" color="none" />
              {{ t('generate.llm_modal.use_prompt') }}
            </BaseButton>
            <BaseButton size="sm" @click="onUseAll">
              <MsIcon name="done_all" size="xs" color="none" />
              {{ t('generate.llm_modal.use_all_prompts') }}
            </BaseButton>
            <BaseButton size="sm" @click="onCopy">
              <MsIcon name="content_copy" size="xs" color="none" />
              {{ t('generate.llm_modal.copy') }}
            </BaseButton>
          </div>
        </div>

        <!-- Empty / idle -->
        <div v-else class="llm-result-empty">
          <MsIcon name="auto_awesome" size="xl" color="var(--t3)" />
          <p class="llm-result-hint">{{ t('generate.llm_modal.result_hint') }}</p>
        </div>
      </div>
    </div>
  </BaseModal>

  <!-- Nested RefImageModal for "from input" picker (image mode) -->
  <RefImageModal
    v-model="imgPicker.visible.value"
    :title="t('generate.image_source.select_image')"
    icon="folder_open"
    :images="imgPicker.images.value"
    :loading="imgPicker.loading.value"
    :uploading="imgPicker.uploading.value"
    :preview-url-fn="imgPicker.previewUrl"
    @select="onPickSelect"
    @upload="onPickUpload"
  />
</template>

<style scoped>
/* ── Not configured state ── */
.llm-not-configured {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
}

.llm-not-configured__text {
  color: var(--t2);
  margin: 0;
  font-size: 0.85rem;
}

/* ── Left-right split ── */
.llm-split {
  display: flex;
  gap: var(--sp-4);
}

.llm-left {
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* ── Mode tabs ── */
.llm-mode-tabs {
  display: flex;
  gap: var(--sp-1);
  background: var(--bg3);
  border-radius: var(--r-md);
  padding: 3px;
}

.llm-mode-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--t2);
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.llm-mode-tab.active {
  background: var(--bg);
  color: var(--t1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.llm-mode-tab.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Text area ── */
.llm-text-area {
  flex: 1;
  display: flex;
  min-height: 0;
}

.llm-textarea {
  width: 100%;
  flex: 1;
  padding: 10px 12px;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--t1);
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  outline: none;
  resize: none;
  transition: border-color 0.15s;
  font-family: inherit;
}

.llm-textarea:focus {
  border-color: var(--ac);
}

.llm-textarea::placeholder {
  color: var(--t3);
  font-size: var(--text-xs);
}

/* ── Image area ── */
.llm-image-area {
  flex: 1;
  min-height: 0;
}

.llm-image-zone {
  height: 260px;
}

/* ── Model label ── */
.llm-model-label {
  font-size: var(--text-xs);
  color: var(--t3);
  padding: 0 2px;
}

/* ── Submit button ── */
.llm-submit-btn {
  width: 100%;
  margin-top: auto;
}

/* ── Result area ── */
.llm-result-area {
  flex: 1 1 0;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: var(--sp-3);
  overflow-y: auto;
}

.llm-result-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.llm-result-hint {
  color: var(--t3);
  margin: 0;
  font-size: var(--text-sm);
}

.llm-result-content {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  flex: 1;
}

/* ── Stream text ── */
.llm-stream-text {
  flex: 1;
  overflow-y: auto;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--t2);
  white-space: pre-wrap;
}

/* ── Result blocks ── */
.llm-result-blocks {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.llm-result-block__label {
  font-size: 0.72rem;
  color: var(--t3);
  text-transform: uppercase;
  margin-bottom: 4px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.llm-result-block__text {
  font-size: 0.85rem;
  line-height: 1.6;
  background: var(--bg3);
  padding: 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--bd);
  white-space: pre-wrap;
  overflow-y: auto;
  user-select: text;
}

.llm-result-block__text--pos {
  color: var(--t1);
  max-height: 200px;
}

.llm-result-block__text--neg {
  color: var(--t2);
  max-height: 120px;
}

/* ── Result actions ── */
.llm-result-actions {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
  padding-top: var(--sp-2);
  border-top: 1px solid var(--bd);
}
</style>
