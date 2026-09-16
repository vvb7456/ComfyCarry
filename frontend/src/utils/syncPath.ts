/**
 * 同步规则 local_path 的前端预检。
 *
 * 与后端 `resolve_workspace_path(allow_root=False)` 保持同一套 workspace
 * 根相对语义: 前导 "/" 即 workspace 根, "." 忽略, ".." 向上折叠; 折叠到根
 * 之上即越界, 折到根本身则拒绝。两边必须一致, 否则会出现「前端放行、后端
 * 拒绝」——向导里这类规则会在部署时被静默跳过。
 *
 * 返回短 key (调用方用 `sync.err.<key>` 翻译) 与可选插值, 合法返回 null。
 */
export function localPathError(path: string): { key: string; params?: Record<string, unknown> } | null {
  const raw = (path || '').trim()
  if (!raw) return { key: 'path_required' }

  const segments: string[] = []
  for (const part of raw.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      // 越过 workspace 根 —— 后端会 normpath 到工作区之外并拒绝
      if (!segments.length) return { key: 'path_outside', params: { root: '/' } }
      segments.pop()
      continue
    }
    segments.push(part)
  }
  if (!segments.length) return { key: 'path_is_root', params: { root: '/' } }
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
  return clean[0].startsWith('/') ? `/${joined}` : joined
}
