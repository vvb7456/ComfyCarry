// useClipboard - unified clipboard helper.
//
// Why this exists:
//   `navigator.clipboard.writeText` only works in a "secure context"
//   (HTTPS or localhost). On LAN/dev installations served over plain
//   HTTP (e.g. http://10.0.0.22), the Promise rejects and most call
//   sites used to swallow the error silently — users clicked Copy and
//   nothing happened. This composable layers an `execCommand('copy')`
//   fallback for insecure contexts and centralises toast feedback so
//   every Copy button behaves identically.
//
// Usage:
//   const { copy } = useClipboard()
//   await copy(value)                    // toasts default success/failure
//   await copy(value, { silent: true })  // no toast (caller manages UI)
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

export interface CopyOptions {
  /** Suppress success/failure toasts (caller will provide its own UI). */
  silent?: boolean
  /** Override the success toast message. */
  successMessage?: string
  /** Override the failure toast message. */
  failureMessage?: string
}

async function tryNativeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy path
  }
  return false
}

function tryLegacyExecCommand(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    // Visually hide but keep selectable.
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.width = '1px'
    ta.style.height = '1px'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function useClipboard() {
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  async function copy(text: string, options: CopyOptions = {}): Promise<boolean> {
    if (!text) {
      if (!options.silent) {
        toast(t('common.clipboard_empty'), 'warning')
      }
      return false
    }
    const ok = (await tryNativeClipboard(text)) || tryLegacyExecCommand(text)
    if (!options.silent) {
      toast(
        ok ? (options.successMessage ?? t('common.clipboard_copied')) : (options.failureMessage ?? t('common.clipboard_failed')),
        ok ? 'success' : 'error',
      )
    }
    return ok
  }

  return { copy }
}
