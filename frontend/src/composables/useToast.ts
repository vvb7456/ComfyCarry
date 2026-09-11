import { getCurrentInstance, hasInjectionContext, inject, provide, reactive } from 'vue'

export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  duration: number
}

export interface ToastAPI {
  toast: (message: string, type?: ToastItem['type'], duration?: number) => void
  items: ToastItem[]
  remove: (id: number) => void
}

const TOAST_KEY = Symbol('toast')
const TOAST_SCOPE_KEY = Symbol('toastScope')
let _nextId = 0

/**
 * 被静音的作用域集合。
 *
 * 页面 (目前只有被 KeepAlive 常驻的生成页) 在失活时静音自己的作用域, 于是该子树
 * 内所有 toast 调用点 (含嵌套 composable) 自动静音 —— 不需要逐个调用点加
 * `if (visible)` 判断, 也不会漏掉将来新增的调用点。运行/善后逻辑一概不受影响。
 *
 * 只静音"过程性"提示 (success / info / warning); **error 一律放行** ——
 * 静默失败比多一条提示更糟 (例如 live 模式在隐藏状态下续跑提交失败会静默停住)。
 */
const _mutedScopes = new Set<string>()

/**
 * 组件实例 → 作用域 (仅用于"本组件 setup 自己"的解析)。
 *
 * 本组件 setup 里 provide 的值, 本组件自己 inject 不到: Vue 的 inject 只查
 * `instance.parent.provides` (见 @vue/runtime-core inject 实现), 不查自身 provides,
 * 所以 provide() 对"自身 setup 及其直接调用的 composable"不可见。
 *
 * 这对本设计是致命的: 生成页的提示有相当一部分来自页面自身 setup 的调用链 ——
 * useGenerateSubmit 的「已加入队列」(live 模式切走后自动续跑提交时会弹到别的页)、
 * useGeneratePreview 的 no_output、页面自身的 useApiFetch 错误等。只靠 inject 的话
 * 这些提示在页面失活后照样弹出。
 *
 * 故 provide 时按实例额外记一份: 同一实例的 setup 调用链用实例查, 子组件仍走 inject。
 */
const _instanceScopes = new WeakMap<object, string>()

/**
 * 在页面 setup 中声明"本子树属于某个 toast 作用域"。
 * 必须在同 setup 内任何 useToast() 之前调用。
 */
export function provideToastScope(name: string): void {
  provide(TOAST_SCOPE_KEY, name)
  const inst = getCurrentInstance()
  if (inst) _instanceScopes.set(inst, name)
}

/** 静音 / 解除静音某个作用域 (页面失活 / 重新激活时调用)。 */
export function muteToastScope(name: string): void { _mutedScopes.add(name) }
export function unmuteToastScope(name: string): void { _mutedScopes.delete(name) }

/**
 * 模块级单例。
 *
 * 原先 API 只存在于 App.vue 的组件级 provide 里, 而 **Pinia store 的 setup
 * 脱离组件实例运行, inject 只能解析 app 级注入**, 拿不到组件级 provide ——
 * 于是所有 store (downloads / generate ...) 里的 toast 全部静默走 fallback
 * 分支, 只在 console 打一行 `[toast:error] ...`, 页面上什么都不显示。
 *
 * toast 本来就是全局单例, 没有按组件树分实例的必要, 故直接提到模块级。
 * provide 仍保留 —— ToastContainer 与既有组件的注入路径不变。
 */
function createToastApi(): ToastAPI {
  const items = reactive<ToastItem[]>([])

  function toast(message: string, type: ToastItem['type'] = 'info', duration = 3000) {
    const id = ++_nextId
    items.push({ id, message, type, duration })
    if (duration > 0) {
      setTimeout(() => remove(id), duration)
    }
  }

  function remove(id: number) {
    const idx = items.findIndex(t => t.id === id)
    if (idx !== -1) items.splice(idx, 1)
  }

  return { toast, items, remove }
}

const _sharedApi: ToastAPI = createToastApi()

/**
 * Provide toast API from App.vue root.
 */
export function provideToast(): ToastAPI {
  provide(TOAST_KEY, _sharedApi)
  return _sharedApi
}

/**
 * Inject toast API in any descendant component.
 *
 * 作用域: 若所在子树 provide 了 toast 作用域 (provideToastScope), 返回的 API 会
 * 在该作用域被静音时丢弃提示; 否则行为与原先完全一致 (直接返回共享 API)。
 */
export function useToast(): ToastAPI {
  // Vue 3.5 的 inject 把默认值分支嵌在 `if (instance || currentApp)` 内部:
  // 无注入上下文时 (async 事件回调 / Pinia store setup / 函数体内惰性调用 composable)
  // inject 直接返回 undefined, 默认值被忽略 —— 仅靠 inject(key, fallback) 形同虚设,
  // 解构 toast 即抛 TypeError。必须先用 hasInjectionContext() 显式判上下文。
  if (!hasInjectionContext()) return _sharedApi
  const api = inject<ToastAPI>(TOAST_KEY, _sharedApi)
  // 先走注入链 (子组件命中祖先 provide), 再兜底查本实例自身 provide 的作用域
  const inst = getCurrentInstance()
  const scope = inject<string | null>(TOAST_SCOPE_KEY, null)
    ?? (inst ? _instanceScopes.get(inst) ?? null : null)
  if (!scope) return api
  return {
    items: api.items,
    remove: api.remove,
    toast(message, type, duration) {
      const kind = type ?? 'info'
      // error 放行: 页面虽然不可见, 但失败必须让用户知道
      if (kind !== 'error' && _mutedScopes.has(scope)) return
      api.toast(message, kind, duration)
    },
  }
}
