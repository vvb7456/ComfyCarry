export function localModelPreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return null
}
