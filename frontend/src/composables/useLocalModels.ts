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
  source?: string
  /** Backend capability: can fetch CivitAI info for this file */
  can_fetch_info?: boolean
  /** Backend capability: can delete this file */
  can_delete?: boolean
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

/**
 * 视觉资产 / 功能组件分界 — "默认"视图只显示视觉资产。
 * 语义标准: 换掉该文件, 生成画面的内容/风格会变 → 视觉资产 (用户收藏的模型);
 * 只服务于流程 (架构配件/结构控制/画质增强/检测分割等) → 功能组件。
 * 组件目录 (MODEL_DIRS 约 30 个) 会持续增长, 视觉资产目录极稳定 → 枚举后者,
 * 不在名单的 category 一律算组件。
 * 注意: unet/diffusion_models/unet_gguf/diffusers 是主模型的不同打包形态, 必须在列。
 */
const VISUAL_ASSET_CATEGORIES = new Set([
  'checkpoints', 'unet', 'diffusion_models', 'unet_gguf', 'diffusers',
  'loras', 'embeddings', 'hypernetworks',
])

export function useLocalModels() {
  const { get, post } = useApiFetch()

  const models = ref<LocalModel[]>([])
  const loading = ref(false)
  const error = ref('')

  // Filters ('default' = 仅视觉资产; 'all' = 含功能组件)
  const categoryFilter = ref('default')
  const folderFilter = ref('')
  const textFilter = ref('')

  // Derived: filtered models
  const filteredByCategory = computed(() => {
    if (categoryFilter.value === 'default')
      return models.value.filter(m => VISUAL_ASSET_CATEGORIES.has(m.category))
    if (categoryFilter.value === 'all') return models.value
    return models.value.filter(m => m.category === categoryFilter.value)
  })

  // Available folders based on current category filter (聚合视图无单一根目录, 不提供)
  const availableFolders = computed(() => {
    if (categoryFilter.value === 'all' || categoryFilter.value === 'default') return []
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
