<script setup lang="ts">
/**
 * SyncPage — 云同步页 (C07)。
 *
 * 页头两个 Tab: 同步 / 客户端。页头承接设置 (min_age / watch_interval 弹窗)
 * 与自动同步的停止 / 重启 (与其他服务页一致, 仅由 worker 运行状态决定是否出现);
 * Hero 按状态承接启动自动同步 / 重新连接 / 添加存储。
 *
 * 同步 Tab 顺序: Hero → 存储 → 同步规则 → 最近同步 (默认展开) → 日志 (默认收起)。
 *   - Hero 数据 = worker 状态 + 当前任务 (fetchCurrentJobDetail) + 最近结果;
 *     运行中展示已完成规则数/总规则数, 完成后展示文件数与传输摘要。
 *   - 存储/规则使用 ListRow; OAuth 向导、容量刷新、模板、路径浏览、过滤规则全部保留。
 *   - 最近同步接 C02 服务端分页 (每页 5) + C01 ListPagination; 历史页保持页码与滚动,
 *     回到第一页恢复轮询。详情进入 SyncJobDetailModal, 使用执行时规则快照。
 *   - 日志默认收起 (SectionHeader 折叠标题)。
 *
 * 客户端 Tab: Companion Hero (主标题与色调只看客户端在线数; 副标题与第二按钮随面板
 *   公网地址是否可用切换; 下载客户端入口只由 Hero 承接) + 客户端 ListRow (区块头只留刷新)。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useClipboard } from '@/composables/useClipboard'
import { useLogStream } from '@/composables/useLogStream'
import { useSyncJobs, type SyncJob } from '@/composables/useSyncJobs'
import { useCompanionClients } from '@/composables/useCompanionClients'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import ServiceHero from '@/components/ui/ServiceHero.vue'
import ListRow from '@/components/ui/ListRow.vue'
import ListPagination from '@/components/ui/ListPagination.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import FieldControlRow from '@/components/form/FieldControlRow.vue'
import AddStorageModal from '@/components/sync/AddStorageModal.vue'
import PathBrowserModal from '@/components/sync/PathBrowserModal.vue'
import SyncJobDetailModal from '@/components/sync/SyncJobDetailModal.vue'
import SyncSettingsModal from '@/components/sync/SyncSettingsModal.vue'
import { remoteBrand } from '@/config/remote-logos'
import { fmtBytes } from '@/utils/format'
import { apiErrorText, apiMessageText } from '@/utils/apiError'
import type {
  StorageInfo, SyncTemplate, RemoteTypeDef, Remote,
  SyncRule, SyncSettings,
  SyncStatusResponse, RemotesResponse, StorageResponse,
  RemoteTypesResponse, RulesSaveResponse, RemoteDeleteResponse,
  ApiOkResponse, CompanionClient,
} from '@/types/sync'

defineOptions({ name: 'SyncPage' })

const { t } = useI18n({ useScope: 'global' })
const router = useRouter()
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()
const { copy } = useClipboard()

// ── 页签 ──
const activeTab = ref('sync')
const tabs = computed(() => [
  { key: 'sync', label: t('sync.tabs.sync'), icon: 'cloud_sync' },
  { key: 'clients', label: t('sync.tabs.clients'), icon: 'monitor' },
])

// ── Worker / 设置 ──
const workerRunning = ref(false)
const actionLoading = ref<'start' | 'stop' | 'restart' | null>(null)
const acting = computed(() => actionLoading.value !== null)
const settings = ref<SyncSettings | null>(null)

// ── 存储 ──
const remotes = ref<Remote[]>([])
const storageData = ref<Record<string, StorageInfo>>({})
const storageLoading = ref<Record<string, boolean>>({})
const noCapacityTypes = new Set(['s3', 'webdav', 'ftp', 'swift', 'http', 'azureblob'])
const remoteTypes = ref<Record<string, RemoteTypeDef>>({})

// ── 规则 ──
const rules = ref<SyncRule[]>([])
const templates = ref<SyncTemplate[]>([])
const ruleIsRunning = ref(false)

// ── 弹窗 ──
const addStorageModalOpen = ref(false)
const reconnectPreset = ref<{ type?: string; name?: string } | undefined>()
const addRuleModal = ref(false)
const browseModal = ref(false)
const saveRuleLoading = ref(false)
const settingsOpen = ref(false)
const detailOpen = ref(false)
const detailJobId = ref<string | null>(null)

function openDetail(jobId: string) {
  detailJobId.value = jobId
  detailOpen.value = true
}

// ── 分页记录 ──
const {
  jobs: syncJobs,
  currentJobId,
  loading: jobsLoading,
  page: jobsPage,
  pageSize: jobsPageSize,
  total: jobsTotal,
  goToPage,
  fetchCurrentJobDetail,
  startPolling: startJobsPolling,
  stopPolling: stopJobsPolling,
} = useSyncJobs({ pageSize: 5 })

// ── Hero 任务 ──
const currentJob = ref<SyncJob | null>(null)
const latestJob = ref<SyncJob | null>(null)

// ── Companion 客户端 ──
const {
  clients: companionClients,
  serve: companionServe,
  hostUrl: companionHostUrl,
  tunnelOnline: companionTunnelOnline,
  loading: companionLoading,
  fetchClients: fetchCompanionClients,
  startPolling: startCompanionPolling,
  stopPolling: stopCompanionPolling,
} = useCompanionClients({ pollInterval: 20_000 })

// ── 日志流 ──
function translateSyncJsonl(text: string): { text: string; level?: string } {
  try {
    const e = JSON.parse(text)
    if (e && typeof e === 'object' && 'key' in e) {
      return {
        text: `[${e.ts}] ${t('sync.log.' + e.key, (e.params || {}) as Record<string, unknown>)}`,
        level: (e.level || 'info') as string,
      }
    }
  } catch { /* 非 JSON, 原样返回 */ }
  return { text }
}

const logOpen = ref(false)
const { lines: logLines, status: logStatus, hasMore: logHasMore, loadingMore: logLoadingMore, prepending: logPrepending, onScroll: logOnScroll, start: logStart } = useLogStream({
  historyUrl: '/api/sync/logs',
  streamUrl: '/api/sync/logs/stream',
  maxLines: 500,
  transformText: translateSyncJsonl,
})

// ── 生命周期 ──
const refreshStatus = useAutoRefresh(loadSyncStatus, 10_000)
const refreshHero = useAutoRefresh(loadHeroJob, 5_000)

onMounted(() => {
  loadSyncPage()
  loadStorageAll()
  refreshStatus.start({ immediate: false })
  refreshHero.start({ immediate: false })
  logStart()
  startJobsPolling()
})

onUnmounted(() => {
  refreshStatus.stop()
  refreshHero.stop()
  stopJobsPolling()
  stopCompanionPolling()
})

async function loadSyncPage() {
  await Promise.all([loadRemotes(), loadSyncStatus()])
  await loadHeroJob()
}

async function loadRemotes() {
  const d = await get<RemotesResponse>('/api/sync/remotes')
  if (d?.remotes) remotes.value = d.remotes
}

async function loadSyncStatus() {
  const d = await get<SyncStatusResponse>('/api/sync/status')
  if (d) {
    workerRunning.value = !!d.worker_running
    if (d.rules) rules.value = d.rules
    if (d.templates) templates.value = d.templates
    settings.value = d.settings ?? null
  }
}

async function loadStorage(name: string) {
  storageLoading.value[name] = true
  try {
    const d = await get<StorageResponse>('/api/sync/storage')
    if (d?.storage && d.storage[name]) storageData.value[name] = d.storage[name]
  } finally {
    storageLoading.value[name] = false
  }
}

async function loadStorageAll() {
  const d = await get<StorageResponse>('/api/sync/storage')
  if (d?.storage) storageData.value = d.storage
}

/** Hero 任务: 运行中读当前任务, 否则读最新一条完成记录 */
async function loadHeroJob() {
  if (currentJobId.value) {
    const d = await fetchCurrentJobDetail()
    currentJob.value = d?.job ?? null
  } else {
    currentJob.value = null
    const d = await get<{ jobs: SyncJob[] }>('/api/sync/jobs?page=1&limit=1')
    latestJob.value = d?.jobs?.[0] ?? null
  }
}

// ── Worker ──
async function workerAction(action: 'start' | 'stop' | 'restart') {
  actionLoading.value = action
  try {
    const d = await post<ApiOkResponse>(`/api/sync/worker/${action}`)
    if (d?.ok) toast(t(`sync.worker.${action}_ok`), 'success')
    else if (d) toast(apiErrorText(d, t('sync.worker.error')), 'error')
    await new Promise(r => setTimeout(r, 1200))
    await loadSyncStatus()
  } finally {
    actionLoading.value = null
  }
}

// ── Hero 状态机 ──
type HeroState = 'unconfigured' | 'running' | 'auth_expired' | 'idle' | 'stopped'

const configured = computed(() => remotes.value.length > 0 || rules.value.length > 0)
const authIssueRemote = computed(() =>
  remotes.value.find(r =>
    r.has_auth === false || storageData.value[r.name]?.error_key === 'sync.err.storage_auth_expired',
  ) ?? null,
)

const heroState = computed<HeroState>(() => {
  if (!configured.value) return 'unconfigured'
  if (currentJob.value?.status === 'running') return 'running'
  if (authIssueRemote.value) return 'auth_expired'
  return workerRunning.value ? 'idle' : 'stopped'
})

const heroTone = computed(() => ({
  unconfigured: 'off',
  running: 'warn',
  auth_expired: 'bad',
  idle: 'ok',
  stopped: 'off',
}[heroState.value] as 'off' | 'warn' | 'bad' | 'ok'))

const heroBusy = computed(() => heroState.value === 'running')
const heroTitle = computed(() => t(`sync.hero.${heroState.value}.title`))

const heroSubtitle = computed(() => {
  const s = heroState.value
  if (s === 'running') {
    const job = currentJob.value
    const done = (job?.success_count ?? 0) + (job?.failure_count ?? 0)
    return t('sync.hero.running.subtitle', { done, total: job?.rule_count ?? 0 })
  }
  if (s === 'unconfigured' || s === 'auth_expired') return t(`sync.hero.${s}.subtitle`)
  const job = latestJob.value
  if (job?.finished_at) {
    if (job.status === 'failed') {
      return t(`sync.hero.${s}.subtitle_failed`, { failed: job.failure_count, total: job.rule_count })
    }
    return t(`sync.hero.${s}.subtitle_done`, {
      files: job.files_synced,
      bytes: fmtBytes(job.summary?.bytes ?? 0),
    })
  }
  return t(`sync.hero.${s}.subtitle`)
})

const factsList = computed<{ label: string; value: string }[]>(() => {
  const out = [
    { label: t('sync.facts.worker'), value: workerRunning.value ? t('sync.facts.worker_running') : t('sync.facts.worker_stopped') },
    { label: t('sync.facts.rules'), value: String(rules.value.length) },
    { label: t('sync.facts.storages'), value: String(remotes.value.length) },
  ]
  if (settings.value) {
    out.push({ label: t('sync.facts.watch_interval'), value: `${settings.value.watch_interval}s` })
  }
  return out
})

// ── 存储行 ──
function brandOf(remote: Remote) {
  return remoteBrand(remote.type, remote.params?.provider)
}

function needsReconnect(remote: Remote): boolean {
  return remote.has_auth === false || storageData.value[remote.name]?.error_key === 'sync.err.storage_auth_expired'
}

function storagePct(info: StorageInfo | undefined) {
  if (!info || !info.total || !info.used) return 0
  return Math.round((info.used / info.total) * 100)
}

// ── Remote 创建 / 删除 ──
async function openAddRemote() {
  const d = await get<RemoteTypesResponse>('/api/sync/remote/types')
  if (d?.types) remoteTypes.value = d.types
  addStorageModalOpen.value = true
}

function openReconnect(remote: Remote) {
  reconnectPreset.value = { type: remote.type, name: remote.name }
  openAddRemote()
}

function clearReconnectPreset() {
  reconnectPreset.value = undefined
}

async function onRemoteCreated(remote: { name: string; type: string; openRuleModal?: boolean }) {
  reconnectPreset.value = undefined
  await loadRemotes()
  loadStorageAll()
  if (remote.openRuleModal) openAddRule(remote.name)
}

async function deleteRemote(name: string) {
  const affectedRules = rules.value.filter(r => r.remote === name)
  const msg = affectedRules.length > 0
    ? t('sync.remote.confirm_disconnect_with_rules', { name, count: affectedRules.length })
    : t('sync.remote.confirm_disconnect', { name })
  if (!await confirm({ message: msg, variant: 'danger' })) return
  const d = await post<RemoteDeleteResponse>('/api/sync/remote/delete', { name })
  if (d?.ok) {
    const removed = d.rules_removed ?? 0
    if (removed > 0) {
      toast(t('sync.remote.disconnected_with_rules', { name, count: removed }), 'success')
      await loadSyncStatus()
    } else {
      toast(apiMessageText(d, t('sync.remote.disconnected')), 'success')
    }
    await loadRemotes()
    delete storageData.value[name]
  } else if (d) {
    toast(apiErrorText(d, t('sync.remote.disconnect_failed')), 'error')
  }
}

// ── 规则 ──
/** Remote 下拉选项 (Remote 带 params 嵌套对象, 不能直接喂 BaseSelect) */
const remoteOptions = computed(() =>
  remotes.value.map(r => {
    const brand = brandOf(r)
    return { value: r.name, label: r.display_name || r.name, hint: r.name, logo: brand.logo, icon: brand.icon }
  })
)

function blankRule(remote?: string): Partial<SyncRule> {
  return {
    direction: 'pull', method: 'copy', trigger: 'manual', enabled: true,
    remote: remote || remotes.value[0]?.name || '',
  }
}

const ruleForm = ref<Partial<SyncRule>>({})
const ruleIsEdit = ref(false)
const selectedTemplate = ref('')
const TEMPLATE_CUSTOM = '__custom__'

const templateOptions = computed(() => [
  { value: TEMPLATE_CUSTOM, label: t('sync.rule.template_custom') },
  ...templates.value.map(tmpl => ({
    value: tmpl.id || tmpl.name,
    label: tmpl.name,
    hint: t(`sync.rule.${tmpl.direction}`),
  })),
])

const directionOptions = computed(() => [
  { value: 'pull', label: t('sync.rule.pull') },
  { value: 'push', label: t('sync.rule.push') },
])

const methodOptions = computed(() => [
  { value: 'copy', label: t('sync.rules.method_short.copy') },
  { value: 'sync', label: t('sync.rules.method_short.sync') },
  { value: 'move', label: t('sync.rules.method_short.move') },
])

const triggerOptions = computed(() => [
  { value: 'manual', label: t('sync.rule.trigger_manual') },
  { value: 'watch', label: t('sync.rule.trigger_watch') },
])

function openAddRule(presetRemote?: string) {
  ruleForm.value = blankRule(presetRemote)
  ruleIsEdit.value = false
  selectedTemplate.value = ''
  addRuleModal.value = true
}

function openEditRule(rule: SyncRule) {
  const filters = Array.isArray(rule.filters) ? rule.filters.join('\n') : (rule.filters || '')
  ruleForm.value = {
    ...rule,
    filters,
    trigger: rule.trigger === 'deploy' ? 'manual' : rule.trigger,
  }
  ruleIsEdit.value = true
  addRuleModal.value = true
}

function onPickTemplate(id: string) {
  if (id === TEMPLATE_CUSTOM) {
    ruleForm.value = blankRule(ruleForm.value.remote)
    return
  }
  const tmpl = templates.value.find(x => (x.id || x.name) === id)
  if (!tmpl) return
  const filters = Array.isArray(tmpl.filters) ? tmpl.filters.join('\n') : ''
  ruleForm.value = {
    ...ruleForm.value,
    name: tmpl.name,
    direction: tmpl.direction,
    method: tmpl.method,
    trigger: tmpl.trigger === 'deploy' ? 'manual' : tmpl.trigger,
    local_path: tmpl.local_path || '',
    remote_path: tmpl.remote_path || '',
    filters,
  }
}

async function saveRule() {
  if (!ruleForm.value.name?.trim() || !ruleForm.value.remote || !ruleForm.value.local_path?.trim()) {
    toast(t('sync.rule.fill_required'), 'warning')
    return
  }
  saveRuleLoading.value = true
  try {
    const formData = { ...ruleForm.value }
    if (typeof formData.filters === 'string') {
      formData.filters = formData.filters.split('\n').filter(Boolean)
    }
    const updated = ruleIsEdit.value
      ? rules.value.map(r => r.id === formData.id ? { ...r, ...formData } as SyncRule : r)
      : [...rules.value, { ...formData, id: `rule_${Date.now()}`, enabled: true } as SyncRule]
    const d = await post<RulesSaveResponse>('/api/sync/rules/save', { rules: updated })
    if (d?.ok || d?.rules) {
      rules.value = d.rules || updated
      toast(t('sync.rule.saved'), 'success')
      addRuleModal.value = false
      await loadSyncStatus()
    } else if (d) {
      toast(apiErrorText(d, t('sync.rule.save_failed')), 'error')
    }
  } finally {
    saveRuleLoading.value = false
  }
}

async function toggleRule(rule: SyncRule) {
  const updated = rules.value.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r)
  const d = await post<RulesSaveResponse>('/api/sync/rules/save', { rules: updated })
  if (d?.ok || d?.rules) {
    rules.value = d.rules || updated
    await loadSyncStatus()
  }
}

async function deleteRule(rule: SyncRule) {
  if (!await confirm({ message: t('sync.rule.confirm_delete', { name: rule.name }), variant: 'danger' })) return
  const updated = rules.value.filter(r => r.id !== rule.id)
  const d = await post<RulesSaveResponse>('/api/sync/rules/save', { rules: updated })
  if (d?.ok || d?.rules) {
    rules.value = d.rules || updated
    toast(t('sync.rule.deleted'), 'success')
    await loadSyncStatus()
  } else if (d) {
    toast(apiErrorText(d, t('sync.rule.save_failed')), 'error')
  }
}

async function runRule(rule: SyncRule) {
  ruleIsRunning.value = true
  toast(t('sync.rule.running') + ': ' + rule.name, 'info')
  try {
    const d = await post<ApiOkResponse>('/api/sync/rules/run', { rule_id: rule.id })
    if (d?.ok) toast(t('sync.rule.run_ok'), 'success')
    else if (d) toast(apiErrorText(d, t('sync.rule.run_failed')), 'error')
  } finally {
    ruleIsRunning.value = false
    setTimeout(() => { void loadSyncStatus(); void loadHeroJob() }, 2000)
  }
}

// ── 路径浏览 ──
const browseMode = ref<'local' | 'remote'>('remote')
const browseTargetField = ref<'remote_path' | 'local_path'>('remote_path')

function openBrowse(mode: 'local' | 'remote', field: 'remote_path' | 'local_path') {
  browseMode.value = mode
  browseTargetField.value = field
  browseModal.value = true
}

function onBrowseSelect(path: string) {
  ruleForm.value[browseTargetField.value] = path
}

// ── 规则展示 ──
const triggerLabels: Record<string, string> = { deploy: 'sync.rules.deploy', watch: 'sync.rules.watch', manual: 'sync.rules.manual' }
const methodLabels: Record<string, string> = { copy: 'sync.rules.method_short.copy', sync: 'sync.rules.method_short.sync', move: 'sync.rules.method_short.move' }
function triggerLabel(trigger: string) { return t(triggerLabels[trigger] || 'sync.rules.manual') }
function methodLabel(method: string) { return t(methodLabels[method] || method) }

function rulePath(rule: SyncRule): string {
  return rule.direction === 'push'
    ? `${rule.local_path} → ${rule.remote}:${rule.remote_path}`
    : `${rule.remote}:${rule.remote_path} → ${rule.local_path}`
}

// ── 记录展示 ──
function statusTone(status: string): 'running' | 'stopped' | 'loading' | 'error' {
  if (status === 'running') return 'loading'
  if (status === 'success') return 'running'
  if (status === 'failed') return 'error'
  return 'stopped'
}

function statusText(status: string): string {
  const key = `sync.job.status.${status}`
  return t(key)
}

function jobDirIcon(job: SyncJob): string {
  const rules = job.rules ?? []
  if (rules.length === 1) return rules[0].direction === 'push' ? 'arrow_upward' : 'arrow_downward'
  if (rules.length > 1) return 'swap_horiz'
  return 'sync'
}

function jobTitle(job: SyncJob): string {
  return t('sync.records.files_synced', { count: job.files_synced })
}

/** 规则信息: 单规则显示名称, 多规则显示条数 (快照缺失时回退 rule_count) */
function jobRulesFact(job: SyncJob): string {
  const rules = job.rules ?? []
  if (rules.length === 1) return rules[0].name || rules[0].id
  return t('sync.records.rules_count', { count: rules.length || job.rule_count })
}

function jobFlow(job: SyncJob): string {
  const rules = job.rules ?? []
  if (rules.length !== 1) return ''
  const r = rules[0]
  return r.direction === 'push'
    ? `${r.local_path} → ${r.remote}:${r.remote_path}`
    : `${r.remote}:${r.remote_path} → ${r.local_path}`
}

function jobTransfers(job: SyncJob): string {
  if (job.status === 'running') {
    return t('sync.records.progress', { done: job.success_count + job.failure_count, total: job.rule_count })
  }
  if (job.summary?.bytes) return fmtBytes(job.summary.bytes)
  return ''
}

function fmtJobTime(epoch: number): string {
  if (!epoch) return ''
  const d = new Date(epoch * 1000)
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? hm
    : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

function jobFacts(job: SyncJob): string[] {
  return [jobRulesFact(job), fmtJobTime(job.started_at), jobTransfers(job)].filter(Boolean)
}

// ── 客户端展示 ──
function fmtRelative(epoch: number) {
  if (!epoch) return t('sync.companion.never_seen')
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - epoch))
  if (sec < 10) return t('sync.companion.just_now')
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return new Date(epoch * 1000).toLocaleDateString()
}

function statusKey(s: string) {
  const known = ['idle', 'syncing', 'pulling', 'busy', 'paused', 'error']
  return `sync.companion.status_${known.includes(s) ? s : 'idle'}`
}

function isPulling(c: CompanionClient) {
  return ['syncing', 'pulling', 'busy'].includes(c.status || '')
}

function clientStatus(c: CompanionClient): { tone: 'running' | 'stopped' | 'loading'; text: string } {
  const tone: 'running' | 'stopped' | 'loading' = isPulling(c) ? 'loading' : (c.online ? 'running' : 'stopped')
  return { tone, text: t(statusKey(c.status)) }
}

function clientFacts(c: CompanionClient): string[] {
  const out: string[] = []
  if (c.app_version) out.push(`v${c.app_version}`)
  out.push(fmtRelative(c.last_seen))
  return out
}

const onlineCount = computed(() => companionClients.value.filter(c => c.online).length)
const clientHeroOnline = computed(() => onlineCount.value > 0)

/**
 * Companion Hero 两个正交维度:
 *   - 主标题 + 色调: **只看有没有客户端在线** —— 有 → ok (绿) + 「N 台客户端在线」,
 *     没有 → off (灰) + 「暂无客户端在线」。tunnel 完全不参与: 地址有无是 tunnel
 *     模块的事, 本模块不替别的模块报警告。
 *   - 副标题 + 第二按钮: 只看面板公网地址是否可用。隧道服务未启动 **或** 取不到
 *     面板公网地址 (取「或」: 进程没起 / 连接中 / 面板先于 tunnel 启动导致 url 为空)
 *     → 「无法获取连接地址」+「配置隧道」; 否则 → 安装提示 +「复制地址」。
 */
const clientHeroNoAddr = computed(() => !companionTunnelOnline.value || !companionHostUrl.value)

const clientHeroTone = computed<'ok' | 'off'>(() => clientHeroOnline.value ? 'ok' : 'off')

const clientHeroSubtitle = computed(() => clientHeroNoAddr.value
  ? t('sync.companion.hero_no_addr')
  : t('sync.companion.hero_hint'))

const clientFactsList = computed<{ label: string; value: string }[]>(() => {
  const out: { label: string; value: string }[] = []
  const addr = companionServe.value?.addr
  if (addr) out.push({ label: t('sync.companion.facts.listen'), value: addr })
  if (companionServe.value?.serve_root) out.push({ label: t('sync.companion.facts.root'), value: companionServe.value.serve_root })
  out.push({ label: t('sync.companion.facts.online'), value: String(onlineCount.value) })
  return out
})

/** 复制面板公网主域名 (客户端拿它 + 面板密码换 WebDAV 地址)。 */
async function copyHostUrl() {
  if (companionHostUrl.value) await copy(companionHostUrl.value)
}

// ── 页签切换 ──
function switchTab(tab: string) {
  activeTab.value = tab
  if (tab === 'clients') {
    fetchCompanionClients()
    startCompanionPolling()
  } else {
    stopCompanionPolling()
    goToPage(1)
  }
}
</script>

<template>
  <div class="page-body">
    <TabSwitcher :title="t('sync.title')" :model-value="activeTab" :tabs="tabs" @update:modelValue="switchTab">
      <template #extra>
        <span v-if="workerRunning" class="page-actions">
          <BaseButton
            size="sm"
            :loading="actionLoading === 'stop'"
            :disabled="acting"
            @click="workerAction('stop')"
          >
            <MsIcon name="stop" /> {{ t('common.btn.stop') }}
          </BaseButton>
          <BaseButton
            size="sm"
            :loading="actionLoading === 'restart'"
            :disabled="acting"
            @click="workerAction('restart')"
          >
            <MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}
          </BaseButton>
        </span>
        <BaseButton variant="ghost" size="sm" :aria-label="t('sync.settings.title')" @click="settingsOpen = true">
          <MsIcon name="settings" /> {{ t('common.btn.settings') }}
        </BaseButton>
      </template>
    </TabSwitcher>

    <div class="page-col">
      <!-- ═══════════ 同步 Tab ═══════════ -->
      <template v-if="activeTab === 'sync'">
        <!-- Hero -->
        <ServiceHero
          icon="cloud_sync"
          :title="heroTitle"
          :subtitle="heroSubtitle"
          :tone="heroTone"
          :busy="heroBusy"
        >
          <template v-if="heroState === 'unconfigured'" #actions>
            <BaseButton variant="primary" @click="openAddRemote">{{ t('sync.storage.add') }}</BaseButton>
          </template>
          <template v-else-if="heroState === 'auth_expired'" #actions>
            <BaseButton v-if="authIssueRemote" variant="primary" @click="openReconnect(authIssueRemote)">
              {{ t('sync.remote.reconnect') }}
            </BaseButton>
          </template>
          <template v-else-if="heroState === 'stopped'" #actions>
            <BaseButton variant="primary" :loading="actionLoading === 'start'" :disabled="acting" @click="workerAction('start')">
              {{ t('sync.hero.action.start') }}
            </BaseButton>
          </template>
          <template #facts>
            <span v-for="fact in factsList" :key="fact.label">{{ fact.label }}<b>{{ fact.value }}</b></span>
          </template>
        </ServiceHero>

        <!-- 存储 -->
        <section class="sync-block">
          <SectionHeader icon="storage">
            {{ t('sync.storage.title') }}
            <span class="sync-count">{{ remotes.length }}</span>
            <template #actions>
              <BaseButton size="sm" @click="openAddRemote">
                <MsIcon name="add" /> {{ t('sync.storage.add') }}
              </BaseButton>
            </template>
          </SectionHeader>

          <div v-if="remotes.length" class="sync-remotes-grid">
            <div v-for="remote in remotes" :key="remote.name" class="sync-remote-card">
              <div class="sync-remote-card__head">
                <img
                  v-if="brandOf(remote).logo"
                  :src="brandOf(remote).logo"
                  class="sync-remote-card__logo-img"
                  alt=""
                >
                <MsIcon v-else :name="brandOf(remote).icon" class="sync-remote-card__logo" />
                <div class="sync-remote-card__name">
                  {{ remote.display_name || remote.name }}
                  <span class="sync-remote-card__type">{{ remote.name }} · {{ remote.type }}</span>
                </div>
                <span class="sync-remote-card__auth">
                  {{ remote.has_auth ? t('sync.remotes.authenticated') : t('sync.remotes.not_configured') }}
                </span>
              </div>

              <!-- 容量: 不支持查询 / 错误 / 正常 (文案 + 用量条) / 未加载 (点击刷新) -->
              <div class="sync-remote-card__cap">
                <span v-if="noCapacityTypes.has(remote.type)" class="sync-remote-card__cap-note">
                  {{ t('sync.remote.no_capacity_info') }}
                </span>
                <span
                  v-else-if="storageData[remote.name] && (storageData[remote.name].error || storageData[remote.name].error_key)"
                  class="sync-remote-card__cap-err"
                >{{ apiErrorText(storageData[remote.name]) }}</span>
                <template v-else-if="storageData[remote.name]">
                  <span class="sync-remote-card__cap-line">
                    {{ t('sync.remotes.used') }} {{ fmtBytes(storageData[remote.name].used ?? 0) }} / {{ fmtBytes(storageData[remote.name].total ?? 0) }}
                    <template v-if="storageData[remote.name].free">
                      ({{ t('sync.remotes.remaining') }} {{ fmtBytes(storageData[remote.name].free ?? 0) }})
                    </template>
                  </span>
                  <UsageBar :percent="storagePct(storageData[remote.name])" />
                </template>
                <span
                  v-else
                  class="sync-remote-card__cap-note is-click"
                  @click="loadStorage(remote.name)"
                >{{ t('sync.remotes.click_refresh') }}</span>
              </div>

              <div class="sync-remote-card__actions">
                <BaseButton
                  v-if="needsReconnect(remote)"
                  variant="ghost" size="sm" icon-only
                  :aria-label="t('sync.remote.reconnect')"
                  @click="openReconnect(remote)"
                >
                  <MsIcon name="autorenew" />
                </BaseButton>
                <BaseButton
                  v-if="!noCapacityTypes.has(remote.type)"
                  variant="ghost" size="sm" icon-only
                  :aria-label="t('sync.remote.load_storage')"
                  :disabled="storageLoading[remote.name]"
                  @click="loadStorage(remote.name)"
                >
                  <MsIcon name="refresh" />
                </BaseButton>
                <BaseButton
                  variant="danger" size="sm" icon-only
                  :aria-label="t('sync.remote.disconnect')"
                  @click="deleteRemote(remote.name)"
                >
                  <MsIcon name="delete" />
                </BaseButton>
              </div>
            </div>
          </div>
          <EmptyState v-else icon="cloud" :message="t('sync.empty.desc')" density="compact">
            <BaseButton size="sm" @click="openAddRemote">
              <MsIcon name="add" /> {{ t('sync.storage.add') }}
            </BaseButton>
          </EmptyState>
        </section>

        <!-- 同步规则 -->
        <section class="sync-block">
          <SectionHeader icon="sync">
            {{ t('sync.rules_section.title') }}
            <span class="sync-count">{{ rules.length }}</span>
            <template #actions>
              <BaseButton size="sm" @click="openAddRule()">
                <MsIcon name="add" /> {{ t('sync.rule.add') }}
              </BaseButton>
            </template>
          </SectionHeader>

          <ul v-if="rules.length" class="list-plain sync-rules">
            <ListRow
              v-for="rule in rules"
              :key="rule.id"
              :icon="rule.direction === 'push' ? 'arrow_upward' : 'arrow_downward'"
              :title="rule.name"
              :badges="[triggerLabel(rule.trigger), methodLabel(rule.method)]"
              :facts="[rulePath(rule)]"
              :disabled="!rule.enabled"
            >
              <template #actions>
                <BaseButton
                  variant="ghost" size="sm" icon-only
                  :aria-label="t('sync.rule.run')"
                  :disabled="ruleIsRunning || !rule.enabled"
                  @click="runRule(rule)"
                >
                  <MsIcon name="play_arrow" />
                </BaseButton>
                <BaseButton variant="ghost" size="sm" icon-only :aria-label="t('sync.rule.edit')" @click="openEditRule(rule)">
                  <MsIcon name="edit" />
                </BaseButton>
                <BaseButton
                  variant="ghost" size="sm" icon-only
                  :aria-label="rule.enabled ? t('sync.rule.disable') : t('sync.rule.enable')"
                  @click="toggleRule(rule)"
                >
                  <MsIcon :name="rule.enabled ? 'block' : 'check_circle'" />
                </BaseButton>
                <BaseButton variant="danger" size="sm" icon-only :aria-label="t('sync.rule.delete')" @click="deleteRule(rule)">
                  <MsIcon name="delete" />
                </BaseButton>
              </template>
            </ListRow>
          </ul>
          <EmptyState v-else icon="sync" :message="t('sync.rules_section.empty')" density="compact">
            <BaseButton size="sm" @click="openAddRule()">
              <MsIcon name="add" /> {{ t('sync.rule.add') }}
            </BaseButton>
          </EmptyState>
        </section>

        <!-- 最近同步 -->
        <section class="sync-block">
          <SectionHeader icon="history">
            {{ t('sync.records.title') }}
            <span class="sync-count">{{ jobsTotal }}</span>
          </SectionHeader>

          <ul v-if="syncJobs.length" class="list-plain sync-records">
            <ListRow
              v-for="job in syncJobs"
              :key="job.job_id"
              :icon="jobDirIcon(job)"
              :title="jobTitle(job)"
              :status="{ tone: statusTone(job.status), text: statusText(job.status) }"
              :facts="jobFacts(job)"
            >
              <template v-if="jobFlow(job)" #extra>
                <div class="record-flow mono">{{ jobFlow(job) }}</div>
              </template>
              <template #actions>
                <BaseButton
                  variant="ghost" size="sm" icon-only
                  :aria-label="t('sync.records.detail')"
                  @click="openDetail(job.job_id)"
                >
                  <MsIcon name="receipt_long" />
                </BaseButton>
              </template>
            </ListRow>
          </ul>
          <EmptyState v-else icon="cloud_done" :message="t('sync.records.empty')" density="compact" />

          <ListPagination
            :page="jobsPage"
            :page-size="jobsPageSize"
            :total="jobsTotal"
            :loading="jobsLoading"
            @update:page="goToPage"
          />
        </section>

        <!-- 同步日志 (默认收起, 折叠标题与分区标题同构) -->
        <section class="sync-block">
          <SectionHeader icon="terminal" collapsible v-model:expanded="logOpen">
            {{ t('sync.log.title') }}
          </SectionHeader>
          <LogPanel
            v-show="logOpen"
            :lines="logLines"
            :status="logStatus"
            :has-more="logHasMore"
            :loading-more="logLoadingMore"
            :prepending="logPrepending"
            :on-scroll="logOnScroll"
          />
        </section>
      </template>

      <!-- ═══════════ 客户端 Tab ═══════════ -->
      <template v-else>
        <ServiceHero
          icon="monitor"
          :title="clientHeroOnline ? t('sync.companion.hero_online', { count: onlineCount }) : t('sync.companion.hero_offline')"
          :subtitle="clientHeroSubtitle"
          :tone="clientHeroTone"
        >
          <template #actions>
            <BaseButton
              variant="primary"
              href="https://github.com/vvb7456/ComfyCarry-Companion/releases/latest"
              target="_blank"
            >
              <MsIcon name="download" /> {{ t('sync.companion.download_client') }}
            </BaseButton>
            <BaseButton v-if="!clientHeroNoAddr" @click="copyHostUrl">
              <MsIcon name="content_copy" /> {{ t('sync.companion.copy_host') }}
            </BaseButton>
            <BaseButton v-else @click="router.push('/tunnel')">
              {{ t('sync.companion.configure_tunnel') }}
            </BaseButton>
          </template>
          <template #facts>
            <span v-for="fact in clientFactsList" :key="fact.label">{{ fact.label }}<b>{{ fact.value }}</b></span>
          </template>
        </ServiceHero>

        <section class="sync-block">
          <SectionHeader icon="monitor">
            {{ t('sync.companion.clients_title') }}
            <span class="sync-count">{{ companionClients.length }}</span>
            <template #actions>
              <BaseButton
                variant="ghost" size="sm" icon-only
                :aria-label="t('sync.companion.refresh')"
                :disabled="companionLoading"
                @click="fetchCompanionClients"
              >
                <MsIcon name="refresh" />
              </BaseButton>
            </template>
          </SectionHeader>

          <ul class="list-plain sync-clients">
            <ListRow
              v-for="c in companionClients"
              :key="c.client_id"
              icon="monitor"
              :title="c.hostname || c.client_id"
              :title-tooltip="c.client_id"
              :status="clientStatus(c)"
              :facts="clientFacts(c)"
            >
              <template #extra>
                <div v-if="c.rule_summaries?.length" class="client-rules">
                  <div v-for="(r, i) in c.rule_summaries" :key="i" class="client-rule">
                    <MsIcon name="cloud_download" size="xs" class="client-rule__ic" />
                    <span class="client-rule__path mono">{{ r.source || 'output' }} → {{ r.local_path || '—' }}</span>
                    <span v-if="r.method" class="client-rule__chip">{{ methodLabel(r.method) }}</span>
                    <span v-if="r.trigger" class="client-rule__chip">{{ triggerLabel(r.trigger) }}</span>
                  </div>
                </div>
                <p v-else class="client-rule-empty">{{ t('sync.companion.no_rules') }}</p>
              </template>
            </ListRow>
          </ul>
        </section>
      </template>
    </div>

    <!-- ═══════════ 弹窗 ═══════════ -->
    <AddStorageModal
      v-model="addStorageModalOpen"
      :existing-remotes="remotes"
      :remote-types="remoteTypes"
      :preset="reconnectPreset"
      @created="onRemoteCreated"
      @close="clearReconnectPreset"
    />

    <BaseModal v-model="addRuleModal" :title="ruleIsEdit ? t('sync.rule.edit_modal') : t('sync.rule.add_modal')" size="md">
      <FormField v-if="templates.length && !ruleIsEdit" :label="t('sync.rule.quick_template')" density="compact">
        <BaseSelect
          v-model="selectedTemplate"
          :options="templateOptions"
          searchable
          teleport
          :placeholder="t('sync.rule.template_placeholder')"
          :search-placeholder="t('sync.rule.template_search')"
          @update:modelValue="onPickTemplate"
        />
      </FormField>
      <FormField :label="t('sync.rule.name')" density="compact">
        <input v-model="ruleForm.name" type="text" class="form-input">
      </FormField>
      <div class="rule-field-row">
        <FormField :label="t('sync.rule.direction')" density="compact">
          <BaseSelect v-model="ruleForm.direction!" :options="directionOptions" teleport />
        </FormField>
        <FormField density="compact">
          <template #label>
            {{ t('sync.rule.method') }}
            <HelpTip :text="t('sync.rule.method_help')" />
          </template>
          <BaseSelect v-model="ruleForm.method!" :options="methodOptions" teleport />
        </FormField>
      </div>
      <div class="rule-field-row">
        <FormField :label="t('sync.rule.remote')" density="compact">
          <BaseSelect v-model="ruleForm.remote!" :options="remoteOptions" teleport />
        </FormField>
        <FormField :label="t('sync.rule.trigger')" density="compact">
          <BaseSelect v-model="ruleForm.trigger!" :options="triggerOptions" teleport />
        </FormField>
      </div>
      <FormField :label="t('sync.rule.remote_path')" density="compact">
        <FieldControlRow>
          <input v-model="ruleForm.remote_path" type="text" class="form-input" placeholder="ComfyCarry/loras">
          <BaseButton size="sm" icon-only :aria-label="t('sync.browse.remote_title')" :title="t('sync.browse.remote_title')" @click="openBrowse('remote', 'remote_path')"><MsIcon name="folder_open" /></BaseButton>
        </FieldControlRow>
      </FormField>
      <FormField :label="t('sync.rule.local_path')" density="compact">
        <FieldControlRow>
          <input v-model="ruleForm.local_path" type="text" class="form-input" placeholder="/ComfyUI/models/loras">
          <BaseButton size="sm" icon-only :aria-label="t('sync.browse.local_title')" :title="t('sync.browse.local_title')" @click="openBrowse('local', 'local_path')"><MsIcon name="folder_open" /></BaseButton>
        </FieldControlRow>
      </FormField>
      <FormField :label="t('sync.rule.filters')" density="compact">
        <textarea v-model="ruleForm.filters" rows="3" class="form-textarea form-textarea--mono" :placeholder="t('sync.rule.filters_placeholder')"></textarea>
      </FormField>
      <template #footer>
        <BaseButton size="sm" :disabled="saveRuleLoading" @click="addRuleModal = false">{{ t('common.btn.cancel') }}</BaseButton>
        <BaseButton variant="primary" size="sm" :disabled="saveRuleLoading" @click="saveRule">
          <MsIcon v-if="!saveRuleLoading" name="save" size="xs" color="none" />
          {{ saveRuleLoading ? t('common.loading') : t('common.btn.save') }}
        </BaseButton>
      </template>
    </BaseModal>

    <PathBrowserModal
      v-model="browseModal"
      :mode="browseMode"
      :remote="ruleForm.remote || ''"
      @select="onBrowseSelect"
    />

    <SyncJobDetailModal v-model="detailOpen" :job-id="detailJobId" />
    <SyncSettingsModal v-model="settingsOpen" @saved="loadSyncStatus" />
  </div>
</template>

<style scoped>
/* 分区节奏: Hero → 存储 → 规则 → 最近同步 → 日志 (--section-gap, 与总览一致) */
.sync-block {
  margin-top: var(--section-gap);
}

.sync-count {
  margin-left: 6px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--t3);
}

/* 规则表单的两列行 —— 窄屏退化单列 */
.rule-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

/* 存储卡片: 自适应网格 (设计稿 cc-storage 同构) */
.sync-remotes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.sync-remote-card {
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r);
  padding: 14px 16px;
  display: grid;
  gap: 10px;
  align-content: start;
}

.sync-remote-card__head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.sync-remote-card__logo {
  font-size: 22px;
  color: var(--t2);
}

.sync-remote-card__logo-img {
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.sync-remote-card__name {
  font-size: 13.5px;
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.sync-remote-card__type {
  font-size: 11px;
  font-weight: 400;
  color: var(--t3);
  font-family: var(--font-mono);
}

.sync-remote-card__auth {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--t2);
  white-space: nowrap;
}

.sync-remote-card__cap {
  font-size: 11.5px;
  color: var(--t3);
  display: grid;
  gap: 6px;
}

.sync-remote-card__cap-err {
  color: var(--red);
}

.sync-remote-card__cap-note.is-click {
  cursor: pointer;
}

.sync-remote-card__cap-note.is-click:hover {
  color: var(--t1);
}

.sync-remote-card__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

/* 规则路径用等宽 (ListRow facts 默认 tabular) */
.sync-rules :deep(.list-row__facts),
.sync-records :deep(.list-row__facts) {
  font-family: var(--font-mono);
}

.mono {
  font-family: var(--font-mono);
}

/* 记录流向: 窄屏收进二级行并隐藏 (优先保留时间/结果/名称/详情) */
.record-flow {
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--t3);
  overflow-wrap: anywhere;
}

/* 客户端规则只读镜像 */
.client-rules {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.client-rule {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.client-rule__ic {
  flex: none;
  color: var(--blue);
}

.client-rule__path {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--t2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-rule__chip {
  flex: none;
  font-size: var(--text-xxs, .68rem);
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 6px;
  background: var(--bg2);
  color: var(--t2);
}

.client-rule-empty {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  color: var(--t3);
}

@media (max-width: 768px) {
  .rule-field-row { grid-template-columns: 1fr; }
  .record-flow { display: none; }
}
</style>
