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
import { usePromptEditor, buildRaw } from '@/composables/generate/usePromptEditor'
import { usePromptTranslate } from '@/composables/generate/usePromptTranslate'
import { usePromptLibrary } from '@/composables/generate/usePromptLibrary'
import { usePromptLibraryInit } from '@/composables/generate/usePromptLibraryInit'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { useGenerateStore } from '@/stores/generate'
import { normalizePrompt } from '@/utils/prompt'
import type { BracketType, PromptTag, PromptToken } from '@/types/prompt-library'
import type { AutocompleteDisplayItem } from '@/composables/generate/useAutoComplete'
import type { UseEmbeddingPickerReturn } from '@/composables/generate/useEmbeddingPicker'
import type { UseWildcardManagerReturn } from '@/composables/generate/useWildcardManager'
import BaseModal from '@/components/ui/BaseModal.vue'
import FusionTabs from '@/components/ui/FusionTabs.vue'
import TokenInput from '@/components/generate/TokenInput.vue'
import TagBrowser from '@/components/generate/TagBrowser.vue'
import EmbeddingModal from '@/components/generate/EmbeddingModal.vue'
import WildcardModal from '@/components/generate/WildcardModal.vue'
import PromptHistoryModal from '@/components/generate/PromptHistoryModal.vue'
import PromptLibraryGate from '@/components/generate/PromptLibraryGate.vue'

defineOptions({ name: 'PromptEditorModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  positive: string
  negative: string
  embPicker: UseEmbeddingPickerReturn
  wcManager: UseWildcardManagerReturn
  showNegative?: boolean
}>(), {
  showNegative: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:positive': [value: string]
  'update:negative': [value: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const { confirm } = useConfirm()
const { toast } = useToast()

const historyModalVisible = ref(false)

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

// ── Active tab: positive or negative ───────────────────────────
const activeTab = ref<'positive' | 'negative'>('positive')
// Session counter: increments each time the modal opens.
// Used to discard stale async results from a previous editing session.
const sessionId = ref(0)

const promptTabs = computed(() => {
  const tabs: Array<{ key: 'positive' | 'negative'; label: string }> = [
    { key: 'positive', label: t('prompt-library.editor.positive') },
  ]
  if (props.showNegative) {
    tabs.push({ key: 'negative', label: t('prompt-library.editor.negative') })
  }
  return tabs
})

// ── Prompt editors (one per tab) ───────────────────────────────
const posEditor = usePromptEditor()
const negEditor = usePromptEditor()
const translate = usePromptTranslate()
const lib = usePromptLibrary()
const plInit = usePromptLibraryInit()
const { settings: promptSettings, load: loadPromptSettings } = usePromptSettings()
const genStore = useGenerateStore()

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

    // Restore disabled tokens from store
    const state = genStore.currentState
    posEditor.injectDisabled(state.positiveDisabled)
    negEditor.injectDisabled(state.negativeDisabled)

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
  // Emit only enabled tokens as the prompt string
  emit('update:positive', posEditor.serializeEnabled())
  emit('update:negative', negEditor.serializeEnabled())
  // Persist disabled tokens to store
  const state = genStore.currentState
  state.positiveDisabled = posEditor.extractDisabled()
  state.negativeDisabled = negEditor.extractDisabled()
}

// ── Token event handlers ───────────────────────────────────────

function escapeBrackets(text: string): string {
  if (!promptSettings.escape_bracket) return text
  return text.replace(/(?<!\\)\(/g, '\\(').replace(/(?<!\\)\)/g, '\\)')
}

/**
 * Add token: insert synchronously (preserves paste order), then
 * asynchronously resolve library color/translate and enrich.
 */
function onAdd(text: string) {
  const editor = activeEditor.value
  if (hasNonAscii(text)) {
    editor.addToken(text, 'raw')
    const token = editor.tokens.value[editor.tokens.value.length - 1]
    if (token) {
      token.pending = true
      syncToParent()
      _translatePendingToken(token, text, editor)
    }
    return
  }
  editor.addToken(text)
  syncToParent()
  const token = editor.tokens.value[editor.tokens.value.length - 1]
  if (token && (token.type === 'raw' || token.type === 'tag')) {
    const tagAtAdd = token.tag
    lib.resolveTags([tagAtAdd]).then(resolved => {
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

async function _translatePendingToken(token: PromptToken, originalText: string, editor: ReturnType<typeof usePromptEditor>) {
  const sid = sessionId.value
  const provider = promptSettings.translate_provider || undefined
  try {
    const result = await translate.translateText(originalText, 'zh', 'en', provider)
    if (sessionId.value !== sid) return
    if (!editor.tokens.value.includes(token)) return
    if (result?.translate) {
      const enTag = result.translate
      const resolved = await lib.resolveTags([enTag])
      if (sessionId.value !== sid) return
      if (!editor.tokens.value.includes(token)) return
      const match = resolved[enTag]
      token.tag = enTag
      token.type = match ? 'tag' : 'raw'
      token.groupColor = match?.color || undefined
      token.translate = match?.translate || originalText
      token.pending = false
      token.raw = buildRaw(token)
      syncToParent()
    } else {
      token.pending = false
      syncToParent()
    }
  } catch {
    if (!editor.tokens.value.includes(token)) return
    token.pending = false
    syncToParent()
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
    if (hasNonAscii(token.tag)) {
      const provider = promptSettings.translate_provider || undefined
      const result = await translate.translateText(token.tag, 'zh', 'en', provider)
      if (token.tag !== tagAtStart) return
      if (result?.translate) {
        const enTag = result.translate
        const resolved = await lib.resolveTags([enTag])
        if (token.tag !== tagAtStart) return
        const match = resolved[enTag]
        token.tag = enTag
        token.type = match ? 'tag' : 'raw'
        token.groupColor = match?.color || undefined
        token.translate = match?.translate || tagAtStart
        token.raw = buildRaw(token)
        syncToParent()
      }
      return
    }
    const provider = promptSettings.translate_provider || undefined
    const local = await translate.translateWord(token.tag)
    if (token.tag !== tagAtStart) return
    if (local) {
      editor.setTokenTranslation(id, local)
      return
    }
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

// ── Non-ASCII detection ───────────────────────────────────────
function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text)
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
  activeEditor.value.addToken(escapeBrackets(item.text), 'tag', item.color || undefined, item.desc || undefined)
  syncToParent()
}

function onHistory() {
  historyModalVisible.value = true
}

async function onHistoryApply(item: { positive: string; negative: string }) {
  const hasContent =
    posEditor.tokens.value.some(t => t.enabled) ||
    negEditor.tokens.value.some(t => t.enabled)
  if (hasContent) {
    const yes = await confirm({
      message: t('prompt-library.history_modal.confirm_replace'),
      variant: 'danger',
    })
    if (!yes) return
  }
  posEditor.parse(normalizePrompt(item.positive, normalizeOpts.value))
  negEditor.parse(normalizePrompt(item.negative, normalizeOpts.value))
  genStore.currentState.positiveDisabled = []
  genStore.currentState.negativeDisabled = []
  syncToParent()
  historyModalVisible.value = false
  if (plInit.initialized.value) {
    await _resolveTokenColors()
  }
}

async function onFavoriteCurrent() {
  const pos = posEditor.serializeEnabled()
  const neg = negEditor.serializeEnabled()
  if (!pos && !neg) {
    toast(t('prompt-library.history_modal.empty_prompt'), 'warning')
    return
  }
  const id = await lib.addHistory(pos, neg, true)
  if (id !== null) {
    toast(t('prompt-library.history_modal.favorited'), 'success')
  }
}

function onTagSelect(tag: PromptTag) {
  activeEditor.value.addToken(escapeBrackets(tag.text), 'tag', tag.color || undefined, tag.translate || undefined)
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
        <!-- Token Input (shared area — switches via v-show) -->
        <div v-for="tab in promptTabs" :key="tab.key" v-show="activeTab === tab.key" class="pe-token-area">
          <TokenInput
            :tokens="tab.key === 'positive' ? posEditor.tokens.value : negEditor.tokens.value"
            :show-translation="promptSettings.show_translation"
            :autocomplete-limit="promptSettings.autocomplete_limit"
            :translating-ids="translatingIds"
            :translate-all-busy="translate.translating.value"
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
            @favorite-current="onFavoriteCurrent"
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
    <PromptHistoryModal
      v-model="historyModalVisible"
      @apply="onHistoryApply"
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
</style>
