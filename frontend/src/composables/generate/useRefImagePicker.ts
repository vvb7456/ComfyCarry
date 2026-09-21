import { ref } from 'vue'
import { useToast } from '@/composables/useToast'
import { apiErrorText } from '@/utils/apiError'
import { errorMessage } from '@/utils/errorMessage'

/**
 * 参考图上传区统一的 accept 白名单 (FileUploadZone 的 accept prop)。
 * 图生图 / ControlNet / 视频起始画面 / 预处理 / 打标 / LLM 六处共用一份,
 * 以免加格式时漏改其中某一处。
 */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp'

export interface InputImage {
  name: string
  size: number
}

export interface UploadResult {
  filename: string
  width?: number
  height?: number
}

export function useRefImagePicker(usageType: string, subfolder = '') {
  const { toast } = useToast()

  const visible = ref(false)
  const images = ref<InputImage[]>([])
  const loading = ref(false)
  const uploading = ref(false)

  async function open() {
    visible.value = true
    await loadImages()
  }

  function close() {
    visible.value = false
  }

  async function loadImages() {
    loading.value = true
    try {
      const qs = subfolder ? `?subfolder=${encodeURIComponent(subfolder)}` : ''
      const res = await fetch(`/api/generate/input_images${qs}`)
      if (res.ok) {
        const data = await res.json()
        images.value = data.images || []
      } else {
        images.value = []
      }
    } catch {
      images.value = []
    } finally {
      loading.value = false
    }
  }

  async function uploadFile(file: File): Promise<UploadResult | null> {
    if (uploading.value) return null
    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('type', usageType)
      if (subfolder) form.append('subfolder', subfolder)

      const res = await fetch('/api/generate/upload_image', {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast(apiErrorText(body, `Upload failed (${res.status})`), 'error')
        return null
      }
      const data = await res.json() as UploadResult
      loadImages()
      return data
    } catch (e: unknown) {
      toast(errorMessage(e) || 'Upload failed', 'error')
      return null
    } finally {
      uploading.value = false
    }
  }

  function readLocalPreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function previewUrl(name: string): string {
    return `/api/generate/input_image_preview?name=${encodeURIComponent(name)}`
  }

  return {
    visible,
    images,
    loading,
    uploading,
    open,
    close,
    loadImages,
    uploadFile,
    readLocalPreview,
    previewUrl,
  }
}
