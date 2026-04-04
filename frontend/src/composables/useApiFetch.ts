import { ref } from 'vue'
import { useToast } from './useToast'

let _redirecting = false
function redirectToLogin() {
  if (_redirecting) return
  _redirecting = true
  window.location.href = '/login'
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
          const body = await res.json()
          msg = body.error || body.message || msg
        } catch { /* ignore parse error */ }
        error.value = msg
        toast(msg, 'error')
        return null
      }
      // Handle 204 No Content
      if (res.status === 204) return null
      return await res.json() as T
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      error.value = msg
      toast(msg, 'error')
      return null
    } finally {
      loading.value = false
    }
  }

  async function get<T = unknown>(url: string): Promise<T | null> {
    return request<T>(url, { method: 'GET' })
  }

  async function post<T = unknown>(url: string, body?: Record<string, unknown> | unknown[]): Promise<T | null> {
    return request<T>(url, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  async function put<T = unknown>(url: string, body?: Record<string, unknown> | unknown[]): Promise<T | null> {
    return request<T>(url, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  async function del<T = unknown>(url: string, body?: Record<string, unknown>): Promise<T | null> {
    return request<T>(url, {
      method: 'DELETE',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  /** Raw fetch without JSON parsing (for file uploads, etc.) */
  async function raw(url: string, opts: RequestInit = {}): Promise<Response | null> {
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
          const body = await res.json()
          msg = body.error || body.message || msg
        } catch { /* ignore */ }
        error.value = msg
        toast(msg, 'error')
        return null
      }
      return res
    } catch (e: any) {
      const msg = e?.message || 'Network error'
      error.value = msg
      toast(msg, 'error')
      return null
    } finally {
      loading.value = false
    }
  }

  return { loading, error, get, post, put, del, raw }
}
