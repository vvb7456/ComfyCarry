import { computed, onUnmounted, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { useLlmAssist } from '@/composables/generate/useLlmAssist'
import { useEmbeddingPicker } from '@/composables/generate/useEmbeddingPicker'
import { useWildcardManager } from '@/composables/generate/useWildcardManager'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import type { GenerateOptionsReturn } from '@/composables/generate/useGenerateOptions'
import { useToast } from '@/composables/useToast'

interface PromptEditorHandle {
  insertAtCursor: (target: 'positive' | 'negative', text: string) => void
}

interface UseModelModalManagerOptions {
  options: GenerateOptionsReturn
  previewImages: Ref<PreviewImage[]>
  prepareTagger: () => void
  modelField: 'checkpoint' | 'unet'
}

function basename(name: string) {
  return name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
}

export function useModelModalManager({
  options,
  previewImages,
  prepareTagger,
  modelField,
}: UseModelModalManagerOptions) {
  const { t } = useI18n({ useScope: 'global' })
  const { toast } = useToast()
  const store = useGenerateStore()
  const state = computed(() => store.currentState)

  const llm = useLlmAssist()
  const embPicker = useEmbeddingPicker()
  const wcManager = useWildcardManager()

  const promptEditorRef = ref<PromptEditorHandle | null>(null)

  const showTaggerModal = ref(false)
  const showLlmModal = ref(false)

  const previewOpen = ref(false)
  const previewIndex = ref(0)
  const previewUrls = computed(() => previewImages.value.map((image) => image.url))

  function onPreviewClick(url: string) {
    const idx = previewUrls.value.indexOf(url)
    previewIndex.value = idx >= 0 ? idx : 0
    previewOpen.value = true
  }

  // promptStyle==='natural' 时隐藏 tag 类工具 (提示词编辑器 /
  //   WD14 反推 — 两者均面向 A1111 tag 体系, 对自然语言架构无意义); AI 助手保留
  //   (视频提示词更需要它, 且图像 natural 架构如 krea2/zimage 同样受益)。
  // 判据基于 promptStyle (非 mediaType): krea2/zimage 等「图像+natural」架构也收敛。
  const isNaturalPrompt = computed(() => store.currentConfig.promptStyle === 'natural')

  const promptTools = computed(() => {
    const tools = [
      { key: 'prompt-editor', icon: 'edit_note', label: t('generate.prompt.tools.prompt_editor'), title: t('generate.prompt.tools.prompt_editor_title') },
      { key: 'interrogate', icon: 'image_search', label: t('generate.prompt.tools.interrogate'), title: t('generate.prompt.tools.interrogate_title') },
      { key: 'llm-assist', icon: 'auto_awesome', label: t('generate.prompt.tools.llm_assist'), title: t('generate.prompt.tools.llm_assist_title') },
    ]
    // natural 模式过滤掉 tag 类工具 (prompt-editor / interrogate), 仅保留 llm-assist
    return isNaturalPrompt.value
      ? tools.filter(tool => tool.key === 'llm-assist')
      : tools
  })

  function openTagger() {
    prepareTagger()
    showTaggerModal.value = true
  }

  function onTaggerApply(tags: string) {
    if (tags) {
      state.value.positive = tags
      state.value.positiveDisabled = []
    }
  }

  async function openLlm() {
    await llm.open()
    showLlmModal.value = true
  }

  function onLlmApply(result: { positive: string; negative?: string }) {
    state.value.positive = result.positive
    state.value.positiveDisabled = []
    if (result.negative !== undefined) {
      state.value.negative = result.negative
      state.value.negativeDisabled = []
    }
    toast(result.negative !== undefined ? t('generate.llm_modal.used_all') : t('generate.llm_modal.used'), 'success')
  }

  function onEmbInsert(token: string, target: 'positive' | 'negative') {
    promptEditorRef.value?.insertAtCursor(target, token)
  }

  function onWcInsert(token: string) {
    promptEditorRef.value?.insertAtCursor('positive', token)
  }

  const showPromptEditorModal = ref(false)

  function onPromptTool(key: string) {
    switch (key) {
      case 'prompt-editor':
        showPromptEditorModal.value = true
        break
      case 'interrogate':
        openTagger()
        break
      case 'llm-assist':
        void openLlm()
        break
    }
  }

  // ── Model Picker (checkpoint / unet by modelField) ────────────────────────

  const showModelPicker = ref(false)
  const modelSelected = computed(() => {
    const name = modelField === 'unet' ? state.value.unet : state.value.checkpoint
    return new Set(name ? [name] : [])
  })

  function openModelPicker() {
    void options.refresh()
    showModelPicker.value = true
  }

  function onModelSelect(name: string) {
    if (modelField === 'unet') {
      state.value.unet = name
    } else {
      state.value.checkpoint = name
    }
    showModelPicker.value = false
    toast(t('generate.toast.selected', { name: basename(name).replace(/\.[^.]+$/, '') }), 'success')
  }

  // ── LoRA Picker ────────────────────────────────────────────────────────────

  const showLoraPicker = ref(false)
  const loraModalPending = ref(new Set<string>())
  const loraCountLabel = computed(() => t('generate.lora.count_selected', { count: loraModalPending.value.size }))

  function openLoraPicker() {
    loraModalPending.value = new Set(state.value.loras.map((lora) => lora.name))
    void options.refresh()
    showLoraPicker.value = true
  }

  function onLoraToggle(name: string) {
    const pending = new Set(loraModalPending.value)
    if (pending.has(name)) pending.delete(name)
    else pending.add(name)
    loraModalPending.value = pending
  }

  function onLoraConfirm() {
    const existing = new Map(state.value.loras.map((lora) => [lora.name, lora]))
    state.value.loras = [...loraModalPending.value].map((name) => {
      const previous = existing.get(name)
      return previous ? { ...previous } : { name, strength: 1.0, enabled: true }
    })
    showLoraPicker.value = false
  }

  const showLoraDetail = ref(false)
  const loraDetailModelId = ref<number | null>(null)

  function openLoraDetail(name: string) {
    const item = options.loras.value.find((lora) => lora.name === name)
    const id = item?.info?.local_model_id
    if (typeof id !== 'number' || !Number.isFinite(id)) return
    loraDetailModelId.value = id
    showLoraDetail.value = true
  }

  onUnmounted(() => {
    llm.close()
  })

  return {
    llm,
    embPicker,
    wcManager,
    promptEditorRef,
    showTaggerModal,
    showLlmModal,
    showPromptEditorModal,
    previewOpen,
    previewIndex,
    previewUrls,
    promptTools,
    isNaturalPrompt,
    // Model Picker
    showModelPicker,
    modelSelected,
    openModelPicker,
    onModelSelect,
    // LoRA
    showLoraPicker,
    loraModalPending,
    loraCountLabel,
    showLoraDetail,
    loraDetailModelId,
    // callbacks
    onPreviewClick,
    onPromptTool,
    onTaggerApply,
    onLlmApply,
    onEmbInsert,
    onWcInsert,
    openLoraPicker,
    onLoraToggle,
    onLoraConfirm,
    openLoraDetail,
  }
}
