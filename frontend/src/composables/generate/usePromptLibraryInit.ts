import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { apiErrorText } from '@/utils/apiError'
import { errorMessage } from '@/utils/errorMessage'
import type { InitSourceStatus, ImportResult } from '@/types/prompt-library'

export interface InitProgress {
  phase: 'downloading' | 'importing' | 'done' | 'error'
  step: string
  done: number
  total: number
  percent: number
}

export interface UsePromptLibraryInitReturn {
  status: Ref<InitSourceStatus | null>
  show: Ref<boolean>
  loading: Ref<boolean>
  importing: Ref<boolean>
  progress: Ref<InitProgress | null>
  error: Ref<string>

  initialized: ComputedRef<boolean>

  checkStatus(): Promise<void>
  startImport(): Promise<ImportResult | null>
  destroy(): void
}

export function usePromptLibraryInit(): UsePromptLibraryInitReturn {
  const { get } = useApiFetch()

  const status = ref<InitSourceStatus | null>(null)
  const show = ref(false)
  const loading = ref(false)
  const importing = ref(false)
  const progress = ref<InitProgress | null>(null)
  const error = ref('')

  const initialized = computed(() => status.value?.initialized ?? false)

  async function checkStatus(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const resp = await get<InitSourceStatus>('/api/prompt-library/init/status')
      if (resp) status.value = resp

      show.value = !initialized.value
    } finally {
      loading.value = false
    }
  }

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
        throw new Error(apiErrorText(errData, `HTTP ${resp.status}`))
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

      await checkStatus()
      return result

    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
      progress.value = null
      importing.value = false
      error.value = errorMessage(e) || 'Import failed'
      return null
    }
  }

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
