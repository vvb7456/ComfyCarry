/**
 * useAutoComplete — Autocomplete composable for Token Input.
 *
 * - Debounced backend API queries (150ms)
 * - Keyboard navigation (↑/↓/Enter/Tab/Escape)
 * - Marks already-added tokens in the result list
 * - Triggers on ≥1 char input
 */
import { ref, unref, watch, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
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

export function useAutoComplete(
  existingTags: Ref<string[]> | ComputedRef<string[]>,
  limitRef: Ref<number> | ComputedRef<number> | number = 20,
): UseAutoCompleteReturn {
  const { get } = useApiFetch()

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
      const items = resp?.data ?? []
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
      activeIndex.value = results.value.length > 0 ? 0 : -1
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
