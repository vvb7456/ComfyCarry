// ── SSH Data Types ────────────────────────────────────────────

export interface SSHStatus {
  running: boolean
  pid: number | null
  port: number
  active_connections: number
  password_auth: boolean
  password_set: boolean
  /** SSH 密码跟随开关 (v2, spec §5.1); v1 的 pw_sync 已废弃 */
  pw_follow?: boolean
  /** 已配置的公钥数量 (跟随开关 lockout 防护的展示依据) */
  keys_count?: number
}

export interface SSHKey {
  fingerprint: string
  comment: string
  type: string
  source: string
}
