<script setup lang="ts">
/**
 * AutoCompleteList — Floating dropdown list for tag autocomplete.
 *
 * Teleported to body and positioned via fixed coordinates passed from parent.
 * Shows: English tag (bold match) | Chinese translation | Danbooru popularity
 * Already-added tags are shown at the bottom with grey "已添加" mark.
 * Active item highlighted via activeIndex.
 */
import { computed, watch, ref, nextTick, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AutocompleteDisplayItem } from '@/composables/generate/useAutoComplete'

defineOptions({ name: 'AutoCompleteList' })

const props = defineProps<{
  items: AutocompleteDisplayItem[]
  activeIndex: number
  query: string
  visible: boolean
  showTranslation?: boolean
  positionStyle?: CSSProperties
}>()

const emit = defineEmits<{
  select: [item: AutocompleteDisplayItem]
}>()

const { t } = useI18n({ useScope: 'global' })
const listRef = ref<HTMLElement | null>(null)

// Auto-scroll active item into view
watch(() => props.activeIndex, async (idx) => {
  if (idx < 0 || !listRef.value) return
  await nextTick()
  const el = listRef.value.children[idx] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest' })
})

// ── Highlight matching portion ─────────────────────────────────
function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text)
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return escapeHtml(text)
  const before = escapeHtml(text.slice(0, idx))
  const match = escapeHtml(text.slice(idx, idx + query.length))
  const after = escapeHtml(text.slice(idx + query.length))
  return `${before}<b>${match}</b>${after}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Format popularity number ───────────────────────────────────
function fmtHot(score: number): string {
  if (score >= 1_000_000) return `${(score / 1_000_000).toFixed(1)}M`
  if (score >= 1_000) return `${(score / 1_000).toFixed(0)}K`
  return String(score)
}

const hasDivider = computed(() => {
  // Check if there's a boundary between non-added and added
  const idx = props.items.findIndex(i => i.added)
  return idx > 0
})
const dividerIndex = computed(() => props.items.findIndex(i => i.added))
</script>

<template>
  <Teleport to="body">
    <div
      v-show="visible"
      ref="listRef"
      class="ac-list"
      :style="positionStyle"
    >
      <!-- Empty state -->
      <div v-if="items.length === 0" class="ac-empty">
        {{ t('prompt-library.autocomplete.no_results') }}
      </div>

      <template v-for="(item, idx) in items" :key="item.text + idx">
        <!-- Divider before first added item -->
        <div v-if="idx === dividerIndex && hasDivider" class="ac-divider" />

        <div
          class="ac-item"
          :class="{
            'ac-item--active': idx === activeIndex,
            'ac-item--added': item.added,
          }"
          @mousedown.prevent="emit('select', item)"
          @mouseenter="$event.stopPropagation()"
        >
          <span class="ac-tag" v-html="highlightMatch(item.text, query)" />
          <span v-if="showTranslation !== false && item.desc" class="ac-desc">{{ item.desc }}</span>
          <span v-if="item.added" class="ac-added">{{ t('prompt-library.chip.added') }}</span>
          <span
            v-else-if="(item.hot ?? 0) > 0"
            class="ac-hot"
          >★ {{ fmtHot(item.hot!) }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ac-list {
  position: fixed;
  z-index: 10001;
  max-height: 280px;
  min-width: 300px;
  max-width: 500px;
  overflow-y: auto;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-sm);
  box-shadow: var(--sh);
  margin-top: 2px;
}

.ac-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background .1s;
}
.ac-item:hover,
.ac-item--active {
  background: var(--bg3);
}
.ac-item--added {
  opacity: .5;
}

.ac-tag {
  color: var(--t1);
  font-weight: 500;
  flex-shrink: 0;
}
.ac-tag :deep(b) {
  color: var(--ac);
  font-weight: 700;
}

.ac-desc {
  color: var(--t3);
  font-size: var(--text-xs);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-hot {
  color: var(--amber);
  font-size: var(--text-xs);
  flex-shrink: 0;
  white-space: nowrap;
}

.ac-added {
  color: var(--t3);
  font-size: var(--text-xs);
  font-style: italic;
  flex-shrink: 0;
}

.ac-divider {
  height: 1px;
  background: var(--bd);
  margin: 2px 8px;
}

.ac-empty {
  padding: 12px 10px;
  font-size: var(--text-sm);
  color: var(--t3);
  text-align: center;
}
</style>
