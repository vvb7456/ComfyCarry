import { FilePathError, normalizeFilePath } from './filePath'

/** 前端检查地址格式；实际访问范围由后端按当前实例的两个根目录判定。 */
export function localPathError(path: string): { key: string; params?: Record<string, unknown> } | null {
  try {
    const normalized = normalizeFilePath(path || '')
    if (normalized === '{workspace}' || normalized === '/') {
      return { key: 'path_is_root', params: { root: normalized } }
    }
  } catch (error) {
    if (error instanceof FilePathError) return { key: error.key, params: error.params }
    throw error
  }
  return null
}

/**
 * 拼接远程路径段, 语义对齐后端 `config.join_remote_path`:
 * 过滤空段后以 "/" 连接各段并去掉段首尾斜杠; 但**首段**若以 "/" 开头则保留
 * 前导斜杠 —— sftp 上 "remote:path" 是登录用户 home 相对、"remote:/path" 是
 * 服务器绝对, 去掉会改变用户选择的语义。
 *
 * 用于预设规则路径: joinRemotePath(bucket, 同步文件夹, 预设相对路径)。
 */
export function joinRemotePath(...parts: Array<string | undefined | null>): string {
  const clean = parts.map(p => (p ?? '').trim()).filter(Boolean)
  if (!clean.length) return ''
  const joined = clean.map(p => p.replace(/^\/+|\/+$/g, '')).join('/')
  return (clean[0] ?? '').startsWith('/') ? `/${joined}` : joined
}
