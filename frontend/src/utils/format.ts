const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function fmtBytes(b: number): string {
  if (!b && b !== 0) return '—'
  if (b < 1024) return b + ' B'
  // clamp: 网盘容量可以到 TB/PB, 而下标越界会输出 "1234.5 undefined"
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), BYTE_UNITS.length - 1)
  return (b / 1024 ** i).toFixed(i >= 3 ? 2 : 1) + ' ' + BYTE_UNITS[i]
}

export function fmtSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return ''
  if (bytesPerSec >= 1073741824) return (bytesPerSec / 1073741824).toFixed(1) + ' GB/s'
  if (bytesPerSec >= 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s'
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s'
  return bytesPerSec + ' B/s'
}

/**
 * 紧凑数字格式 — 卡片 meta 行等空间敏感场景。
 * GitHub/Civitai 同款国际符号, 中英文用户均可理解, 无需 i18n:
 *   1234567 → "1.2M", 56780 → "56.8k", ≤999 原样返回 (toLocaleString)。
 * 完整千分位数字仍走 toLocaleString (详情弹窗等宽裕场景)。
 */
export function fmtCompact(v: number): string {
  if (v == null || isNaN(v)) return '0'
  const n = Math.floor(v)
  if (n < 1000) return n.toLocaleString()
  if (n < 1_000_000) {
    // 56780 → "56.8k"; 1000 → "1k" (不为 1.0k); 999950+ 进位至 1M
    const k = n / 1000
    const r = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10
    if (r >= 1000) return '1M'
    return r + 'k'
  }
  if (n < 1_000_000_000) {
    const m = n / 1_000_000
    const r = m >= 100 ? Math.round(m) : Math.round(m * 10) / 10
    if (r >= 1000) return '1B'
    return r + 'M'
  }
  const b = n / 1_000_000_000
  const r = b >= 100 ? Math.round(b) : Math.round(b * 10) / 10
  return r + 'B'
}

export function fmtPct(v: number | null | undefined): string {
  return v != null ? v.toFixed(1) + '%' : '—'
}

export function fmtUptime(sec: number): string {
  if (!sec && sec !== 0) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function fmtDuration(ms: number): string {
  if (!ms && ms !== 0) return '—'
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
