import { ref, unref, watch, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useGenerateStore } from '@/stores/generate'
import type { AutocompleteItem, PromptLibraryDataResponse } from '@/types/prompt-library'

export interface AutocompleteDisplayItem extends AutocompleteItem {
  added: boolean
}

export interface UseAutoCompleteReturn {
  query: Ref<string>
  results: Ref<AutocompleteDisplayItem[]>
  visible: Ref<boolean>
  activeIndex: Ref<number>
  loading: Ref<boolean>

  moveUp(): void
  moveDown(): void
  confirm(): AutocompleteDisplayItem | null
  dismiss(): void
  reset(): void
}

// Pony V6 提示词约定: score_x (质量档) / source_x (画风来源) / rating_x (分级)。
const PONY_SPECIAL_TAGS: string[] = [
  'score_9',
  'score_8_up',
  'score_7_up',
  'score_6_up',
  'score_5_up',
  'score_4_up',
  'source_pony',
  'source_furry',
  'source_cartoon',
  'source_anime',
  'rating_safe',
  'rating_questionable',
  'rating_explicit',
]

function _ponyTagItem(tag: string): AutocompleteItem {
  return {
    text: tag,
    desc: 'Pony special tag',
    color: '',
    source: 'library',
    score: 1000,  // 高分, 排序优先
    hot: 0,
  }
}
export function useAutoComplete(
  existingTags: Ref<string[]> | ComputedRef<string[]>,
  limitRef: Ref<number> | ComputedRef<number> | number = 20,
): UseAutoCompleteReturn {
  const { get } = useApiFetch()
  const store = useGenerateStore()

  const query = ref('')
  const results = ref<AutocompleteDisplayItem[]>([])
  const visible = ref(false)
  const activeIndex = ref(-1)
  const loading = ref(false)

  let _debounceTimer: ReturnType<typeof setTimeout> | null = null
  let _fetchGen = 0 // generation counter to discard stale responses

  watch(query, (q) => {
    if (_debounceTimer) clearTimeout(_debounceTimer)
    const trimmed = q.trim()
    if (!trimmed) {
      _fetchGen++ // invalidate any in-flight request
      results.value = []
      visible.value = false
      activeIndex.value = -1
      return
    }
    // 提示词收敛: natural 模式 (视频 / krea2 / zimage 等) 不触发 tag 补全弹层。
    // 判据基于 promptStyle (非 mediaType): 任何 natural 架构都不需要 Danbooru tag 补全。
    // 早早返回, 不发后端请求, 不弹层 (回归保护: tags 模式行为一字不变)。
    if (store.currentConfig.promptStyle === 'natural') {
      _fetchGen++
      results.value = []
      visible.value = false
      activeIndex.value = -1
      return
    }
    _debounceTimer = setTimeout(() => fetchResults(trimmed), 150)
  })

  async function fetchResults(q: string) {
    const gen = ++_fetchGen
    loading.value = true
    try {
      const resp = await get<PromptLibraryDataResponse<AutocompleteItem[]>>(
        `/api/prompt-library/autocomplete?q=${encodeURIComponent(q)}&limit=${unref(limitRef)}`,
      )
      if (gen !== _fetchGen) return
      let items = resp?.data ?? []

      if (store.activeModelType === 'pony') {
        const qLower = q.toLowerCase()
        const ponyMatches = PONY_SPECIAL_TAGS
          .filter(tag => tag.toLowerCase().includes(qLower))
          .map(_ponyTagItem)
        items = [...ponyMatches, ...items]
      }

      const existingSet = new Set(existingTags.value.map(t => t.toLowerCase()))

      const notAdded: AutocompleteDisplayItem[] = []
      const added: AutocompleteDisplayItem[] = []

      for (const item of items) {
        const isAdded = existingSet.has(item.text.toLowerCase())
        const displayItem: AutocompleteDisplayItem = { ...item, added: isAdded }
        if (isAdded) {
          added.push(displayItem)
        } else {
          notAdded.push(displayItem)
        }
      }

      results.value = [...notAdded, ...added]
      visible.value = true
      activeIndex.value = -1
    } catch {
      results.value = []
      visible.value = false
    } finally {
      loading.value = false
    }
  }

  function moveUp() {
    if (!visible.value || results.value.length === 0) return
    activeIndex.value = activeIndex.value <= 0
      ? results.value.length - 1
      : activeIndex.value - 1
  }

  function moveDown() {
    if (!visible.value || results.value.length === 0) return
    activeIndex.value = activeIndex.value >= results.value.length - 1
      ? 0
      : activeIndex.value + 1
  }

  function confirm(): AutocompleteDisplayItem | null {
    if (!visible.value || activeIndex.value < 0) return null
    const item = results.value[activeIndex.value]
    dismiss()
    return item ?? null
  }

  function dismiss() {
    visible.value = false
    results.value = []
    activeIndex.value = -1
    query.value = ''
  }

  function reset() {
    if (_debounceTimer) clearTimeout(_debounceTimer)
    dismiss()
  }

  return {
    query,
    results,
    visible,
    activeIndex,
    loading,
    moveUp,
    moveDown,
    confirm,
    dismiss,
    reset,
  }
}
