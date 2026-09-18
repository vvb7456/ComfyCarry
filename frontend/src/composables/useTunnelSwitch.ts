/**
 * useTunnelSwitch — 隧道蓝绿切换的前端编排 (切换即刷新)。
 *
 * 单例语义: 状态放在模块级, 同一时刻只允许一个切换。流程:
 *   1. startSwitch 前判定当前是否隧道地址访问 (直连则只等终态原地刷新);
 *   2. POST /api/tunnel/switch, 非 202 抛 TunnelSwitchError 交调用方渲染;
 *   3. 202 后冻结所有出站 fetch (window.fetch 置换为永远 pending), useAutoRefresh
 *      的 tick 读全局冻结标志直接 return; SSE 不停 (旧隧道在线, 跳转自然断开);
 *   4. 隧道访问: 每 2s 用原生 fetch 并行探新旧地址 /api/version —— 新址通即
 *      location.replace; 新址超时且旧址通则回退 location.reload; 双不通超阈值
 *      进入失败态; sameHost 不探测地址, 只轮询 status 到 done 后 reload;
 *   5. 直连: 不探测跨域地址, 只轮询 /api/tunnel/switch/status, done → reload,
 *      failed → 失败态 (解冻, 留在当前页)。
 *
 * 终态前不解冻 (跳转即可, 失败态才解冻供用户手动处理)。
 */
import { computed, ref } from 'vue'
import { errorMessage } from '@/utils/errorMessage'

export type TunnelSwitchPhase =
  | 'idle' | 'preparing' | 'starting' | 'ready' | 'finalizing' | 'done' | 'failed'

export interface TunnelSwitchPayload {
  mode: 'custom' | 'public'
  api_token?: string
  domain?: string
  subdomain?: string
}

/** POST /api/tunnel/switch 与 GET /api/tunnel/switch/status 的响应体 */
export interface TunnelSwitchBody {
  ok?: boolean
  switch_id?: string
  phase?: string
  mode?: string
  old_url?: string
  new_url?: string
  same_host?: boolean
  services?: Record<string, string>
  error_key?: string
  error_params?: Record<string, unknown>
  error?: string
}

/** startSwitch 的非 202 失败: 调用方用 apiErrorText(e.body) 渲染。 */
export class TunnelSwitchError extends Error {
  status: number
  body: TunnelSwitchBody | null

  constructor(message: string, status: number, body: TunnelSwitchBody | null) {
    super(message)
    this.name = 'TunnelSwitchError'
    this.status = status
    this.body = body
  }
}

const POLL_INTERVAL = 2000
const PROBE_TIMEOUT = 5000
/** 新地址健康等待上限: 超时且旧地址可用 → 回退留在旧地址 */
const NEW_TIMEOUT = 120_000
/** 新旧地址都不可达的失败判定阈值 */
const BOTH_FAIL_TIMEOUT = 60_000

// ── 全局请求冻结 (useAutoRefresh 读 isTunnelSwitchFrozen) ──
let frozen = false
/** 原生 fetch 引用: 冻结前后都可用的真身 (不读被置换的 window.fetch) */
let rawFetch: typeof fetch = window.fetch.bind(window)

function nativeFetch(): typeof fetch {
  return rawFetch
}

export function isTunnelSwitchFrozen(): boolean {
  return frozen
}

function freezeFetch(): void {
  if (frozen) return
  rawFetch = window.fetch.bind(window)
  window.fetch = ((..._args: Parameters<typeof fetch>) =>
    new Promise<Response>(() => {})) as typeof fetch
  frozen = true
}

function unfreezeFetch(): void {
  if (!frozen) return
  window.fetch = rawFetch
  frozen = false
}

// ── 单例状态 ──
const active = ref(false)
const phase = ref<TunnelSwitchPhase>('idle')
const oldUrl = ref('')
const newUrl = ref('')
const sameHost = ref(false)
const error = ref('')
const errorParams = ref<Record<string, unknown>>({})
/** 直连访问 (localhost / 公网 IP / 非隧道地址): 只等终态原地刷新 */
const directMode = ref(false)
/** 客户端探测到新旧地址都不可达 (区别于后端 phase=failed) */
const unreachable = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null
let startedAt = 0
let switchId = ''

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 失败后手动关闭遮罩 (页面已解冻可用); 状态保留到下次 startSwitch 重置。 */
function dismiss(): void {
  stopPolling()
  active.value = false
}

async function parseBody(res: Response): Promise<TunnelSwitchBody | null> {
  try {
    return await res.json() as TunnelSwitchBody
  } catch {
    return null
  }
}

/** 原生 fetch 探针: 目标地址 /api/version 是否 200。绝对地址, 绕开冻结。 */
async function pollVersion(url: string): Promise<boolean> {
  if (!url) return false
  try {
    const res = await nativeFetch()(url.replace(/\/+$/, '') + '/api/version', {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    })
    return res.ok
  } catch {
    return false
  }
}

async function fetchSwitchStatus(): Promise<TunnelSwitchBody | null> {
  try {
    const res = await nativeFetch()(window.location.origin + '/api/tunnel/switch/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    })
    if (!res.ok) return null
    return await res.json() as TunnelSwitchBody
  } catch {
    return null
  }
}

function collectHosts(body: unknown): Set<string> {
  const hosts = new Set<string>()
  const add = (u: unknown) => {
    if (typeof u !== 'string' || !u) return
    try {
      hosts.add(new URL(u, window.location.origin).host.toLowerCase())
    } catch { /* 忽略非法地址 */ }
  }
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>
    const urls = rec.urls
    if (urls && typeof urls === 'object') Object.values(urls as Record<string, string>).forEach(add)
    const pub = rec.public
    if (pub && typeof pub === 'object') {
      const pubUrls = (pub as Record<string, unknown>).urls
      if (pubUrls && typeof pubUrls === 'object') Object.values(pubUrls as Record<string, string>).forEach(add)
    }
  }
  return hosts
}

/**
 * 当前是否直连访问: 拉取 /api/tunnel/status, 收集当前模式的 dashboard 与各服务
 * URL 的 host; location.host 命中任一 → 隧道访问, 否则直连。
 * 状态拉取失败按直连处理 (不探测跨域地址, 更安全)。切换发起前该状态刚被
 * 弹窗拉取过, 缓存足够新鲜, 无需强制 refresh。
 */
async function detectDirect(): Promise<boolean> {
  try {
    const res = await nativeFetch()('/api/tunnel/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return true
    const hosts = collectHosts(await res.json())
    return !hosts.has(window.location.host.toLowerCase())
  } catch {
    return true
  }
}

function fail(errorKey: string, bothDown: boolean, params?: Record<string, unknown>): void {
  stopPolling()
  phase.value = 'failed'
  error.value = errorKey
  errorParams.value = params || {}
  unreachable.value = bothDown
  unfreezeFetch()
}

/** 进入终态: 刷新当前页 (仍在当前地址, 新地址由后续导航保证)。 */
function reload(): void {
  stopPolling()
  window.location.reload()
}

async function pollStatusOnce(): Promise<void> {
  const st = await fetchSwitchStatus()
  if (!st) return
  // 只认本次切换的状态 (后端重开后会清为 idle)
  if (switchId && st.switch_id && st.switch_id !== switchId) return
  if (st.phase) phase.value = st.phase as TunnelSwitchPhase
  if (st.new_url) newUrl.value = st.new_url
  if (st.old_url) oldUrl.value = st.old_url
  if (st.same_host !== undefined) sameHost.value = !!st.same_host
  if (st.phase === 'done') {
    reload()
    return
  }
  if (st.phase === 'failed') {
    fail(st.error_key || 'tunnel.err.switch_failed', false, st.error_params)
  }
}

async function probeOnce(): Promise<void> {
  // 后端快速进入 failed (如 token 无效/启动失败) 时不必等阈值, 立即转失败态
  const st = await fetchSwitchStatus()
  if (st && (!switchId || !st.switch_id || st.switch_id === switchId)) {
    if (st.phase) phase.value = st.phase as TunnelSwitchPhase
    if (st.phase === 'failed') {
      fail(st.error_key || 'tunnel.err.switch_failed', false, st.error_params)
      return
    }
  }
  const [newOk, oldOk] = await Promise.all([pollVersion(newUrl.value), pollVersion(oldUrl.value)])
  if (newOk) {
    // 新地址可用: 跳转 (页面加载即拿到正确地址)
    stopPolling()
    const target = newUrl.value
    if (target) window.location.replace(target)
    else window.location.reload()
    return
  }
  const elapsed = Date.now() - startedAt
  if (oldOk && elapsed >= NEW_TIMEOUT) {
    // 新地址迟迟不健康而旧地址仍在: 回退留在旧地址
    reload()
    return
  }
  if (!oldOk && !newOk && elapsed >= BOTH_FAIL_TIMEOUT) {
    fail('', true)
  }
}

function beginPolling(): void {
  stopPolling()
  if (sameHost.value || directMode.value) {
    pollTimer = setInterval(() => { void pollStatusOnce() }, POLL_INTERVAL)
    void pollStatusOnce()
  } else {
    pollTimer = setInterval(() => { void probeOnce() }, POLL_INTERVAL)
    void probeOnce()
  }
}

/** 发起切换。非 202 抛 TunnelSwitchError, 此时不冻结、不弹 overlay。 */
export async function startSwitch(payload: TunnelSwitchPayload): Promise<void> {
  if (active.value) throw new TunnelSwitchError('switch in progress', 409, null)

  directMode.value = await detectDirect()

  let res: Response
  try {
    res = await nativeFetch()('/api/tunnel/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw new TunnelSwitchError(errorMessage(e), 0, null)
  }

  const body = await parseBody(res)
  if (res.status !== 202) {
    throw new TunnelSwitchError(`HTTP ${res.status}`, res.status, body)
  }

  active.value = true
  phase.value = 'preparing'
  oldUrl.value = body?.old_url || ''
  newUrl.value = body?.new_url || ''
  sameHost.value = !!body?.same_host
  error.value = ''
  errorParams.value = {}
  unreachable.value = false
  switchId = body?.switch_id || ''
  startedAt = Date.now()

  freezeFetch()
  beginPolling()
}

export function useTunnelSwitch() {
  const failed = computed(() => phase.value === 'failed')
  const visible = computed(() => active.value)
  return {
    active, phase, oldUrl, newUrl, sameHost, error, errorParams,
    directMode, unreachable, failed, visible, dismiss,
  }
}
