import { ref, computed, watch } from 'vue'
import { useApiFetch } from './useApiFetch'

export interface LocalModel {
  filename: string
  name: string
  category: string
  rel_path: string
  abs_path: string
  size_bytes: number
  has_info: boolean
  has_preview: boolean
  preview_path?: string
  civitai_id?: number
  civitai_version_id?: number
  civitai_image?: string
  civitai_image_type?: string
  base_model?: string
  sha256?: string
  version_name?: string
  trained_words?: string[]
  links?: string[]
  images?: Array<{
    url: string
    type?: string
    seed?: number | string
    steps?: number
    cfg?: number
    sampler?: string
    model?: string
    positive?: string
    negative?: string
  }>
}

export function useLocalModels() {
  const { get, post } = useApiFetch()

  const models = ref<LocalModel[]>([])
  const loading = ref(false)
  const error = ref('')

  // Filters
  const categoryFilter = ref('all')
  const folderFilter = ref('')
  const textFilter = ref('')

  // Derived: filtered models
  const filteredByCategory = computed(() => {
    if (categoryFilter.value === 'all') return models.value
    return models.value.filter(m => m.category === categoryFilter.value)
  })

  // Available folders based on current category filter
  const availableFolders = computed(() => {
    if (categoryFilter.value === 'all') return []
    const folders = new Set<string>()
    for (const m of filteredByCategory.value) {
      const idx = m.rel_path.indexOf('/')
      if (idx > 0) folders.add(m.rel_path.substring(0, idx))
    }
    return [...folders].sort()
  })

  // Final filtered list
  const filteredModels = computed(() => {
    let result = filteredByCategory.value

    // Folder filter
    if (folderFilter.value) {
      result = result.filter(m => m.rel_path.startsWith(folderFilter.value + '/'))
    }

    // Text filter (name or filename)
    if (textFilter.value) {
      const q = textFilter.value.toLowerCase()
      result = result.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        m.filename.toLowerCase().includes(q),
      )
    }

    return result
  })

  // Stats
  const totalCount = computed(() => filteredByCategory.value.length)
  const infoCount = computed(() => filteredByCategory.value.filter(m => m.has_info).length)

  // Reset folder when category changes
  watch(categoryFilter, () => {
    folderFilter.value = ''
  })

  async function loadModels() {
    loading.value = true
    error.value = ''
    const data = await get<{ models: LocalModel[] }>('/api/local_models?category=all')
    if (!data) {
      error.value = 'Failed to load models'
    } else {
      models.value = data.models || []
    }
    loading.value = false
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
