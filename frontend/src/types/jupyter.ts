// ── Jupyter Data Types ────────────────────────────────────────

export interface KernelSpecInfo {
  name: string
  display_name: string
}

export interface KernelInfo {
  id: string
  name: string
  state: string
  connections: number
}

export interface SessionInfo {
  id: string
  name?: string
  path: string
  type: string
  kernel_name?: string
  kernel_state?: string
}

export interface TerminalInfo {
  name: string
}

export interface JupyterStatus {
  online: boolean
  pm2_status: string
  version?: string
  pid?: number
  port: number
  cpu?: number
  memory?: number
  kernels_count: number
  sessions_count: number
  kernelspecs?: KernelSpecInfo[]
  default_kernel?: string
  kernels?: KernelInfo[]
  sessions?: SessionInfo[]
  terminals?: TerminalInfo[]
}
