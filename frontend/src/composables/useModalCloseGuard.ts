import { useConfirm } from '@/composables/useConfirm'

export interface ModalCloseGuardTexts {
  title: () => string
  message: () => string
  discard: () => string
  cancel: () => string
}

export function useModalCloseGuard(opts: {
  dirty: () => boolean
  saving?: () => boolean
  texts: ModalCloseGuardTexts
  onClose: () => void
}): (reason?: unknown) => Promise<void> {
  const { confirm } = useConfirm()

  return async function requestClose(): Promise<void> {
    if (opts.saving?.()) return
    if (opts.dirty()) {
      const r = await confirm({
        title: opts.texts.title(),
        message: opts.texts.message(),
        confirmText: opts.texts.discard(),
        cancelText: opts.texts.cancel(),
      })
      if (r !== true) return
    }
    opts.onClose()
  }
}