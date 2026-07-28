import { hasInjectionContext, inject, provide, reactive } from 'vue'

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
let _nextId = 0

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
 */
export function useToast(): ToastAPI {
  // Vue 3.5 的 inject 把默认值分支嵌在 `if (instance || currentApp)` 内部:
  // 无注入上下文时 (async 事件回调 / Pinia store setup / 函数体内惰性调用 composable)
  // inject 直接返回 undefined, 默认值被忽略 —— 仅靠 inject(key, fallback) 形同虚设,
  // 解构 toast 即抛 TypeError。必须先用 hasInjectionContext() 显式判上下文。
  return hasInjectionContext() ? inject<ToastAPI>(TOAST_KEY, _sharedApi) : _sharedApi
}
