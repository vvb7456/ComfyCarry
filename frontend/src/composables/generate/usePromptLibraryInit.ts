/**
 * usePromptLibraryInit — Tag library initialization composable.
 *
 * Follows useModelDependency pattern:
 *   - Check → show gate or not
 *   - SSE-based download + import with real-time progress
 *   - Error detail with recovery hints
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import type { InitSourceStatus, ImportResult } from '@/types/prompt-library'

// ── Types ──────────────────────────────────────────────────────────────────

export interface InitProgress {
  phase: 'downloading' | 'importing' | 'done' | 'error'
  step: string
  done: number
  total: number
  percent: number
}

export interface UsePromptLibraryInitReturn {
  /** Raw status from backend */
  status: Ref<InitSourceStatus | null>
  /** Whether the init gate should be shown */
  show: Ref<boolean>
  /** Whether currently checking status */
  loading: Ref<boolean>
  /** Whether import/download is in progress */
  importing: Ref<boolean>
  /** Real-time progress info */
  progress: Ref<InitProgress | null>
  /** Error message */
  error: Ref<string>

  /** Library has data (groups + tags > 0) */
  initialized: ComputedRef<boolean>

  /** Check status and decide whether to show gate */
  checkStatus(): Promise<void>
  /** Start SSE-based import (download if needed) */
  startImport(): Promise<ImportResult | null>
  /** Cleanup active fetch */
  destroy(): void
}

// ── Composable ─────────────────────────────────────────────────────────────

export function usePromptLibraryInit(): UsePromptLibraryInitReturn {
  const { get } = useApiFetch()

  const status = ref<InitSourceStatus | null>(null)
  const show = ref(false)
  const loading = ref(false)
  const importing = ref(false)
  const progress = ref<InitProgress | null>(null)
  const error = ref('')

  const initialized = computed(() => status.value?.initialized ?? false)

  // ── Check ──────────────────────────────────────────────────────────────

  async function checkStatus(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const resp = await get<InitSourceStatus>('/api/prompt-library/init/status')
      if (resp) status.value = resp

      // Show gate if library not yet initialized
      show.value = !initialized.value
    } finally {
      loading.value = false
    }
  }

  // ── Import (SSE via fetch POST) ──────────────────────────────────────

  function startImport(): Promise<ImportResult | null> {
    if (importing.value) return Promise.resolve(null)
    importing.value = true
    error.value = ''
    progress.value = null

    return _runSSEImport()
  }

  async function _runSSEImport(): Promise<ImportResult | null> {
    let abortCtrl: AbortController | null = new AbortController()

    try {
      const resp = await fetch('/api/prompt-library/init', {
        method: 'POST',
        signal: abortCtrl.signal,
      })

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${resp.status}`)
      }

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let result: ImportResult | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))

            if (data.phase === 'downloading' || data.phase === 'importing') {
              progress.value = {
                phase: data.phase,
                step: data.step || '',
                done: data.done || 0,
                total: data.total || 0,
                percent: data.percent || 0,
              }
            } else if (data.phase === 'done') {
              result = data.result || null
            } else if (data.phase === 'error') {
              error.value = data.error || 'Import failed'
            }
          } catch { /* ignore parse errors */ }
        }
      }

      progress.value = null
      importing.value = false
      abortCtrl = null

      // Refresh status after completion
      await checkStatus()
      return result

    } catch (e: any) {
      if (e?.name === 'AbortError') return null
      progress.value = null
      importing.value = false
      error.value = e?.message || 'Import failed'
      return null
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  function destroy() {
    importing.value = false
    progress.value = null
  }

  return {
    status,
    show,
    loading,
    importing,
    progress,
    error,
    initialized,
    checkStatus,
    startImport,
    destroy,
  }
}
