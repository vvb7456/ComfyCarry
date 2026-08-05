import { ref, computed, watch } from 'vue'
import { useApiFetch } from './useApiFetch'

/** Lightweight row returned by GET /api/local_models. */
export interface LocalModel {
  id: number
  filename: string
  category: string
  relative_path: string
  display_name: string
  model_type: string
  architecture: string
  base_model: string
  size_bytes: number
  file_mtime: number
  has_info: boolean
  has_preview: boolean
  preview_url?: string | null
  /** First remote CivitAI preview retained as a lightweight list fallback. */
  remote_preview_url?: string | null
  remote_preview_type?: string | null
  source_type: string
  can_fetch_info: boolean
  can_delete: boolean
}

export interface LocalModelImage {
  url: string
  type?: string
  width?: number
  height?: number
  nsfw_level?: number
  meta?: {
    seed?: number | string
    prompt?: string
    negative_prompt?: string
    steps?: number
    sampler?: string
    cfg_scale?: number
    model?: string
    resources?: unknown[]
  }
}

export interface LocalModelDetail extends LocalModel {
  sha256: string
  trigger_words: string[]
  trigger_sources: Record<string, string[]>
  source: {
    type: string
    model_id: string
    version_id: string
    version_name: string
  }
  links: Array<{ type: string; url: string }>
  images: LocalModelImage[]
}

/**
 * Visual assets are the useful default view. Other ComfyUI model directories
 * remain available through the explicit category/all filters.
 */
const VISUAL_ASSET_CATEGORIES = new Set([
  'checkpoints', 'unet', 'diffusion_models', 'unet_gguf', 'diffusers',
  'loras', 'embeddings', 'hypernetworks',
])

export function useLocalModels() {
  const { get } = useApiFetch()

  const models = ref<LocalModel[]>([])
  const loading = ref(false)
  const error = ref('')

  const categoryFilter = ref('default')
  const folderFilter = ref('')
  const textFilter = ref('')

  const filteredByCategory = computed(() => {
    if (categoryFilter.value === 'default') {
      return models.value.filter(m => VISUAL_ASSET_CATEGORIES.has(m.category))
    }
    if (categoryFilter.value === 'all') return models.value
    return models.value.filter(m => m.category === categoryFilter.value)
  })

  const availableFolders = computed(() => {
    if (categoryFilter.value === 'all' || categoryFilter.value === 'default') return []
    const folders = new Set<string>()
    for (const model of filteredByCategory.value) {
      const idx = model.relative_path.indexOf('/')
      if (idx > 0) folders.add(model.relative_path.substring(0, idx))
    }
    return [...folders].sort()
  })

  const filteredModels = computed(() => {
    let result = filteredByCategory.value
    if (folderFilter.value) {
      result = result.filter(m => m.relative_path.startsWith(`${folderFilter.value}/`))
    }
    if (textFilter.value) {
      const q = textFilter.value.toLowerCase()
      result = result.filter(m =>
        m.display_name.toLowerCase().includes(q) ||
        m.filename.toLowerCase().includes(q),
      )
    }
    return result
  })

  const totalCount = computed(() => filteredByCategory.value.length)
  const infoCount = computed(() => filteredByCategory.value.filter(m => m.has_info).length)

  watch(categoryFilter, () => {
    folderFilter.value = ''
  })

  async function loadModels() {
    loading.value = true
    error.value = ''
    try {
      const data = await get<{ models: LocalModel[] }>('/api/local_models?category=all')
      if (!data) {
        error.value = 'Failed to load models'
      } else {
        models.value = data.models || []
      }
    } finally {
      loading.value = false
    }
  }

  return {
    models,
    loading,
    error,
    categoryFilter,
    folderFilter,
    textFilter,
    filteredModels,
    availableFolders,
    totalCount,
    infoCount,
    loadModels,
  }
}
