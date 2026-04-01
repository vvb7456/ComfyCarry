import { ref } from 'vue'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

export interface PreviewImage {
  filename: string
  subfolder: string
  type: string
  url: string
}

function buildImageUrl(img: { filename: string; subfolder: string; type: string }): string {
  const params = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || '',
    type: img.type || 'output',
  })
  return `/api/comfyui/view?${params}`
}

/**
 * Generate output image preview composable.
 * Fetches output images from /api/comfyui/history after execution.
 * Retries up to 6 times with 1s interval (legacy behavior).
 */
export function useGeneratePreview() {
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })
  const images = ref<PreviewImage[]>([])
  const loading = ref(false)
  const currentPreview = ref<string | null>(null)

  async function fetchOutputImages(promptId: string): Promise<void> {
    loading.value = true
    currentPreview.value = null

    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(`/api/comfyui/history?prompt_id=${encodeURIComponent(promptId)}`)
        if (res.ok) {
          const data = await res.json()
          const entry = data?.history?.[0]
          if (entry?.images?.length) {
            images.value = entry.images.map((img: { filename: string; subfolder: string; type: string }) => ({
              ...img,
              url: buildImageUrl(img),
            }))
            loading.value = false
            return
          }
        }
      } catch { /* retry */ }

      if (attempt < 5) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    // All retries exhausted — toast warning (legacy behavior)
    toast(t('generate.toast.no_output'), 'warning')
    loading.value = false
  }

  function setLivePreview(dataUrl: string) {
    currentPreview.value = dataUrl
  }

  function clearPreview() {
    images.value = []
    currentPreview.value = null
  }

  return { images, loading, currentPreview, fetchOutputImages, setLivePreview, clearPreview }
}
