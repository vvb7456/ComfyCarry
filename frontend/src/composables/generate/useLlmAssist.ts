/**
 * useLlmAssist — AI prompt generation composable (LLM Assist).
 *
 * Two modes:
 *   - text: user describes a scene → LLM generates positive/negative prompts
 *   - image: user provides an image → LLM vision interrogation
 *
 * Supports SSE streaming and JSON fallback.
 * Legacy: generate-llm.js
 */
import { ref, type Ref } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

export interface LlmResult {
  positive: string
  negative?: string
}

export interface UseLlmAssistReturn {
  visible: Ref<boolean>
  configured: Ref<boolean>
  visionSupported: Ref<boolean>
  mode: Ref<'text' | 'image'>
  streaming: Ref<boolean>
  running: Ref<boolean>
  result: Ref<LlmResult | null>
  streamText: Ref<string>
  modelName: Ref<string>
  imageFile: Ref<File | null>
  imageFileName: Ref<string>
  inputImageName: Ref<string>

  open(): Promise<void>
  submit(input: string): Promise<void>
  abort(): void
  applyResult(target: 'positive' | 'all' | 'copy'): { positive: string; negative?: string } | null
  close(): void
  setMode(m: 'text' | 'image'): void
  setLocalFile(file: File): void
  setInputImage(name: string): void
  clearImage(): void
}

export function useLlmAssist(): UseLlmAssistReturn {
  const { get } = useApiFetch()
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  const visible = ref(false)
  const configured = ref(false)
  const visionSupported = ref(false)
  const mode = ref<'text' | 'image'>('text')
  const streaming = ref(false)
  const running = ref(false)
  const result = ref<LlmResult | null>(null)
  const streamText = ref('')
  const modelName = ref('')
  const imageFile = ref<File | null>(null)
  const imageFileName = ref('')
  const inputImageName = ref('')

  let abortController: AbortController | null = null

  // ── Open: check config + vision capability ────────────────────────────

  async function open() {
    // Keep previous result across open/close cycles
    running.value = false

    try {
      const resp = await get<{
        data?: {
          provider?: string
          api_key?: string
          model?: string
          stream?: boolean
        }
      }>('/api/llm/config')
      const cfg = resp?.data

      if (cfg?.provider && cfg?.api_key && cfg.api_key !== '****') {
        configured.value = true
        streaming.value = !!cfg.stream
        modelName.value = cfg.model || ''
      } else {
        configured.value = false
      }

      // Check vision support
      visionSupported.value = false
      if (configured.value && cfg?.provider) {
        try {
          const prov = await get<{
            providers?: Array<{ id: string; supports_vision?: boolean }>
          }>('/api/llm/providers')
          const p = prov?.providers?.find(x => x.id === cfg.provider)
          visionSupported.value = !!p?.supports_vision
        } catch {
          visionSupported.value = false
        }
      }
    } catch {
      configured.value = false
    }

    // If current mode is image but vision not supported, switch back
    if (mode.value === 'image' && !visionSupported.value) {
      mode.value = 'text'
    }

    visible.value = true
  }

  // ── Submit: text or image mode ────────────────────────────────────────

  async function submit(textInput: string) {
    if (running.value) return

    let body: Record<string, unknown>

    if (mode.value === 'text') {
      if (!textInput.trim()) {
        toast(t('generate.llm_modal.empty_input'), 'warning')
        return
      }
      body = { input: textInput, target: 'sdxl', stream: streaming.value }
    } else {
      // Image mode
      const file = imageFile.value
      const name = inputImageName.value
      if (!file && !name) {
        toast(t('generate.llm_modal.need_image'), 'warning')
        return
      }
      let base64: string | undefined
      if (file) {
        base64 = await fileToBase64(file)
      } else if (name) {
        // Fetch the image from server and convert
        try {
          const resp = await fetch(`/api/generate/input_image_preview?name=${encodeURIComponent(name)}`)
          const blob = await resp.blob()
          base64 = await blobToBase64(blob)
        } catch {
          toast(t('generate.llm_modal.image_load_failed'), 'error')
          return
        }
      }
      body = { image: base64, target: 'sdxl', stream: streaming.value }
    }

    running.value = true
    result.value = null
    streamText.value = ''

    try {
      if (streaming.value) {
        await submitSSE(body)
      } else {
        await submitJSON(body)
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toast(t('generate.llm_modal.error'), 'error')
      }
    }

    running.value = false
  }

  async function submitJSON(body: Record<string, unknown>) {
    const resp = await fetch('/api/llm/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (resp.ok) {
      const data = await resp.json()
      if (data?.data) {
        result.value = data.data
      } else if (data?.positive) {
        result.value = data
      }
    } else {
      toast(t('generate.llm_modal.failed'), 'error')
    }
  }

  async function submitSSE(body: Record<string, unknown>) {
    abortController = new AbortController()

    const resp = await fetch('/api/llm/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortController.signal,
    })

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      const lines = buf.split('\n')
      buf = lines.pop()!
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6)
        if (payload === '[DONE]') continue
        try {
          const evt = JSON.parse(payload)
          if (evt.type === 'chunk') {
            streamText.value += evt.content
          } else if (evt.type === 'result') {
            result.value = evt.data
          } else if (evt.type === 'error') {
            toast(evt.message || t('generate.llm_modal.failed'), 'error')
          }
        } catch { /* ignore parse error */ }
      }
    }

    abortController = null
  }

  // ── Abort ─────────────────────────────────────────────────────────────

  function abort() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    running.value = false
  }

  // ── Apply result ──────────────────────────────────────────────────────

  function applyResult(target: 'positive' | 'all' | 'copy'): { positive: string; negative?: string } | null {
    if (!result.value) return null

    if (target === 'copy') {
      let text = result.value.positive
      if (result.value.negative) text += '\n\n[Negative]\n' + result.value.negative
      navigator.clipboard.writeText(text).then(
        () => toast(t('common.clipboard_copied'), 'success'),
        () => { /* clipboard failed */ },
      )
      return null
    }

    return {
      positive: result.value.positive,
      negative: target === 'all' ? result.value.negative : undefined,
    }
  }

  // ── Close ─────────────────────────────────────────────────────────────

  function close() {
    abort()
    visible.value = false
  }

  // ── Mode / Image helpers ──────────────────────────────────────────────

  function setMode(m: 'text' | 'image') {
    if (m === 'image' && !visionSupported.value) return
    mode.value = m
  }

  function setLocalFile(file: File) {
    imageFile.value = file
    imageFileName.value = file.name
    inputImageName.value = ''
  }

  function setInputImage(name: string) {
    inputImageName.value = name
    imageFile.value = null
    imageFileName.value = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  }

  function clearImage() {
    imageFile.value = null
    imageFileName.value = ''
    inputImageName.value = ''
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  return {
    visible,
    configured,
    visionSupported,
    mode,
    streaming,
    running,
    result,
    streamText,
    modelName,
    imageFile,
    imageFileName,
    inputImageName,
    open,
    submit,
    abort,
    applyResult,
    close,
    setMode,
    setLocalFile,
    setInputImage,
    clearImage,
  }
}
