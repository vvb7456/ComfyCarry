<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useLogStream } from '@/composables/useLogStream'
import { useSyncJobs } from '@/composables/useSyncJobs'
import { useCompanionClients } from '@/composables/useCompanionClients'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import SyncActivityTab from '@/components/sync/SyncActivityTab.vue'
import CompanionPanel from '@/components/sync/CompanionPanel.vue'
import PathBrowserModal from '@/components/sync/PathBrowserModal.vue'
import AddCard from '@/components/ui/AddCard.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import UsageBar from '@/components/ui/UsageBar.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import FieldControlRow from '@/components/form/FieldControlRow.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import { remoteBrand } from '@/config/remote-logos'
import { fmtBytes } from '@/utils/format'
import { apiErrorText } from '@/utils/apiError'
import type {
  StorageInfo, SyncTemplate, RemoteField, RemoteTypeDef, Remote,
  SyncRule, SyncSettings,
  SyncStatusResponse, RemotesResponse, StorageResponse,
  RemoteTypesResponse, RulesSaveResponse,
  RcloneConfigResponse, ApiOkResponse,
} from '@/types/sync'

defineOptions({ name: 'SyncPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const activeTab = ref('activity')
const tabs = computed(() => [
  { key: 'activity', label: t('sync.tabs.activity'), icon: 'monitoring' },
  { key: 'storage', label: t('sync.tabs.storage_rules'), icon: 'storage' },
  { key: 'clients', label: t('sync.tabs.clients'), icon: 'monitor' },
  { key: 'config', label: t('sync.tabs.config'), icon: 'settings' },
])

// ---------- State ----------

// Worker
const workerRunning = ref(false)
const workerLoading = ref(false)

// Remotes
const remotes = ref<Remote[]>([])
const storageData = ref<Record<string, StorageInfo>>({})
const storageLoading = ref<Record<string, boolean>>({})

const noCapacityTypes = new Set(['s3', 'webdav', 'ftp', 'swift', 'http', 'azureblob'])

// Rules
const rules = ref<SyncRule[]>([])
const templates = ref<SyncTemplate[]>([])

// Config
const cfgMinAge = ref(60)
const cfgWatchInterval = ref(60)
const rcloneConfig = ref('')
const cfgSaving = ref(false)

// Modals
const addRemoteModal = ref(false)
const addRuleModal = ref(false)
const browseModal = ref(false)
const addRemoteLoading = ref(false)
const saveRuleLoading = ref(false)

// Add remote form
const remoteTypes = ref<Record<string, RemoteTypeDef>>({})
const newRemoteName = ref('')
const newRemoteType = ref('')
const newRemoteParams = ref<Record<string, string>>({})
const remoteTypeDef = computed(() => remoteTypes.value[newRemoteType.value] || null)
const remoteTypeOptions = computed(() =>
  Object.entries(remoteTypes.value).map(([key, def]) => {
    // 类型层面还没有 provider, s3 先给通用图标; 建好后卡片按 provider 显示 R2 / AWS
    const brand = remoteBrand(key)
    return { value: key, label: def.label, logo: brand.logo, icon: brand.icon }
  })
)

/** 规则表单的远程存储下拉选项 (Remote 带 params 嵌套对象, 不能直接喂 BaseSelect) */
const remoteOptions = computed(() =>
  remotes.value.map(r => {
    const brand = brandOf(r)
    return { value: r.name, label: r.display_name || r.name, hint: r.name, logo: brand.logo, icon: brand.icon }
  })
)

/** Remote 卡片的品牌标识 (s3 还要看 provider 区分 R2 / AWS) */
function brandOf(remote: Remote) {
  return remoteBrand(remote.type, remote.params?.provider)
}

// Add/edit rule form
const ruleForm = ref<Partial<SyncRule>>({})
const ruleIsEdit = ref(false)
const ruleIsRunning = ref(false)
/** 模板下拉当前值 (模板 id); 空 = 从零填 */
const selectedTemplate = ref('')

/** 「自定义」项的哨兵值 —— 用空串会与"未选择"重合, placeholder 就没机会出现 */
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
  { value: 'deploy', label: t('sync.rule.trigger_deploy') },
  { value: 'watch', label: t('sync.rule.trigger_watch') },
])

// Browse modal — 目录选择器状态 (逻辑在 PathBrowserModal)
const browseMode = ref<'local' | 'remote'>('remote')
const browseTargetField = ref<'remote_path' | 'local_path'>('remote_path')
const browsePath = ref('')

// Log stream — translate structured entries from backend
// Log stream - sync 日志落盘成 JSONL, 读文件后逐行 JSON.parse 还原结构化再翻译
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

const { lines: logLines, status: logStatus, hasMore: logHasMore, loadingMore: logLoadingMore, prepending: logPrepending, onScroll: logOnScroll, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/sync/logs',
  streamUrl: '/api/sync/logs/stream',
  maxLines: 500,
  transformText: translateSyncJsonl,
})

const { jobs: syncJobs, currentJobId, startPolling: startJobsPolling, stopPolling: stopJobsPolling } = useSyncJobs()

// ── Companion 桌面客户端 ──
const {
  clients: companionClients,
  serve: companionServe,
  davUrl: companionDavUrl,
  loading: companionLoading,
  fetchClients: fetchCompanionClients,
  forgetClient: forgetCompanionClient,
  startPolling: startCompanionPolling,
  stopPolling: stopCompanionPolling,
} = useCompanionClients({ pollInterval: 20_000 })

async function onForgetCompanion(clientId: string) {
  if (!await confirm({ message: t('sync.companion.confirm_forget'), variant: 'danger' })) return
  const ok = await forgetCompanionClient(clientId)
  if (ok) {
    toast(t('sync.companion.forgotten'), 'success')
    await fetchCompanionClients()
  } else {
    toast(t('sync.companion.forget_failed'), 'error')
  }
}

const refresh = useAutoRefresh(loadSyncStatus, 10000)

onMounted(() => {
  loadSyncPage()
  refresh.start({ immediate: false })
  logStart()
  startJobsPolling()
})

onUnmounted(() => {
  refresh.stop()
  stopJobsPolling()
  stopCompanionPolling()
  // logStream auto-stops via onUnmounted in useLogStream
})

async function loadSyncPage() {
  await Promise.all([
    loadRemotes(),
    loadSyncStatus(),
  ])
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
  }
}

async function loadStorage(name: string) {
  storageLoading.value[name] = true
  const d = await get<StorageResponse>('/api/sync/storage')
  if (d?.storage && d.storage[name]) storageData.value[name] = d.storage[name]
  storageLoading.value[name] = false
}

async function loadStorageAll() {
  const d = await get<StorageResponse>('/api/sync/storage')
  if (d?.storage) storageData.value = d.storage
}

// ---- Worker ----
async function workerAction(action: 'start' | 'stop') {
  workerLoading.value = true
  try {
    const d = await post<ApiOkResponse>(`/api/sync/worker/${action}`)
    if (d?.ok) toast(t(`sync.worker.${action}_ok`), 'success')
    else if (d) toast(apiErrorText(d, t('sync.worker.error')), 'error')
    await new Promise(r => setTimeout(r, 1500))
    await loadSyncStatus()
  } finally {
    workerLoading.value = false
  }
}

async function workerRestart() {
  workerLoading.value = true
  try {
    if (!await post('/api/sync/worker/stop')) return
    await new Promise(r => setTimeout(r, 1000))
    if (!await post('/api/sync/worker/start')) return
    toast(t('sync.worker.restart_ok'), 'success')
    await new Promise(r => setTimeout(r, 1500))
    await loadSyncStatus()
  } finally {
    workerLoading.value = false
  }
}

// ---- Storage bar ----
function storagePct(info: StorageInfo | undefined) {
  if (!info || !info.total || !info.used) return 0
  return Math.round((info.used / info.total) * 100)
}

// ---- Badge label helpers ----
const triggerLabels: Record<string, string> = { deploy: 'sync.rules.deploy', watch: 'sync.rules.watch', manual: 'sync.rules.manual' }
const methodLabels: Record<string, string> = { copy: 'sync.rules.method_short.copy', sync: 'sync.rules.method_short.sync', move: 'sync.rules.method_short.move' }
function triggerLabel(trigger: string) { return t(triggerLabels[trigger] || 'sync.rules.manual') }
function methodLabel(method: string) { return t(methodLabels[method] || method) }

// ---- Add Remote ----
async function openAddRemote() {
  newRemoteName.value = ''; newRemoteType.value = ''; newRemoteParams.value = {}
  const d = await get<RemoteTypesResponse>('/api/sync/remote/types')
  if (d?.types) remoteTypes.value = d.types
  addRemoteModal.value = true
}

function onRemoteTypeChange() {
  newRemoteParams.value = {}
  const def = remoteTypeDef.value
  if (def?.fields) {
    for (const f of def.fields) {
      if (f.default !== undefined) newRemoteParams.value[f.key] = f.default
    }
  }
}

async function submitAddRemote() {
  const name = newRemoteName.value.trim()
  if (!name || !newRemoteType.value) {
    toast(t('sync.remote.fill_required'), 'warning')
    return
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    toast(t('sync.remote.invalid_name'), 'warning')
    return
  }
  // Check required dynamic fields
  const def = remoteTypeDef.value
  if (def?.fields) {
    const missing = def.fields.filter((f: RemoteField) => f.required && !newRemoteParams.value[f.key]?.trim())
    if (missing.length) {
      toast(t('sync.remote.missing_fields', { fields: missing.map((f: RemoteField) => f.label).join(', ') }), 'warning')
      return
    }
  }
  addRemoteLoading.value = true
  try {
    const d = await post<ApiOkResponse>('/api/sync/remote/create', { name, type: newRemoteType.value, params: newRemoteParams.value })
    if (d?.ok) {
      toast(t('sync.remote.created'), 'success')
      addRemoteModal.value = false
      newRemoteName.value = ''
      newRemoteType.value = ''
      newRemoteParams.value = {}
      await loadRemotes()
      loadStorageAll()
    } else if (d) {
      toast(apiErrorText(d, t('sync.remote.create_failed')), 'error')
    }
    // d === null means useApiFetch already toasted the HTTP error
  } finally {
    addRemoteLoading.value = false
  }
}

async function deleteRemote(name: string) {
  if (!await confirm({ message: t('sync.remote.confirm_delete', { name }), variant: 'danger' })) return
  const d = await post<ApiOkResponse>('/api/sync/remote/delete', { name })
  if (d?.ok) {
    toast(t('sync.remote.deleted'), 'success')
    await loadRemotes()
    delete storageData.value[name]
  } else if (d) {
    toast(apiErrorText(d, t('sync.remote.delete_failed')), 'error')
  }
}

// ---- Rules ----
function blankRule(remote?: string): Partial<SyncRule> {
  return {
    direction: 'pull', method: 'copy', trigger: 'manual', enabled: true,
    remote: remote || remotes.value[0]?.name || '',
  }
}

function openAddRule() {
  ruleForm.value = blankRule()
  ruleIsEdit.value = false
  selectedTemplate.value = ''
  addRuleModal.value = true
}

function openEditRule(rule: SyncRule) {
  const filters = Array.isArray(rule.filters) ? rule.filters.join('\n') : (rule.filters || '')
  ruleForm.value = { ...rule, filters }
  ruleIsEdit.value = true
  addRuleModal.value = true
}

/** 选中模板 → 覆盖表单里模板能决定的字段 (remote 由用户选, 不动);
 *  选「自定义」→ 清回手填态 */
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
    trigger: tmpl.trigger,
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
    // Convert filters from textarea string to array for backend
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
  if (d?.ok || d?.rules) rules.value = d.rules || updated
}

async function deleteRule(rule: SyncRule) {
  if (!await confirm({ message: t('sync.rule.confirm_delete', { name: rule.name }), variant: 'danger' })) return
  const updated = rules.value.filter(r => r.id !== rule.id)
  const d = await post<RulesSaveResponse>('/api/sync/rules/save', { rules: updated })
  if (d?.ok || d?.rules) {
    rules.value = d.rules || updated
    toast(t('sync.rule.deleted'), 'success')
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
    setTimeout(loadSyncStatus, 2000)
  }
}

// ---- Browse ----
function openBrowse(mode: 'local' | 'remote', field: 'remote_path' | 'local_path') {
  browseMode.value = mode
  browseTargetField.value = field
  browsePath.value = (ruleForm.value[field] as string) || ''
  browseModal.value = true
}

function onBrowseSelect(path: string) {
  ruleForm.value[browseTargetField.value] = path
}

// ---- Config ----
async function loadConfigTab() {
  const [sd, rc] = await Promise.all([
    get<SyncSettings>('/api/sync/settings'),
    get<RcloneConfigResponse>('/api/sync/rclone_config'),
  ])
  if (sd) { cfgMinAge.value = sd.min_age ?? 60; cfgWatchInterval.value = sd.watch_interval ?? 60 }
  if (rc?.config !== undefined) rcloneConfig.value = rc.config
}

function switchTab(tab: string) {
  activeTab.value = tab
  if (tab === 'config') loadConfigTab()
  if (tab === 'storage') {
    loadStorageAll()
  }
  if (tab === 'clients') {
    fetchCompanionClients()
    startCompanionPolling()
  } else {
    stopCompanionPolling()
  }
}

async function saveConfig() {
  cfgSaving.value = true
  try {
    // post 失败返回 null 而不是 reject —— Promise.all 照样 resolve,
    // 不看返回值就会在保存失败后紧接着弹一个"已保存"
    const [settingsRes, confRes] = await Promise.all([
      post<ApiOkResponse>('/api/sync/settings', { min_age: cfgMinAge.value, watch_interval: cfgWatchInterval.value }),
      post<ApiOkResponse>('/api/sync/rclone_config', { config: rcloneConfig.value }),
    ])
    if (settingsRes && confRes) toast(t('sync.config.saved'), 'success')
  } finally { cfgSaving.value = false }
}

async function uploadRcloneFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  rcloneConfig.value = await file.text()
  toast(t('sync.config.file_loaded'), 'success')
}
</script>

<template>
  <PageHeader
    :title="t('sync.title')"
    :service="{
      status: workerRunning ? 'running' : 'stopped',
      label: workerRunning ? t('sync.worker.running') : t('sync.worker.stopped'),
    }"
  >
    <template #actions>
      <span>
        <BaseButton v-if="!workerRunning" :disabled="workerLoading" @click="workerAction('start')"><MsIcon name="play_arrow" /> {{ t('sync.worker.start') }}</BaseButton>
        <template v-else>
          <BaseButton :disabled="workerLoading" @click="workerAction('stop')"><MsIcon name="stop" /> {{ t('sync.worker.stop') }}</BaseButton>
          <BaseButton :disabled="workerLoading" @click="workerRestart()"><MsIcon name="restart_alt" /> {{ t('sync.worker.restart') }}</BaseButton>
        </template>
      </span>
    </template>
  </PageHeader>

  <div class="page-body">
    <TabSwitcher :model-value="activeTab" :tabs="tabs" @update:modelValue="switchTab" />

    <!-- ===== Activity Tab ===== -->
    <div v-show="activeTab === 'activity'">
      <SyncActivityTab
        :log-lines="logLines"
        :log-status="logStatus"
        :log-has-more="logHasMore"
        :log-loading-more="logLoadingMore"
        :log-prepending="logPrepending"
        :log-on-scroll="logOnScroll"
        :jobs="syncJobs"
        :current-job-id="currentJobId"
        :rules="rules"
      />
    </div>

    <!-- ===== Storage & Rules Tab ===== -->
    <div v-show="activeTab === 'storage'">
      <SectionHeader icon="storage" flush>{{ t('sync.tabs.remotes_section') }}</SectionHeader>
      <div class="sync-remotes-grid" style="margin-top:0">
        <div v-for="remote in remotes" :key="remote.name" class="sync-remote-card">
          <div class="sync-remote-header">
            <div class="sync-remote-name">
              <img
                v-if="brandOf(remote).logo"
                :src="brandOf(remote).logo"
                class="sync-remote-logo"
                alt=""
              >
              <MsIcon v-else :name="brandOf(remote).icon" />
              {{ remote.display_name || remote.name }}
              <span class="sync-remote-type">{{ remote.name }} · {{ remote.type }}</span>
            </div>
            <span style="font-size:.75rem;color:var(--t3)">
              <StatusDot :status="remote.has_auth ? 'running' : 'loading'" size="sm" />
              {{ remote.has_auth ? t('sync.remotes.authenticated') : t('sync.remotes.not_configured') }}
            </span>
          </div>

          <!-- Storage bar -->
          <div class="sync-storage-info" v-if="noCapacityTypes.has(remote.type)">
            <span style="font-size:.75rem;color:var(--t3)">{{ t('sync.remote.no_capacity_info') }}</span>
          </div>
          <div class="sync-storage-info" v-else-if="storageData[remote.name]">
            <template v-if="storageData[remote.name].error || storageData[remote.name].error_key">
              <span style="font-size:.75rem;color:var(--red)">{{ apiErrorText(storageData[remote.name]) }}</span>
            </template>
            <template v-else>
              <div style="font-size:.75rem;white-space:nowrap">{{ t('sync.remotes.used') }}: {{ fmtBytes(storageData[remote.name].used ?? 0) }} / {{ fmtBytes(storageData[remote.name].total ?? 0) }}<template v-if="storageData[remote.name].free"> ({{ t('sync.remotes.remaining') }} {{ fmtBytes(storageData[remote.name].free ?? 0) }})</template></div>
              <UsageBar :percent="storagePct(storageData[remote.name])" />
            </template>
          </div>
          <div class="sync-storage-info" v-else>
            <span style="font-size:.75rem;color:var(--t3);cursor:pointer" @click="loadStorage(remote.name)">{{ t('sync.remotes.click_refresh') }}</span>
          </div>

          <div style="margin-top:8px;display:flex;gap:4px;justify-content:flex-end">
            <BaseButton v-if="!noCapacityTypes.has(remote.type)" size="sm" square :disabled="storageLoading[remote.name]" :title="t('sync.remote.load_storage')" @click="loadStorage(remote.name)"><MsIcon name="refresh" /></BaseButton>
            <BaseButton variant="danger" size="sm" square :title="t('sync.rule.delete')" @click="deleteRemote(remote.name)"><MsIcon name="delete" /></BaseButton>
          </div>
        </div>

        <!-- Add card -->
        <AddCard class="sync-remote-card" :label="t('sync.remote.add')" @click="openAddRemote" />
      </div>

      <SectionHeader icon="sync">{{ t('sync.tabs.rules_section') }}</SectionHeader>
      <div class="rules-list">
        <div v-for="rule in rules" :key="rule.id" class="sync-rule-card" :class="{ disabled: !rule.enabled }">
          <div class="sync-rule-dir">
            <MsIcon :name="rule.direction === 'push' ? 'arrow_upward' : 'arrow_downward'" />
          </div>
          <div class="sync-rule-info">
            <div class="sync-rule-name">{{ rule.name }}</div>
            <div class="sync-rule-detail text-truncate">
              <template v-if="rule.direction === 'push'">
                <span style="opacity:.6"><MsIcon name="folder" /></span> {{ rule.local_path }}
                <span class="sync-flow-arrows"><span>▸</span><span>▸</span><span>▸</span></span>
                <span style="opacity:.6"><MsIcon name="cloud" /></span> {{ rule.remote }}:{{ rule.remote_path }}
              </template>
              <template v-else>
                <span style="opacity:.6"><MsIcon name="cloud" /></span> {{ rule.remote }}:{{ rule.remote_path }}
                <span class="sync-flow-arrows"><span>▸</span><span>▸</span><span>▸</span></span>
                <span style="opacity:.6"><MsIcon name="folder" /></span> {{ rule.local_path }}
              </template>
            </div>
            <div class="sync-rule-badges">
              <span class="sync-rule-badge">{{ triggerLabel(rule.trigger) }}</span>
              <span class="sync-rule-badge">{{ methodLabel(rule.method) }}</span>
            </div>
          </div>
          <div class="sync-rule-actions">
            <BaseButton size="sm" square :disabled="ruleIsRunning || !rule.enabled" :title="t('sync.rule.run')" @click="runRule(rule)"><MsIcon name="play_arrow" /></BaseButton>
            <BaseButton size="sm" square :title="t('sync.rule.edit')" @click="openEditRule(rule)"><MsIcon name="edit" /></BaseButton>
            <BaseButton size="sm" square :title="rule.enabled ? t('sync.rule.disable') : t('sync.rule.enable')" @click="toggleRule(rule)">
              <MsIcon :name="rule.enabled ? 'pause' : 'play_arrow'" />
            </BaseButton>
            <BaseButton variant="danger" size="sm" square :title="t('sync.rule.delete')" @click="deleteRule(rule)"><MsIcon name="delete" /></BaseButton>
          </div>
        </div>
        <!-- Add card -->
        <AddCard class="sync-rule-card" size="compact" :label="t('sync.rule.add')" @click="openAddRule" />
      </div>
    </div>

    <!-- ===== Clients (Companion) Tab ===== -->
    <div v-show="activeTab === 'clients'">
      <CompanionPanel
        :clients="companionClients"
        :serve="companionServe"
        :dav-url="companionDavUrl"
        :loading="companionLoading"
        @forget-client="onForgetCompanion"
        @refresh="fetchCompanionClients"
      />
    </div>

    <!-- ===== Config Tab ===== -->
    <div v-show="activeTab === 'config'">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <BaseCard density="roomy">
          <FormField :label="t('sync.config.min_age.label')" :hint="t('sync.config.min_age.desc')" layout="horizontal">
            <input v-model.number="cfgMinAge" type="number" min="0" class="form-number" style="width:72px;text-align:center">
            <span style="color:var(--t3);font-size:.78rem">{{ t('sync.config.min_age.unit') }}</span>
          </FormField>
        </BaseCard>
        <BaseCard density="roomy">
          <FormField :label="t('sync.config.watch_interval.label')" :hint="t('sync.config.watch_interval.desc')" layout="horizontal">
            <input v-model.number="cfgWatchInterval" type="number" min="10" class="form-number" style="width:72px;text-align:center">
            <span style="color:var(--t3);font-size:.78rem">{{ t('sync.config.watch_interval.unit') }}</span>
          </FormField>
        </BaseCard>
      </div>

      <SectionHeader icon="description">{{ t('sync.config.rclone.title') }}</SectionHeader>
      <textarea v-model="rcloneConfig" class="form-textarea form-textarea--mono rclone-config-editor" spellcheck="false" :placeholder="t('sync.config.rclone.placeholder')"></textarea>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding:12px 0">
        <BaseButton @click="($refs.rcloneFileInput as HTMLInputElement)?.click()">
          <MsIcon name="upload" /> {{ t('sync.config.rclone.upload_local') }}
        </BaseButton>
        <input ref="rcloneFileInput" type="file" accept=".conf,.txt" style="display:none" @change="uploadRcloneFile">
        <BaseButton variant="primary" :disabled="cfgSaving" @click="saveConfig">
          {{ cfgSaving ? t('sync.config.saving') : t('sync.config.save') }}
        </BaseButton>
      </div>
    </div>

    <!-- ===== Add Remote Modal ===== -->
    <BaseModal v-model="addRemoteModal" :title="t('sync.remote.add_modal')" size="md">
      <FormField :label="t('sync.remote.name')" density="compact">
        <input v-model="newRemoteName" type="text" :placeholder="t('sync.remote.name_placeholder')" class="form-input">
      </FormField>
      <FormField :label="t('sync.remote.type')" density="compact">
        <BaseSelect v-model="newRemoteType" :options="remoteTypeOptions" :placeholder="t('sync.remote.select_type')" teleport @change="onRemoteTypeChange" />
      </FormField>
      <!-- Dynamic fields -->
      <template v-if="remoteTypeDef">
        <template v-for="field in remoteTypeDef.fields || []" :key="field.key">
          <FormField density="compact" :hint="(field.help && !(field.key === 'token' && remoteTypeDef?.oauth)) ? field.help : undefined">
            <template #label>
              {{ field.label }}<template v-if="field.required && !(field.key === 'token' && remoteTypeDef?.oauth)"> *</template>
              <HelpTip v-if="field.key === 'token' && remoteTypeDef?.oauth" :text="t('sync.remote.oauth_token_tooltip', { type: newRemoteType })" />
            </template>
            <textarea v-if="field.type === 'textarea'" v-model="newRemoteParams[field.key]" :placeholder="field.placeholder || ''" rows="3" class="form-textarea"></textarea>
            <BaseSelect v-else-if="field.type === 'select'" v-model="newRemoteParams[field.key]" :options="field.options || []" teleport />
            <input v-else v-model="newRemoteParams[field.key]" :type="field.type === 'password' ? 'password' : 'text'" :placeholder="field.placeholder || ''" autocomplete="off" class="form-input">
          </FormField>
        </template>
      </template>
      <template #footer>
        <BaseButton size="sm" :disabled="addRemoteLoading" @click="addRemoteModal = false">{{ t('common.btn.cancel') }}</BaseButton>
        <BaseButton variant="primary" size="sm" :disabled="addRemoteLoading" @click="submitAddRemote">
          {{ addRemoteLoading ? t('sync.remote.connecting') : t('common.btn.add') }}
        </BaseButton>
      </template>
    </BaseModal>

    <!-- ===== Add/Edit Rule Modal ===== -->
    <BaseModal v-model="addRuleModal" :title="ruleIsEdit ? t('sync.rule.edit_modal') : t('sync.rule.add_modal')" size="md">
      <!-- 模板: 12 条平铺成 chip 墙太吵, 收进一个可搜索 select -->
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
          <BaseButton size="xs" square :title="t('sync.browse.remote_title')" @click="openBrowse('remote', 'remote_path')"><MsIcon name="folder_open" /></BaseButton>
        </FieldControlRow>
      </FormField>
      <FormField :label="t('sync.rule.local_path')" density="compact">
        <FieldControlRow>
          <input v-model="ruleForm.local_path" type="text" class="form-input" placeholder="/ComfyUI/models/loras">
          <BaseButton size="xs" square :title="t('sync.browse.local_title')" @click="openBrowse('local', 'local_path')"><MsIcon name="folder_open" /></BaseButton>
        </FieldControlRow>
      </FormField>
      <FormField :label="t('sync.rule.filters')" density="compact">
        <textarea v-model="ruleForm.filters" rows="3" class="form-textarea form-textarea--mono" :placeholder="t('sync.rule.filters_placeholder')"></textarea>
      </FormField>
      <template #footer>
        <BaseButton size="sm" :disabled="saveRuleLoading" @click="addRuleModal = false">{{ t('common.btn.cancel') }}</BaseButton>
        <BaseButton variant="primary" size="sm" :disabled="saveRuleLoading" @click="saveRule">
          {{ saveRuleLoading ? t('common.loading') : t('common.btn.save') }}
        </BaseButton>
      </template>
    </BaseModal>

    <!-- ===== Path Browser ===== -->
    <PathBrowserModal
      v-model="browseModal"
      :mode="browseMode"
      :remote="ruleForm.remote || ''"
      :path="browsePath"
      @select="onBrowseSelect"
    />
  </div>
</template>

<style scoped>
/* 规则表单的两列行 —— 窄屏退化单列 */
.rule-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 640px) { .rule-field-row { grid-template-columns: 1fr; } }

/* Rules list container */
.rules-list { display: flex; flex-direction: column; gap: 0; margin-bottom: 16px; }

/* ── Remotes Grid ── */
.sync-remotes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(300px, 22vw, 420px), 1fr)); gap: clamp(14px, 1.2vw, 22px); margin-top: 8px; }
.sync-remote-card { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: 16px; }
.sync-remote-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.sync-remote-name { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: .95rem; }
.sync-remote-logo { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
.sync-remote-type { font-size: .72rem; color: var(--t3); background: var(--bg2); padding: 2px 8px; border-radius: 10px; }
.sync-storage-info { font-size: .8rem; color: var(--t2); margin-top: 8px; }

/* ── Rule Cards ── */
.sync-rule-card { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: 14px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 14px; }
.sync-rule-card.disabled { opacity: .5; }
.sync-rule-card.disabled .sync-flow-arrows span { animation: none !important; opacity: .3; }
.sync-rule-dir { font-size: 1.2rem; flex-shrink: 0; }
.sync-flow-arrows { display: inline-flex; gap: 1px; margin: 0 5px; vertical-align: middle; }
.sync-flow-arrows span { color: var(--green); font-size: .85rem; font-weight: 700; animation: arrowFlow 1.4s infinite; opacity: .25; }
.sync-flow-arrows span:nth-child(2) { animation-delay: .2s; }
.sync-flow-arrows span:nth-child(3) { animation-delay: .4s; }
@keyframes arrowFlow { 0%, 100% { opacity: .2; } 40% { opacity: 1; } 60% { opacity: 1; } 80% { opacity: .2; } }
.sync-rule-info { flex: 1; min-width: 0; }
.sync-rule-name { font-weight: 600; font-size: .9rem; }
.sync-rule-detail { font-size: .78rem; color: var(--t3); margin-top: 3px; display: flex; align-items: center; }
.sync-rule-badges { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.sync-rule-badge { font-size: .68rem; padding: 1px 7px; border-radius: 8px; background: var(--bg2); color: var(--t2); border: 1px solid var(--bd); display: inline-flex; align-items: center; gap: 3px; }
.sync-rule-actions { display: flex; gap: 4px; flex-shrink: 0; }
.sync-rule-actions button { font-size: .75rem; padding: 4px 8px; }

/* ── Rclone Config Editor ── */
.rclone-config-editor { width: 100%; min-height: 400px; max-height: 600px; font-family: 'IBM Plex Mono', monospace; font-size: .78rem; line-height: 1.5; background: var(--bg3); color: var(--t1); border: 1px solid var(--bd); border-radius: var(--r); padding: 12px; resize: vertical; white-space: pre; overflow: auto; }
</style>
