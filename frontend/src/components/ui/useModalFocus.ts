import { onUnmounted } from 'vue'

/**
 * - 圈定只在键盘事件经过容器根时生效; 焦点在容器外的合法浮层
 *   (如 BaseSelect teleport 到 body 的下拉面板) 时不干预。
 * - 恢复焦点仅在触发器仍连接 (未卸载) 时执行, 否则不抢焦点。
 *   嵌套弹层各自独立记录/恢复: 内层关 → 回内层触发点 → ... → 回最初触发器。
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([disabled])',
].join(',')

function isFocusable(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

export function queryFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => {
      if (!isFocusable(el)) return false
      // tabindex="-1" 仅程序化聚焦, 不算键盘停靠点 (容器自身除外由调用方处理)
      return el.tabIndex >= 0
    })
}

export function useModalFocus() {
  let trigger: HTMLElement | null = null

  function captureTrigger(): HTMLElement | null {
    const active = document.activeElement
    trigger = active instanceof HTMLElement && active !== document.body ? active : null
    return trigger
  }

  function restoreTrigger(): void {
    if (trigger && trigger.isConnected) trigger.focus()
    trigger = null
  }

  function trapTab(e: KeyboardEvent, root: HTMLElement): void {
    if (e.key !== 'Tab') return
    const items = queryFocusable(root)
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || !root.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }

  onUnmounted(() => {
    trigger = null
  })

  return { captureTrigger, restoreTrigger, trapTab }
}