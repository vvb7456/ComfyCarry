import { ref } from 'vue'
import { useToast } from './useToast'
import { apiErrorText } from '@/utils/apiError'

let _redirecting = false
export function redirectToLogin() {
  if (_redirecting) return
  _redirecting = true
  window.location.href = '/login'
}

export interface FetchCallOptions {
  /**
   * 失败时不弹全局错误 toast (仍写入 error 状态并返回 null)。
   *
   * 供轮询 / 自动刷新使用: 后端持续报错时, 非静默请求会每 3–15s 弹一条同样的
   * 错误, 把 toast 刷屏。用户主动发起的动作一律保持非静默。
   */
  silent?: boolean
}

/**
 * Unified HTTP client composable.
 * Wraps fetch with loading/error state, JSON parsing, and toast on error.
 */
export function useApiFetch() {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const { toast } = useToast()

  async function request<T = unknown>(
    url: string,
    opts: RequestInit = {},
    call: FetchCallOptions = {},
  ): Promise<T | null> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...opts.headers as Record<string, string> },
        ...opts,
      })
      if (!res.ok) {
        // 401: session expired — redirect to login
        if (res.status === 401) {
          redirectToLogin()
          return null
        }
        let msg = `HTTP ${res.status}`
        try {
          // error_key 优先 —— 已接 i18n 的端点回传 key+params, 其余回传原文
          msg = apiErrorText(await res.json(), msg)
        } catch { /* ignore parse error */ }
        error.value = msg
        if (!call.silent) toast(msg, 'error')
        return null
      }
      // Handle 204 No Content
      if (res.status === 204) return null
      return await res.json() as T
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      error.value = msg
      if (!call.silent) toast(msg, 'error')
      return null
    } finally {
      loading.value = false
    }
  }

  async function get<T = unknown>(url: string, call: FetchCallOptions = {}): Promise<T | null> {
    return request<T>(url, { method: 'GET' }, call)
  }

  async function post<T = unknown>(
    url: string,
    body?: Record<string, unknown> | unknown[],
    call: FetchCallOptions = {},
  ): Promise<T | null> {
    return request<T>(url, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, call)
  }

  async function put<T = unknown>(
    url: string,
    body?: Record<string, unknown> | unknown[],
    call: FetchCallOptions = {},
  ): Promise<T | null> {
    return request<T>(url, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, call)
  }

  async function del<T = unknown>(
    url: string,
    body?: Record<string, unknown>,
    call: FetchCallOptions = {},
  ): Promise<T | null> {
    return request<T>(url, {
      method: 'DELETE',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, call)
  }

  /** Raw fetch without JSON parsing (for file uploads, etc.) */
  async function raw(url: string, opts: RequestInit = {}, call: FetchCallOptions = {}): Promise<Response | null> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(url, opts)
      if (!res.ok) {
        if (res.status === 401) {
          redirectToLogin()
          return null
        }
        let msg = `HTTP ${res.status}`
        try {
          msg = apiErrorText(await res.json(), msg)
        } catch { /* ignore */ }
        error.value = msg
        if (!call.silent) toast(msg, 'error')
        return null
      }
      return res
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      error.value = msg
      if (!call.silent) toast(msg, 'error')
      return null
    } finally {
      loading.value = false
    }
  }

  return { loading, error, get, post, put, del, raw }
}
