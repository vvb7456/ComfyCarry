/**
 * useEmbeddingPicker — Embedding browsing and insertion composable.
 *
 * Lazy-loads embedding list from /api/generate/embeddings (cached).
 * Provides search filtering and insertion with auto-separator.
 *
 * Legacy: _embeddingsCache / _openEmbeddingModal / _insertEmbedding in page-generate.js
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'

export interface EmbeddingItem {
  name: string
  filename: string
  path: string
  size: number
}

export interface UseEmbeddingPickerReturn {
  visible: Ref<boolean>
  embeddings: Ref<EmbeddingItem[]>
  search: Ref<string>
  loading: Ref<boolean>
  filtered: ComputedRef<EmbeddingItem[]>
  open(): Promise<void>
  close(): void
}

export function useEmbeddingPicker(): UseEmbeddingPickerReturn {
  const { get } = useApiFetch()

  const visible = ref(false)
  const embeddings = ref<EmbeddingItem[]>([])
  const search = ref('')
  const loading = ref(false)
  let _loaded = false

  const filtered = computed(() => {
    const q = search.value.toLowerCase().trim()
    if (!q) return embeddings.value
    return embeddings.value.filter(e =>
      e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q),
    )
  })

  async function open() {
    visible.value = true
    if (!_loaded) {
      await loadEmbeddings()
    }
  }

  function close() {
    visible.value = false
  }

  async function loadEmbeddings() {
    loading.value = true
    try {
      const resp = await get<{ embeddings?: EmbeddingItem[] }>('/api/generate/embeddings')
      embeddings.value = resp?.embeddings || []
      _loaded = true
    } catch {
      embeddings.value = []
    } finally {
      loading.value = false
    }
  }

  return {
    visible,
    embeddings,
    search,
    loading,
    filtered,
    open,
    close,
  }
}
