/**
 * useProductTour — 「内容生成」页产品导览的轻量状态。
 *
 * 语义：只要 start 过（无论走完、跳过、中途切页），localStorage 已写入标记,
 * 之后不再自动触发；手动入口（顶栏 help_outline 按钮）随时可用。
 *
 * localStorage 用法对齐仓库先例（stores/app.ts 的 sidebar_collapsed:
 * '1'/'0' 字符串标记, 读一次判断即可, 不持续监听）。
 */
import { ref, type Ref } from 'vue'

export function useProductTour(storageKey: string) {
  // 读一次即可：isDone 不做持续监听（规范 §3.2），标记一旦写入本会话即视为已读
  const isDone: Ref<boolean> = ref(localStorage.getItem(storageKey) === '1')
  const active: Ref<boolean> = ref(false)

  /** 手动/自动入口：进入导览并写入"已看过"标记 */
  function start() {
    localStorage.setItem(storageKey, '1')
    isDone.value = true
    active.value = true
  }

  /** 中断（切页 KeepAlive deactivate 等）：标记已由 start 写入, 这里只关开关 */
  function stop() {
    active.value = false
  }

  return { active, isDone, start, stop }
}