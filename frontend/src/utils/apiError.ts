/**
 * 后端错误/消息体 → 可显示文本。
 *
 * 契约 (与 sync 日志的 key+params 同一套): 已接 i18n 的端点回传
 * `error_key` + `error_params`, 由前端翻译; 未接的模块继续回传 `error`
 * 原文, 这里原样透出 —— 所以这个函数对两种后端都安全, 后端可以逐模块迁移。
 *
 * 缺 locale 条目时返回 key 本身: vue-i18n 的默认行为也是如此, 开发期一眼
 * 能看出漏了条目, 比静默显示英文 key 之外的兜底文案更容易发现。
 */
import i18n from '@/i18n/vue-i18n'

export interface ApiErrorBody {
  error_key?: string
  error_params?: Record<string, unknown>
  error?: string
  message_key?: string
  message_params?: Record<string, unknown>
  message?: string
  /** 「成功但有话说」的第三条通道 (如版本已切换但 PM2 重启失败) */
  warning_key?: string
  warning_params?: Record<string, unknown>
  warning?: string
}

function translate(key: string, params?: Record<string, unknown>): string {
  const g = i18n.global as unknown as {
    t: (k: string, p?: Record<string, unknown>) => string
    te: (k: string) => boolean
  }
  return g.te(key) ? g.t(key, params || {}) : key
}

/** 错误文本。body 为 null (HTTP 层已失败并 toast 过) 时返回 fallback。 */
export function apiErrorText(body: ApiErrorBody | null | undefined, fallback = ''): string {
  if (!body) return fallback
  if (body.error_key) return translate(body.error_key, body.error_params)
  return body.error || body.message || fallback
}

/** 成功消息文本。没有 message_key / message 时返回 fallback。 */
export function apiMessageText(body: ApiErrorBody | null | undefined, fallback = ''): string {
  if (!body) return fallback
  if (body.message_key) return translate(body.message_key, body.message_params)
  return body.message || fallback
}

/** 警告文本。没有 warning_key / warning 时返回 fallback (默认空串, 可直接当条件用)。 */
export function apiWarningText(body: ApiErrorBody | null | undefined, fallback = ''): string {
  if (!body) return fallback
  if (body.warning_key) return translate(body.warning_key, body.warning_params)
  return body.warning || fallback
}
