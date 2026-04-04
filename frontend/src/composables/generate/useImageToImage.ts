import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { useRefImagePicker, type UploadResult } from './useRefImagePicker'
import { useToast } from '@/composables/useToast'

/**
 * Image-to-Image composable.
 *
 * Wraps useRefImagePicker with I2I-specific behaviors:
 * - Upload → auto-fill width/height → auto-enable module
 * - Select from input/ → fetch dimension via <img> → auto-fill
 * - clearImage → auto-disable module
 */
export function useImageToImage() {
  const store = useGenerateStore()
  const state = computed(() => store.currentState)
  const { t } = useI18n({ useScope: 'global' })
  const { toast } = useToast()

  const picker = useRefImagePicker('i2i', '')

  /** Set image from a server filename, optionally with known dimensions */
  function setImage(filename: string, width?: number, height?: number) {
    state.value.i2i.image = filename
    state.value.i2i.enabled = true
    if (width && height) {
      fillResolution(width, height)
    }
  }

  /** Clear the reference image and auto-disable i2i */
  function clearImage() {
    state.value.i2i.image = null
    state.value.i2i.enabled = false
  }

  /** Fill resolution fields in the store */
  function fillResolution(width: number, height: number) {
    state.value.resolution = 'custom'
    state.value.width = width
    state.value.height = height
  }

  /** Handle file upload (drag-drop or file input) */
  async function handleUpload(file: File) {
    const result = await picker.uploadFile(file)
    if (result) {
      setImage(result.filename, result.width, result.height)
      toast(t('generate.i2i.uploaded'), 'success')
    }
  }

  /** Handle select from input/ picker */
  function handleSelect(name: string) {
    state.value.i2i.image = name
    state.value.i2i.enabled = true
    // Fetch dimensions via Image element
    const img = new Image()
    img.onload = () => {
      fillResolution(img.naturalWidth, img.naturalHeight)
    }
    img.src = picker.previewUrl(name)
  }

  return {
    picker,
    setImage,
    clearImage,
    handleUpload,
    handleSelect,
  }
}
