import { inject } from 'vue'
import type { InjectionKey } from 'vue'

export interface ConfirmOptions {
  title?: string
  message: string
  variant?: 'default' | 'danger'
  confirmText?: string
  cancelText?: string
  /** Optional third button text. When clicked, confirm() resolves with 'alt' instead of true. */
  altText?: string
  /** Variant for the alt button (default: 'default'). */
  altVariant?: 'default' | 'primary' | 'danger' | 'success'
  /** When set, show a "Don't ask again" checkbox. Value is the localStorage key. */
  dontAskKey?: string
}

export type ConfirmResult = boolean | 'alt'
export type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult>

export const confirmKey: InjectionKey<ConfirmFn> = Symbol('confirm')

export function useConfirm() {
  const confirm = inject(confirmKey)
  if (!confirm) throw new Error('useConfirm() requires <ConfirmProvider> in ancestor')
  return { confirm }
}
