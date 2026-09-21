import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { useRefImagePicker } from './useRefImagePicker'
import { useToast } from '@/composables/useToast'

export function useImageToImage() {
  const store = useGenerateStore()
  const state = computed(() => store.currentState)
  const { t } = useI18n({ useScope: 'global' })
  const { toast } = useToast()

  const picker = useRefImagePicker('i2i', '')
  const maskPicker = useRefImagePicker('inpaint_mask', 'inpaint')

  const maskEditorVisible = ref(false)

  function setImage(filename: string, width?: number, height?: number) {
    state.value.i2i.image = filename
    state.value.i2i.enabled = true
    if (width && height) {
      fillResolution(width, height)
    }
  }

  function clearImage() {
    state.value.i2i.image = null
    state.value.i2i.enabled = false
    state.value.i2i.mask = null
  }

  function fillResolution(width: number, height: number) {
    state.value.resolution = 'custom'
    state.value.width = width
    state.value.height = height
  }

  async function handleUpload(file: File) {
    const result = await picker.uploadFile(file)
    if (result) {
      setImage(result.filename, result.width, result.height)
      toast(t('generate.i2i.uploaded'), 'success')
    }
  }

  function handleSelect(name: string) {
    state.value.i2i.image = name
    state.value.i2i.enabled = true
    state.value.i2i.mask = null
    const img = new Image()
    img.onload = () => {
      fillResolution(img.naturalWidth, img.naturalHeight)
    }
    img.src = picker.previewUrl(name)
  }

  function openMaskEditor() {
    maskEditorVisible.value = true
  }

  function setMask(filename: string) {
    state.value.i2i.mask = filename
  }

  function clearMask() {
    state.value.i2i.mask = null
  }

  async function uploadMask(blob: Blob): Promise<string | null> {
    const file = new File([blob], 'mask.png', { type: 'image/png' })
    const result = await maskPicker.uploadFile(file)
    if (result) {
      setMask(result.filename)
      return result.filename
    }
    return null
  }

  return {
    picker,
    maskPicker,
    maskEditorVisible,
    setImage,
    clearImage,
    handleUpload,
    handleSelect,
    openMaskEditor,
    setMask,
    clearMask,
    uploadMask,
  }
}
