export class FilePathError extends Error {
  constructor(public key: string, public params?: Record<string, unknown>) {
    super(key)
  }
}

/** 与后端 normalize_file_path 一致；不解析环境变量，也不改写根目录语义。 */
export function normalizeFilePath(path: string): string {
  const raw = path.trim()
  if (!raw) throw new FilePathError('path_required')
  if (raw.includes('\0')) throw new FilePathError('path_invalid')
  const marker = ['{workspace}', '{ComfyUI}'].find(root => raw === root || raw.startsWith(root + '/'))
  if (!marker && !raw.startsWith('/')) throw new FilePathError('path_invalid')
  const parts: string[] = []
  for (const part of raw.slice(marker?.length ?? 0).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length && marker) throw new FilePathError('path_outside', { root: marker })
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return marker ? marker + (parts.length ? '/' + parts.join('/') : '') : '/' + parts.join('/')
}

export function joinFilePath(directory: string, name: string): string {
  if (name.startsWith('/') || name.split('/').includes('..')) throw new FilePathError('path_invalid')
  return normalizeFilePath(`${directory}/${name}`)
}
