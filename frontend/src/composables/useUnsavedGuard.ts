import { onBeforeRouteLeave } from 'vue-router'
import { onBeforeUnmount, watch, type Ref } from 'vue'
import { useConfirm } from '@/composables/useConfirm'

export interface UnsavedGuardTexts {
  title: string
  message: string
  /** 保存按钮文本 (如"保存" / "保存并重启") */
  confirmSave: string
  /** 放弃更改按钮文本 */
  confirmDiscard: string
  /** 取消(留在本页)按钮文本 */
  cancel: string
}

/**
 * useUnsavedGuard — 表单未保存守卫 (banner 配套逻辑)。
 *
 * 三条防线 (对照前端最佳实践):
 *  1. tab 切换: guardTabSwitch() 在 activeTab 赋值前调用, 返回 false 拦截
 *  2. 路由离开: guardRouteLeave() 注册 onBeforeRouteLeave
 *  3. 浏览器关闭/刷新: beforeunload 事件 (dirty 时自动注册/卸载)
 *
 * dirty 必须是响应式 (Ref<boolean>), 不能是普通变量 —— computed 才能追踪变化。
 * dirty 应为纯表单状态 (表单值 ≠ 快照), 不应耦合 activeTab 等上下文。
 *
 * 用法:
 *   const guard = useUnsavedGuard({
 *     isDirty, saveAction, discardAction, texts,
 *   })
 *   async function onTabChange(next: string) {
 *     if (!(await guard.guardTabSwitch())) return
 *     activeTab.value = next
 *   }
 *   guard.guardRouteLeave()
 */
export function useUnsavedGuard(opts: {
  isDirty: Ref<boolean> | (() => boolean)
  /** 返回 true = 保存成功, 可放行 */
  saveAction: () => Promise<boolean>
  discardAction: () => Promise<void>
  texts: () => UnsavedGuardTexts
}) {
  const { confirm } = useConfirm()

  // 统一 dirty 读取: 支持 Ref<boolean> 或 () => boolean
  const isDirtyRef = typeof opts.isDirty === 'object' && 'value' in opts.isDirty
    ? opts.isDirty as Ref<boolean>
    : undefined
  const isDirtyFn = isDirtyRef ? () => isDirtyRef.value : opts.isDirty as () => boolean

  async function guardLeave(): Promise<boolean> {
    if (!isDirtyFn()) return true
    const texts = opts.texts()
    const result = await confirm({
      title: texts.title,
      message: texts.message,
      variant: 'danger',
      confirmText: texts.confirmSave,
      altText: texts.confirmDiscard,
      altVariant: 'danger',
      cancelText: texts.cancel,
    })
    if (result === true) {
      if (!await opts.saveAction()) return false
      return true
    }
    if (result === 'alt') {
      await opts.discardAction()
      return true
    }
    return false
  }

  /** tab 切换守卫: 放行返回 true */
  function guardTabSwitch(): Promise<boolean> {
    return guardLeave()
  }

  /** 路由离开守卫 (onBeforeRouteLeave), 需在 setup 中调用 */
  function guardRouteLeave() {
    onBeforeRouteLeave(() => guardLeave())
  }

  // ── beforeunload: 浏览器关闭/刷新拦截 (第三条防线) ──────────────────
  // MDN 最佳实践: 只在 dirty 时注册监听, 不 dirty 时移除, 避免性能影响。
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (!isDirtyFn()) return
    e.preventDefault()
    e.returnValue = ''
  }

  if (isDirtyRef) {
    // 响应式 dirty: watch 自动注册/移除监听
    watch(isDirtyRef, (dirty) => {
      if (dirty) window.addEventListener('beforeunload', onBeforeUnload)
      else window.removeEventListener('beforeunload', onBeforeUnload)
    }, { immediate: true })
  } else {
    // 函数式 dirty: 保守注册 (无法自动跟随变化, 适合 dirty 始终不变的简单场景)
    window.addEventListener('beforeunload', onBeforeUnload)
  }

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforeUnload)
  })

  /** banner 保存按钮: 直接执行保存 (不弹守卫确认) */
  function save(): Promise<boolean> {
    return opts.saveAction()
  }

  /** banner 放弃按钮: 重置表单 */
  function discard(): Promise<void> {
    return opts.discardAction()
  }

  return { guardTabSwitch, guardRouteLeave, save, discard }
}