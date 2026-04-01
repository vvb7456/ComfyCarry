import { inject, provide, reactive } from 'vue'

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
 * Provide toast API from App.vue root.
 */
export function provideToast(): ToastAPI {
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

  const api: ToastAPI = { toast, items, remove }
  provide(TOAST_KEY, api)
  return api
}

/**
 * Inject toast API in any descendant component.
 */
export function useToast(): ToastAPI {
  const api = inject<ToastAPI>(TOAST_KEY)
  if (!api) {
    // Fallback for usage outside the provide tree (e.g. composables created early)
    return {
      toast: (msg, type = 'info') => { console.warn(`[toast:${type}] ${msg}`) },
      items: [],
      remove: () => {},
    }
  }
  return api
}
