import { computed, onUnmounted, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { useLlmAssist } from '@/composables/generate/useLlmAssist'
import { useEmbeddingPicker } from '@/composables/generate/useEmbeddingPicker'
import { useWildcardManager } from '@/composables/generate/useWildcardManager'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import type { GenerateOptionsReturn } from '@/composables/generate/useGenerateOptions'
import type { ModelMeta, ModelMetaImage } from '@/types/models'
import { useToast } from '@/composables/useToast'

interface PromptEditorHandle {
  insertAtCursor: (target: 'positive' | 'negative', text: string) => void
}

interface UseSdxlModalManagerOptions {
  options: GenerateOptionsReturn
  previewImages: Ref<PreviewImage[]>
  prepareTagger: () => void
}

export function useSdxlModalManager({
  options,
  previewImages,
  prepareTagger,
}: UseSdxlModalManagerOptions) {
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

  const promptTools = computed(() => [
    { key: 'prompt-editor', icon: 'edit_note', label: t('generate.prompt.tools.prompt_editor'), title: t('generate.prompt.tools.prompt_editor_title') },
    { key: 'interrogate', icon: 'image_search', label: t('generate.prompt.tools.interrogate'), title: t('generate.prompt.tools.interrogate_title') },
    { key: 'llm-assist', icon: 'auto_awesome', label: t('generate.prompt.tools.llm_assist'), title: t('generate.prompt.tools.llm_assist_title') },
  ])

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

  const showCkptPicker = ref(false)
  const ckptSelected = computed(() => new Set(state.value.checkpoint ? [state.value.checkpoint] : []))

  function openCkptPicker() {
    void options.refresh()
    showCkptPicker.value = true
  }

  function onCkptSelect(name: string) {
    state.value.checkpoint = name
    showCkptPicker.value = false
    const displayName = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
    toast(t('generate.toast.selected', { name: displayName.replace(/\.[^.]+$/, '') }), 'success')
  }

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
  const loraDetailMeta = ref<ModelMeta | null>(null)

  function openLoraDetail(name: string) {
    const item = options.loras.value.find((lora) => lora.name === name)
    if (!item) return

    const info = item.info as Record<string, unknown> | null
    const images: ModelMetaImage[] = []

    if (item.preview) {
      images.push({ url: `/api/local_models/preview?path=${encodeURIComponent(item.preview)}` })
    }

    const civitaiImages = info?.images as Array<Record<string, unknown>> | undefined
    if (civitaiImages) {
      for (const image of civitaiImages) {
        images.push({
          url: (image.url as string) || '',
          type: (image.type as string) || undefined,
          seed: image.seed as number | string | undefined,
          steps: image.steps as number | undefined,
          cfg: image.cfg as number | undefined,
          sampler: image.sampler as string | undefined,
          model: image.model as string | undefined,
          positive: image.positive as string | undefined,
          negative: image.negative as string | undefined,
        })
      }
    }

    const basename = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
    const civitaiId = info?.civitai_id as string | number | undefined
    loraDetailMeta.value = {
      name: (info?.name as string) || basename.replace(/\.[^.]+$/, ''),
      type: 'LORA',
      baseModel: (info?.baseModel as string) || undefined,
      id: civitaiId,
      versionId: (info?.versionId as string | number) || undefined,
      versionName: (info?.versionName as string) || undefined,
      sha256: (info?.sha256 as string) || undefined,
      filename: basename,
      civitaiUrl: civitaiId ? `https://civitai.com/models/${civitaiId}` : undefined,
      trainedWords: (info?.trainedWords as string[]) || undefined,
      images,
    }
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
    showCkptPicker,
    ckptSelected,
    showLoraPicker,
    loraModalPending,
    loraCountLabel,
    showLoraDetail,
    loraDetailMeta,
    onPreviewClick,
    onPromptTool,
    onTaggerApply,
    onLlmApply,
    onEmbInsert,
    onWcInsert,
    openCkptPicker,
    onCkptSelect,
    openLoraPicker,
    onLoraToggle,
    onLoraConfirm,
    openLoraDetail,
  }
}
