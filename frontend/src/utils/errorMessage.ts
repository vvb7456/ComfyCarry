/**
 * Safely extract a human-readable message from an unknown thrown value.
 * Handles Error instances, objects with a `message` property, and plain strings.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return String(e)
}