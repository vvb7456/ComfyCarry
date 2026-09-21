<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UseLlmAssistReturn } from '@/composables/generate/useLlmAssist'
import { IMAGE_ACCEPT, useRefImagePicker } from '@/composables/generate/useRefImagePicker'
import { useToast } from '@/composables/useToast'
import { useGenerateStore } from '@/stores/generate'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FileUploadZone from '@/components/ui/FileUploadZone.vue'
import RefImageModal from '@/components/generate/RefImageModal.vue'
import LlmSettingsModal from '@/components/generate/LlmSettingsModal.vue'
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
const { toast } = useToast()
const store = useGenerateStore()

const settingsOpen = ref(false)

async function onSettingsSaved() {
  await props.llm.open()
  toast(t('generate.llm_modal.config_refreshed'), 'success')
}

const textInput = ref('')

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

/** 静态模型与 LLM prompt 预设一一对应；视频双模式条目在下方动态分流。 */
const STATIC_LLM_TARGETS: Record<string, string> = {
  sdxl: 'sdxl',
  sd15: 'sd15',
  anima: 'anima',
  krea2: 'krea2',
  zimage: 'zimage',
  flux1: 'flux',
  chroma: 'chroma',
  flux2klein4b: 'flux2klein4b',
  flux2klein9b: 'flux2klein9b',
  flux2dev: 'flux2dev',
  pony: 'pony',
  illustrious: 'illustrious',
  noobai: 'noobai',
  wan22_i2v: 'wan22_i2v',
  wan22_t2v: 'wan22_t2v',
  minimax_h3_ref: 'minimax_h3_ref',
}

const llmTarget = computed(() => {
  const modelType = store.activeModelType
  const video = store.currentState.video

  if (modelType === 'wan22_5b') {
    return video?.mode === 't2v' ? 'wan22_5b_t2v' : 'wan22_5b_i2v'
  }

  if (modelType === 'minimax_h3') {
    if (video?.mode === 't2v') return 'minimax_h3_t2v'
    return video?.lastImage ? 'minimax_h3_fl2v' : 'minimax_h3_i2v'
  }

  // 未知的未来条目安全回退 SDXL，避免向严格校验的 API 发送无效 target。
  return STATIC_LLM_TARGETS[modelType] ?? 'sdxl'
})

function onSubmit() {
  if (props.llm.running.value) return
  // 图片反推不携带用户之前在文字 tab 的草稿；视频的时长是系统上下文，两种模式都要发送。
  let input = props.llm.mode.value === 'image' ? '' : textInput.value
  if (llmTarget.value.startsWith('wan22_') || llmTarget.value.startsWith('minimax_h3_')) {
    const duration = store.currentState.video?.durationS
    if (duration) {
      input += `\n\n系统补充的生成参数（不是画面内容）：目标视频时长为 ${duration.toFixed(2)} 秒。`
    }
  }
  props.llm.submit(input, llmTarget.value)
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    onSubmit()
  }
}

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

const submitLabel = computed(() =>
  props.llm.mode.value === 'text'
    ? t('generate.llm_modal.generate')
    : t('generate.llm_modal.reverse'),
)

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
    :size="llm.configured.value ? 'xl' : 'md'"
    :width="llm.configured.value ? '900px' : '520px'"
    density="default"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-if="!llm.configured.value" class="llm-not-configured">
      <MsIcon name="settings" size="xl" color="var(--t3)" />
      <p class="llm-not-configured__text">{{ t('generate.llm_modal.not_configured') }}</p>
      <BaseButton size="sm" variant="primary" @click="settingsOpen = true">
        <MsIcon name="settings" size="xs" color="none" />
        {{ t('generate.llm_modal.go_settings') }}
      </BaseButton>
    </div>

    <div v-else class="llm-split">
      <div class="llm-left">
        <div class="llm-mode-tabs">
          <button
            type="button"
            class="llm-mode-tab"
            :class="{ active: llm.mode.value === 'text' }"
            @click="llm.setMode('text')"
          >
            <MsIcon name="edit_note" size="xs" color="none" />
            {{ t('generate.llm_modal.text_mode') }}
          </button>
          <button
            type="button"
            class="llm-mode-tab"
            :class="{ active: llm.mode.value === 'image', disabled: !llm.visionSupported.value }"
            :disabled="!llm.visionSupported.value"
            :title="!llm.visionSupported.value ? t('generate.llm_modal.no_vision') : ''"
            :aria-label="!llm.visionSupported.value ? t('generate.llm_modal.no_vision') : ''"
            @click="llm.setMode('image')"
          >
            <MsIcon name="image" size="xs" color="none" />
            {{ t('generate.llm_modal.image_mode') }}
          </button>
        </div>

        <div v-if="llm.mode.value === 'text'" class="llm-text-area">
          <textarea
            v-model="textInput"
            class="llm-textarea"
            :placeholder="t('generate.llm_modal.text_placeholder')"
            rows="8"
            @keydown="onKeydown"
          />
        </div>

        <div v-else class="llm-image-area">
          <FileUploadZone
            mode="pick"
            :accept="IMAGE_ACCEPT"
            :preview="previewUrl"
            :file-name="imageName"
            :pick-label="t('generate.image_source.from_input')"
            :upload-label="t('generate.image_source.upload_local')"
            class="llm-image-zone"
            @pick="onPickInput"
            @file="onFileFromZone"
            @clear="onClearImage"
            @error="toast($event, 'warning')"
          />
        </div>

        <div v-if="llm.modelName.value" class="llm-model-label">
          <span class="llm-model-label__text">{{ t('generate.llm_modal.model_label', { model: llm.modelName.value }) }}</span>
          <button
            type="button"
            class="llm-model-label__settings"
            :aria-label="t('llm.settings.title')"
            :title="t('llm.settings.title')"
            @click="settingsOpen = true"
          >
            <MsIcon name="settings" size="xs" color="none" />
          </button>
        </div>

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

      <div class="llm-result-area">
        <div v-if="llm.running.value && llm.streaming.value" class="llm-result-content">
          <div class="llm-stream-text">{{ llm.streamText.value }}</div>
        </div>

        <div v-else-if="llm.running.value" class="llm-result-empty">
          <Spinner size="lg" />
          <p class="llm-result-hint">{{ t('generate.llm_modal.generating') }}</p>
        </div>

        <div v-else-if="llm.result.value" class="llm-result-content">
          <div class="llm-result-blocks">
            <div class="llm-result-block">
              <div class="llm-result-block__label">
                <MsIcon name="add_circle" size="xs" color="none" />
                {{ t('generate.prompt.positive_label') }}
              </div>
              <div class="llm-result-block__text llm-result-block__text--pos">{{ llm.result.value.positive }}</div>
            </div>
            <div v-if="showNegative" class="llm-result-block">
              <div class="llm-result-block__label">
                <MsIcon name="remove_circle" size="xs" color="none" />
                {{ t('generate.prompt.negative_label') }}
              </div>
              <div class="llm-result-block__text llm-result-block__text--neg">{{ llm.result.value.negative }}</div>
            </div>
          </div>
          <div class="llm-result-actions">
            <BaseButton size="sm" variant="primary" @click="onUsePrompt">
              <MsIcon name="content_paste_go" size="xs" color="none" />
              {{ t('generate.llm_modal.use_prompt') }}
            </BaseButton>
            <BaseButton size="sm" @click="onUseAll">
              <MsIcon name="content_paste_go" size="xs" color="none" />
              {{ t('generate.llm_modal.use_all_prompts') }}
            </BaseButton>
            <BaseButton size="sm" @click="onCopy">
              <MsIcon name="content_copy" size="xs" color="none" />
              {{ t('common.btn.copy') }}
            </BaseButton>
          </div>
        </div>

        <div v-else class="llm-result-empty">
          <MsIcon name="auto_awesome" size="xl" color="var(--t3)" />
          <p class="llm-result-hint">{{ t('generate.llm_modal.result_hint') }}</p>
        </div>
      </div>
    </div>
  </BaseModal>

  <RefImageModal
    v-model="imgPicker.visible.value"
    :title="t('generate.image_source.select_image')"
    :images="imgPicker.images.value"
    :loading="imgPicker.loading.value"
    :uploading="imgPicker.uploading.value"
    :preview-url-fn="imgPicker.previewUrl"
    @select="onPickSelect"
    @upload="onPickUpload"
  />

  <!-- LLM 服务配置 -->
  <LlmSettingsModal v-model="settingsOpen" @saved="onSettingsSaved" />
</template>

<style scoped>
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

.llm-image-area {
  flex: 1;
  min-height: 0;
}

.llm-image-zone {
  height: 260px;
}

.llm-model-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--t3);
  padding: 0 2px;
}

/* 设置入口: 裸 icon 小按钮 */
.llm-model-label__settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
}
.llm-model-label__settings:hover {
  color: var(--ac);
  background: var(--bg3);
}

.llm-submit-btn {
  width: 100%;
  margin-top: auto;
}

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

.llm-stream-text {
  flex: 1;
  overflow-y: auto;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--t2);
  white-space: pre-wrap;
}

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

.llm-result-actions {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
  padding-top: var(--sp-2);
  border-top: 1px solid var(--bd);
}
</style>
