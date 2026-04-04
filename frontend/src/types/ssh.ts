// ── SSH Data Types ────────────────────────────────────────────

export interface SSHStatus {
  running: boolean
  pid: number | null
  port: number
  active_connections: number
  password_auth: boolean
  password_set: boolean
  pw_sync: boolean
}

export interface SSHKey {
  fingerprint: string
  comment: string
  type: string
  source: string
}
