/** HTML/string safety utilities */

const _escMap: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

export function escHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => _escMap[c])
}

export function escAttr(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => _escMap[c])
}
