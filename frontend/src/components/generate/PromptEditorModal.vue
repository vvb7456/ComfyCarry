<script setup lang="ts">
/**
 * PromptEditorModal — Main modal container for visual prompt editing.
 *
 * String is the single truth source:
 *   open → parse(string) → tokens → user edits → serialize(tokens) → emit string
 *
 * Features:
 *   - Positive / Negative tab switching (shared TokenInput area)
 *   - TokenInput with chips, autocomplete, toolbar
 *   - Embedding and Wildcard insertion as token chips
 *   - Real-time sync to parent (no confirm button)
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePromptEditor } from '@/composables/generate/usePromptEditor'
import { usePromptTranslate } from '@/composables/generate/usePromptTranslate'
import { usePromptLibrary } from '@/composables/generate/usePromptLibrary'
import { usePromptLibraryInit } from '@/composables/generate/usePromptLibraryInit'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { useConfirm } from '@/composables/useConfirm'
import { normalizePrompt } from '@/utils/prompt'
import type { BracketType, PromptTag } from '@/types/prompt-library'
import type { AutocompleteDisplayItem } from '@/composables/generate/useAutoComplete'
import type { UseEmbeddingPickerReturn } from '@/composables/generate/useEmbeddingPicker'
import type { UseWildcardManagerReturn } from '@/composables/generate/useWildcardManager'
import BaseModal from '@/components/ui/BaseModal.vue'
import FusionTabs from '@/components/ui/FusionTabs.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TokenInput from '@/components/generate/TokenInput.vue'
import TagBrowser from '@/components/generate/TagBrowser.vue'
import EmbeddingModal from '@/components/generate/EmbeddingModal.vue'
import WildcardModal from '@/components/generate/WildcardModal.vue'
import PromptLibraryGate from '@/components/generate/PromptLibraryGate.vue'

defineOptions({ name: 'PromptEditorModal' })

const props = defineProps<{
  modelValue: boolean
  positive: string
  negative: string
  embPicker: UseEmbeddingPickerReturn
  wcManager: UseWildcardManagerReturn
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:positive': [value: string]
  'update:negative': [value: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const { confirm } = useConfirm()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

// ── Active tab: positive or negative ───────────────────────────
const activeTab = ref<'positive' | 'negative'>('positive')
// Session counter: increments each time the modal opens.
// Used to discard stale async results from a previous editing session.
const sessionId = ref(0)

const promptTabs = computed(() => [
  { key: 'positive' as const, label: t('prompt-library.editor.positive') },
  { key: 'negative' as const, label: t('prompt-library.editor.negative') },
])

// ── Prompt editors (one per tab) ───────────────────────────────
const posEditor = usePromptEditor()
const negEditor = usePromptEditor()
const translate = usePromptTranslate()
const lib = usePromptLibrary()
const plInit = usePromptLibraryInit()
const { settings: promptSettings, load: loadPromptSettings } = usePromptSettings()

/** Normalize options derived from settings */
const normalizeOpts = computed(() => ({
  comma: promptSettings.normalize_comma,
  period: promptSettings.normalize_period,
  bracket: promptSettings.normalize_bracket,
  underscore: promptSettings.normalize_underscore,
  escapeBracket: promptSettings.escape_bracket,
}))

const activeEditor = computed(() =>
  activeTab.value === 'negative' ? negEditor : posEditor,
)

// Cleanup SSE on unmount
onUnmounted(() => plInit.destroy())

// Parse tokens when modal opens + resolve colors from library
watch(open, async (isOpen) => {
  // Increment session counter on every open/close transition so
  // in-flight async results from the previous state are discarded.
  sessionId.value++
  if (!isOpen) return
  try {
    // Load editor settings + check init status
    await Promise.all([loadPromptSettings(), plInit.checkStatus()])

    posEditor.parse(normalizePrompt(props.positive, normalizeOpts.value))
    negEditor.parse(normalizePrompt(props.negative, normalizeOpts.value))
    activeTab.value = 'positive'

    // Only resolve colors if library is initialized
    if (!plInit.initialized.value) return

    await _resolveTokenColors()
  } catch {
    // Settings or init check failed — tokens remain colorless but functional
  }
})

// ── Sync tokens → string → emit (real-time) ───────────────────
function syncToParent() {
  emit('update:positive', posEditor.serialize())
  emit('update:negative', negEditor.serialize())
}

// ── Token event handlers ───────────────────────────────────────

/**
 * Add token: insert synchronously (preserves paste order), then
 * asynchronously resolve library color/translate and enrich.
 */
function onAdd(text: string) {
  const editor = activeEditor.value
  // Synchronous insertion — order is preserved even on rapid-fire adds
  editor.addToken(text)
  syncToParent()

  // Async enrichment: upgrade raw → tag if library matches
  const token = editor.tokens.value[editor.tokens.value.length - 1]
  if (token && (token.type === 'raw' || token.type === 'tag')) {
    const tagAtAdd = token.tag
    lib.resolveTags([tagAtAdd]).then(resolved => {
      // Staleness guard: token may have been edited/removed since
      if (!editor.tokens.value.includes(token) || token.tag !== tagAtAdd) return
      const match = resolved[tagAtAdd]
      if (match) {
        token.type = 'tag'
        token.groupColor = match.color || undefined
        token.translate = match.translate || undefined
        syncToParent()
      }
    })
  }
}

function onAddBreak() {
  activeEditor.value.addToken('BREAK', 'break')
  syncToParent()
}

function onRemove(id: string) {
  activeEditor.value.removeToken(id)
  syncToParent()
}

function onToggle(id: string) {
  activeEditor.value.toggleToken(id)
  syncToParent()
}

function onUpdateWeight(id: string, weight: number) {
  activeEditor.value.updateWeight(id, weight)
  syncToParent()
}

function onUpdateBracket(id: string, type: BracketType, depth: number) {
  activeEditor.value.updateBracket(id, type, depth)
  syncToParent()
}

async function onUpdateTag(id: string, newTag: string) {
  const editor = activeEditor.value
  editor.updateTokenTag(id, newTag)
  syncToParent()

  // Re-resolve library color + translate asynchronously
  const token = editor.tokens.value.find(t => t.id === id)
  if (token && (token.type === 'raw' || token.type === 'tag')) {
    const tagAtResolve = token.tag
    const resolved = await lib.resolveTags([tagAtResolve])
    // Staleness guard: tag may have changed during await
    if (token.tag !== tagAtResolve) return
    const match = resolved[tagAtResolve]
    if (match) {
      token.type = 'tag'
      token.groupColor = match.color || undefined
      token.translate = match.translate || undefined
    } else {
      token.type = 'raw'
    }
    syncToParent()
  }
}

function onMove(fromIndex: number, toIndex: number) {
  activeEditor.value.moveToken(fromIndex, toIndex)
  syncToParent()
}

// ── Chip translation (per-token) ───────────────────────────────
const translatingIds = ref(new Set<string>())

async function onTranslate(id: string) {
  const editor = activeEditor.value
  const token = editor.tokens.value.find(t => t.id === id)
  if (!token) return

  const tagAtStart = token.tag
  translatingIds.value.add(id)
  try {
    const provider = promptSettings.translate_provider || undefined
    // Phase 1: local DB (fast)
    const local = await translate.translateWord(token.tag)
    // Staleness guard: tag may have changed during await
    if (token.tag !== tagAtStart) return
    if (local) {
      editor.setTokenTranslation(id, local)
      return
    }
    // Phase 2: remote API fallback
    const result = await translate.translateText(token.tag, 'en', 'zh', provider)
    if (token.tag !== tagAtStart) return
    if (result?.translate && result.translate.toLowerCase() !== token.tag.toLowerCase()) {
      editor.setTokenTranslation(id, result.translate)
    }
  } finally {
    translatingIds.value.delete(id)
  }
}

async function onTranslateAll() {
  const editor = activeEditor.value
  await translate.translateTokens(
    editor.tokens.value,
    (id, trans) => editor.setTokenTranslation(id, trans),
    promptSettings.translate_provider || undefined,
  )
}

// ── Translate input box (Chinese → English → chip) ─────────────
const translateInput = ref('')
const translating = ref(false)
const translateInputRef = ref<HTMLInputElement | null>(null)

/** Check if text contains non-ASCII characters (Chinese, Japanese, etc.) */
function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text)
}

async function onTranslateSubmit() {
  const text = translateInput.value.trim()
  if (!text || translating.value) return

  // If pure ASCII (English tag), insert directly without translation
  if (!hasNonAscii(text)) {
    onAdd(text)
    translateInput.value = ''
    return
  }

  // Contains non-ASCII → translate zh→en, keep original as translate fallback
  const editor = activeEditor.value
  const provider = promptSettings.translate_provider || undefined
  const sid = sessionId.value
  translating.value = true
  try {
    const result = await translate.translateText(text, 'zh', 'en', provider)
    if (sessionId.value !== sid) return  // stale session
    if (result?.translate) {
      const enTag = result.translate
      // Resolve library color/translate; fall back to user's original Chinese input
      const resolved = await lib.resolveTags([enTag])
      if (sessionId.value !== sid) return  // stale session
      const match = resolved[enTag]
      editor.addToken(
        enTag,
        match ? 'tag' : 'raw',
        match?.color || undefined,
        match?.translate || text,
      )
      syncToParent()
      translateInput.value = ''
    }
  } finally {
    translating.value = false
  }
}

async function onClearAll() {
  const yes = await confirm({ message: t('prompt-library.toolbar.clear_all_confirm'), variant: 'danger' })
  if (!yes) return
  activeEditor.value.clearAll()
  syncToParent()
}

function onClearDisabled() {
  activeEditor.value.clearDisabled()
  syncToParent()
}

function onSelectAutocomplete(item: AutocompleteDisplayItem) {
  if (item.added) return
  activeEditor.value.addToken(item.text, 'tag', item.color || undefined, item.desc || undefined)
  syncToParent()
}

function onHistory() {
  // TODO: open PromptHistoryModal
}

function onTagSelect(tag: PromptTag) {
  activeEditor.value.addToken(tag.text, 'tag', tag.color || undefined, tag.translate || undefined)
  syncToParent()
}

// ── Library initialization gate ────────────────────────────────
async function onInitImport() {
  const result = await plInit.startImport()
  if (result) {
    _resolveTokenColors()
  }
}

async function _resolveTokenColors() {
  const rawTags = [
    ...posEditor.tokens.value,
    ...negEditor.tokens.value,
  ].filter(t => t.type === 'raw').map(t => t.tag)
  if (rawTags.length) {
    const resolved = await lib.resolveTags([...new Set(rawTags)])
    posEditor.enrichTokens(resolved)
    negEditor.enrichTokens(resolved)
  }
}

// ── Embedding & Wildcard insertion ─────────────────────────────
async function openEmbedding() {
  await props.embPicker.open()
}

async function openWildcard() {
  await props.wcManager.open()
}

function onEmbInsert(token: string, target: 'positive' | 'negative') {
  const editor = target === 'positive' ? posEditor : negEditor
  editor.addToken(token, 'embedding')
  syncToParent()
}

function onWcInsert(token: string) {
  activeEditor.value.addToken(token, 'wildcard')
  syncToParent()
}
</script>

<template>
  <BaseModal
    v-model="open"
    :title="t('prompt-library.editor.title')"
    icon="edit_note"
    size="xxl"
  >
    <!-- Init gate: show when library not initialized -->
    <PromptLibraryGate
      v-if="plInit.show.value"
      :init="plInit"
      @import="onInitImport"
    />

    <!-- Normal editor content -->
    <div v-else class="pe-modal-body">
      <!-- Prompt editor container (tabs + token input) -->
      <FusionTabs
        v-model="activeTab"
        :tabs="promptTabs"
        :wrapped="true"
        :collapsible="false"
      >
        <template #extra>
          <div v-if="promptSettings.show_translation" class="pe-translate-box">
            <MsIcon name="translate" size="xs" color="none" />
            <input
              ref="translateInputRef"
              v-model="translateInput"
              class="pe-translate-input"
              type="text"
              :placeholder="t('prompt-library.editor.translate_input')"
              :disabled="translating"
              @keydown.enter.prevent="onTranslateSubmit"
            />
            <Spinner v-if="translating" size="sm" />
          </div>
        </template>
        <!-- Token Input (shared area — switches via v-show) -->
        <div v-show="activeTab === 'positive'" class="pe-token-area">
          <TokenInput
          :tokens="posEditor.tokens.value"
          :show-translation="promptSettings.show_translation"
          :autocomplete-limit="promptSettings.autocomplete_limit"
          :translating-ids="translatingIds"
          @add="onAdd"
          @add-break="onAddBreak"
          @remove="onRemove"
          @toggle="onToggle"
          @update:weight="onUpdateWeight"
          @update:bracket="onUpdateBracket"
          @update:tag="onUpdateTag"
          @translate="onTranslate"
          @translate-all="onTranslateAll"
          @move="onMove"
          @clear-all="onClearAll"
          @clear-disabled="onClearDisabled"
          @select-autocomplete="onSelectAutocomplete"
          @history="onHistory"
          @open-embedding="openEmbedding"
          @open-wildcard="openWildcard"
        />
      </div>
      <div v-show="activeTab === 'negative'" class="pe-token-area">
        <TokenInput
          :tokens="negEditor.tokens.value"
          :show-translation="promptSettings.show_translation"
          :autocomplete-limit="promptSettings.autocomplete_limit"
          :translating-ids="translatingIds"
          @add="onAdd"
          @add-break="onAddBreak"
          @remove="onRemove"
          @toggle="onToggle"
          @update:weight="onUpdateWeight"
          @update:bracket="onUpdateBracket"
          @update:tag="onUpdateTag"
          @translate="onTranslate"
          @translate-all="onTranslateAll"
          @move="onMove"
          @clear-all="onClearAll"
          @clear-disabled="onClearDisabled"
          @select-autocomplete="onSelectAutocomplete"
          @history="onHistory"
          @open-embedding="openEmbedding"
          @open-wildcard="openWildcard"
        />
      </div>
      </FusionTabs>

      <!-- Tag Browser -->
      <div class="pe-tag-area">
        <TagBrowser :show-translation="promptSettings.show_translation" @select="onTagSelect" />
      </div>
    </div>

    <!-- Embedding & Wildcard modals (nested inside PromptEditorModal) -->
    <EmbeddingModal
      v-model="embPicker.visible.value"
      :picker="embPicker"
      @insert="onEmbInsert"
    />
    <WildcardModal
      v-model="wcManager.visible.value"
      :wc="wcManager"
      @insert="onWcInsert"
    />
  </BaseModal>
</template>

<style scoped>
.pe-modal-body {
  display: flex;
  flex-direction: column;
  min-height: 500px;
}

/* ── Token area ── */
.pe-token-area {
  flex-shrink: 0;
}
/* Remove TokenInput's own border when inside FusionTabs wrapper */
.pe-token-area :deep(.token-input-wrap) {
  border: none;
  border-radius: 0;
}

/* ── Tag browser area ── */
.pe-tag-area {
  flex: 1;
  min-height: 200px;
  overflow-y: auto;
  margin-top: var(--sp-3);
}

/* ── Translate input box (in FusionTabs #extra slot) ── */
.pe-translate-box {
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: var(--sp-1);
  margin-left: auto;
  padding: 4px 10px;
  background: var(--bg);
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  font-size: var(--text-sm);
  flex-shrink: 0;
  transition: border-color .15s;
}
.pe-translate-box:focus-within {
  border-color: var(--ac);
}
.pe-translate-input {
  border: none;
  outline: none;
  background: transparent;
  color: var(--t1);
  font-size: var(--text-sm);
  width: 140px;
  max-width: 140px;
}
.pe-translate-input::placeholder {
  color: var(--t3);
}
.pe-translate-input:disabled {
  opacity: .6;
}

</style>
