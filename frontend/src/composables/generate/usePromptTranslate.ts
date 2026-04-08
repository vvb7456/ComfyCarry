/**
 * usePromptTranslate — Translation composable for prompt tokens.
 *
 * Two-tier strategy:
 *   1. Local DB lookup (fast, free, via /api/prompt-library/translate/word)
 *   2. Remote API fallback (via /api/prompt-library/translate)
 *
 * Provides:
 *   - Single word translation (local DB only)
 *   - Full text translation (local DB → remote API fallback)
 *   - Batch translate for all untranslated tokens
 */
import { ref, type Ref } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import type {
  TranslateResult,
  TranslateWordResult,
  PromptToken,
} from '@/types/prompt-library'

export interface UsePromptTranslateReturn {
  translating: Ref<boolean>

  translateWord(word: string): Promise<string>
  translateText(text: string, from?: string, to?: string, provider?: string): Promise<TranslateResult | null>
  translateTokens(tokens: PromptToken[], onUpdate: (id: string, translate: string) => void, provider?: string): Promise<void>
}

export function usePromptTranslate(): UsePromptTranslateReturn {
  const { get, post } = useApiFetch()
  const translating = ref(false)

  /**
   * Fast local DB lookup for a single tag.
   * Returns the translated string or empty string if not found.
   */
  async function translateWord(word: string): Promise<string> {
    if (!word.trim()) return ''
    const resp = await get<TranslateWordResult>(
      `/api/prompt-library/translate/word?word=${encodeURIComponent(word)}`,
    )
    return resp?.translate ?? ''
  }

  /**
   * Full translation: local DB first, then remote API fallback.
   */
  async function translateText(
    text: string,
    from = 'en',
    to = 'zh',
    provider?: string,
  ): Promise<TranslateResult | null> {
    if (!text.trim()) return null
    const body: Record<string, unknown> = { text, from, to }
    if (provider) body.provider = provider
    return post<TranslateResult>('/api/prompt-library/translate', body)
  }

  /**
   * Batch translate all tokens that don't have translations yet.
   * Calls onUpdate(id, translate) for each successfully translated token.
   * Uses local DB for each token first; falls back to remote API batch.
   */
  async function translateTokens(
    tokens: PromptToken[],
    onUpdate: (id: string, translate: string) => void,
    provider?: string,
  ): Promise<void> {
    const untranslated = tokens.filter(
      t => t.enabled && !t.translate && (t.type === 'tag' || t.type === 'raw'),
    )
    if (untranslated.length === 0) return

    translating.value = true
    try {
      // Phase 1: Try local DB for each token
      const needRemote: PromptToken[] = []

      for (const token of untranslated) {
        const tagBefore = token.tag
        const local = await translateWord(token.tag)
        // Staleness guard: tag may have changed during the async call
        if (token.tag !== tagBefore) continue
        if (local) {
          onUpdate(token.id, local)
        } else {
          needRemote.push(token)
        }
      }

      // Phase 2: Remote API for remaining tokens
      for (const token of needRemote) {
        const tagBefore = token.tag
        const result = await translateText(token.tag, 'en', 'zh', provider)
        if (token.tag !== tagBefore) continue
        if (result?.translate) {
          onUpdate(token.id, result.translate)
        }
      }
    } finally {
      translating.value = false
    }
  }

  return {
    translating,
    translateWord,
    translateText,
    translateTokens,
  }
}
