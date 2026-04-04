import { ref } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'

// ── Types ────────────────────────────────────────────────────────────────────

export interface InputImage {
  name: string
  size: number
}

export interface UploadResult {
  filename: string
  width?: number
  height?: number
}

// ── Composable ───────────────────────────────────────────────────────────────

/**
 * Shared composable for picking / uploading reference images.
 * Used by I2I panel and future ControlNet panels.
 *
 * @param usageType — usage label sent with upload (e.g. 'i2i', 'pose')
 * @param subfolder — optional subfolder inside ComfyUI input/ to list
 */
export function useRefImagePicker(usageType: string, subfolder = '') {
  const { toast } = useToast()

  const visible = ref(false)
  const images = ref<InputImage[]>([])
  const loading = ref(false)
  const uploading = ref(false)

  /** Open picker modal and load image list */
  async function open() {
    visible.value = true
    await loadImages()
  }

  function close() {
    visible.value = false
  }

  /** Fetch image list from backend */
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

  /** Upload a local file to server, returns server filename + dimensions */
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
        toast((body as Record<string, string>).error || `Upload failed (${res.status})`, 'error')
        return null
      }
      const data = await res.json() as UploadResult
      // Refresh list so newly uploaded image appears
      loadImages()
      return data
    } catch (e: any) {
      toast(e?.message || 'Upload failed', 'error')
      return null
    } finally {
      uploading.value = false
    }
  }

  /** Get local preview data URL for a file (before upload completes) */
  function readLocalPreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  /** Build preview URL for an image already in ComfyUI input/ */
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
