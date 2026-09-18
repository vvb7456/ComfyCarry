/**
 * useModalCloseGuard — 设置弹窗统一的关闭守卫。
 *
 * 语义 (与 Tunnel/Sync 页内设置弹窗的既有行为一致):
 *   - saving 中: 关闭请求被直接拦截 (按钮/遮罩/Esc 均无效);
 *   - dirty 时: 弹「放弃更改 / 取消」confirm, 确认放弃才真正关闭;
 *   - 非 dirty: 直接关闭。
 *
 * 用法 (弹窗组件内三行接线):
 *   const requestClose = useModalCloseGuard({
 *     dirty: () => formDirty.value,
 *     saving: () => saving.value,
 *     texts: {
 *       title: () => t('xx.confirm.discard.title'),
 *       message: () => t('xx.confirm.discard.message'),
 *       discard: () => t('xx.confirm.discard.button'),
 *       cancel: () => t('common.btn.cancel'),
 *     },
 *     onClose: () => emit('update:modelValue', false),
 *   })
 *   <BaseModal ... @update:model-value="requestClose()">
 */
import { useConfirm } from '@/composables/useConfirm'

export interface ModalCloseGuardTexts {
  title: () => string
  message: () => string
  /** 放弃更改按钮文本 */
  discard: () => string
  /** 取消按钮文本 */
  cancel: () => string
}

export function useModalCloseGuard(opts: {
  dirty: () => boolean
  /** 保存进行中: 关闭请求被拦截 (缺省 false) */
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