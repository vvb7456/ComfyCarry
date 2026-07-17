/**
 * useAutoComplete — Autocomplete composable for Token Input.
 *
 * - Debounced backend API queries (150ms)
 * - Keyboard navigation (↑/↓/Enter/Tab/Escape)
 * - Marks already-added tokens in the result list
 * - Triggers on ≥1 char input
 * - E: Pony tab 注入特殊标签组 (score_x / source_x / rating_x) — 排序优先于后端候选
 */
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

// ── E: Pony 特殊标签组 ──────────────────────────────────────────────────────
// Pony V6 提示词约定: score_x (质量档) / source_x (画风来源) / rating_x (分级)。
// 仅在 store.activeModelType === 'pony' 时注入, 按规格给定顺序优先排列。
// 非 pony tab 不注入。常量放在此文件 (与 useAutoComplete 同文件), 注释说明用途。
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

/** 构造 pony 特殊标签的 AutocompleteItem (合成候选, 不走后端) */
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

  // ── Debounced search ─────────────────────────────────────────
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
    _debounceTimer = setTimeout(() => fetchResults(trimmed), 150)
  })

  async function fetchResults(q: string) {
    const gen = ++_fetchGen
    loading.value = true
    try {
      const resp = await get<PromptLibraryDataResponse<AutocompleteItem[]>>(
        `/api/prompt-library/autocomplete?q=${encodeURIComponent(q)}&limit=${unref(limitRef)}`,
      )
      if (gen !== _fetchGen) return // stale response — discard
      let items = resp?.data ?? []

      // E: pony tab 注入特殊标签组 — 按查询过滤, 排序优先于后端候选
      if (store.activeModelType === 'pony') {
        const qLower = q.toLowerCase()
        const ponyMatches = PONY_SPECIAL_TAGS
          .filter(tag => tag.toLowerCase().includes(qLower))
          .map(_ponyTagItem)
        items = [...ponyMatches, ...items]
      }

      const existingSet = new Set(existingTags.value.map(t => t.toLowerCase()))

      // Split: non-added first, added last
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

  // ── Keyboard navigation ──────────────────────────────────────
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

  /**
   * Confirm the currently highlighted item.
   * Returns the item or null if nothing is selected.
   */
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
