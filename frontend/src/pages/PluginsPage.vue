<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import FilterInput from '@/components/ui/FilterInput.vue'
import FormField from '@/components/form/FormField.vue'
import FieldControlRow from '@/components/form/FieldControlRow.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import type {
  InstalledRaw, PluginInfo, BrowseItem,
  PluginActionResponse, QueueStatusResponse, UpdateCheckResponse,
} from '@/types/plugins'

defineOptions({ name: 'PluginsPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const activeTab = ref('installed')
const tabs = computed(() => [
  { key: 'installed', label: t('plugins.tabs.installed'), icon: 'inventory_2' },
  { key: 'browse',    label: t('plugins.tabs.browse'), icon: 'search' },
  { key: 'git',       label: t('plugins.tabs.git'), icon: 'link' },
])

// State
interface InstalledPlugin { cnrId: string; dirName: string; title: string; description: string; repository: string; author: string; stars: number; ver: string; activeVersion: string; cnrLatest: string; enabled: boolean; updateState: boolean }

function shortHash(h: string) { return h && h.length > 8 ? h.substring(0, 8) : (h || 'unknown') }
function displayVer(p: InstalledPlugin) {
  const isNightly = p.activeVersion === 'nightly'
  return isNightly ? shortHash(p.ver) : (p.activeVersion || shortHash(p.ver))
}

const installedPlugins = ref<InstalledPlugin[]>([])
const installedLoading = ref(false)
const installedError = ref('')
const installedFilter = ref('')
const installedStatusFilter = ref('all')

const browseData = ref<BrowseItem[]>([])
const browseLoading = ref(false)
const browseError = ref('')
const browseQuery = ref('')
const browseSort = ref('stars')
const browseStart = ref(0)
const PAGE_SIZE = 40
const browseListEnd = ref<HTMLElement | null>(null)
let _browseIo: IntersectionObserver | null = null

const filteredBrowse = computed<BrowseItem[]>(() => {
  const q = browseQuery.value.toLowerCase().trim()
  let result = browseData.value
  if (q) result = result.filter(p => p._title.includes(q) || p._desc.includes(q) || p.id.includes(q))
  if (browseSort.value === 'stars') return [...result].sort((a, b) => (b.stars || 0) - (a.stars || 0))
  if (browseSort.value === 'update') return [...result].sort((a, b) => b._last_update.localeCompare(a._last_update))
  return [...result].sort((a, b) => a._title.localeCompare(b._title))
})

const browseStats = computed(() =>
  browseData.value.length ? t('plugins.browse.stats_text', { count: filteredBrowse.value.length }) : ''
)

// Reset pagination when filter/sort changes
watch([browseQuery, browseSort], () => { browseStart.value = PAGE_SIZE })

// Infinite scroll sentinel observer
watch(browseListEnd, (el) => {
  if (_browseIo) { _browseIo.disconnect(); _browseIo = null }
  if (!el) return
  _browseIo = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && browseStart.value < filteredBrowse.value.length) {
      browseStart.value += PAGE_SIZE
    }
  }, { rootMargin: '300px' })
  _browseIo.observe(el)
})

const queueProcessing = ref(false)
const queueStatus = ref('')
let queuePollTimer: ReturnType<typeof setInterval> | null = null

// Git install
const gitUrl = ref('')
const gitInstalling = ref(false)
const gitStatus = ref<{ok?: boolean; message?: string} | null>(null)

// Version modal
const versionModalOpen = ref(false)
const versionModalTitle = ref('')
const versionModalId = ref('')
const versionList = ref<string[]>([])
const versionLoading = ref(false)

let getlistCache: Record<string, PluginInfo> = {}

type AvailablePluginsResponse = Record<string, PluginInfo> | { node_packs: Record<string, PluginInfo> }

function unpackAvailablePlugins(data: AvailablePluginsResponse): Record<string, PluginInfo> {
  const candidate = (data as { node_packs?: Record<string, PluginInfo> }).node_packs
  return candidate ?? (data as Record<string, PluginInfo>)
}

function toBrowseItems(data: Record<string, PluginInfo>): BrowseItem[] {
  return Object.entries(data).map(([id, info]) => ({
    id,
    ...info,
    _title: (info.title || id).toLowerCase(),
    _desc: (info.description || '').toLowerCase(),
    _last_update: typeof info.last_update === 'string' ? info.last_update : '',
  }))
}

function applyAvailablePlugins(data: AvailablePluginsResponse) {
  const unpacked = unpackAvailablePlugins(data)
  getlistCache = unpacked
  browseData.value = toBrowseItems(unpacked)
  browseStart.value = PAGE_SIZE
}

onMounted(() => {
  loadPluginsPage()
})

onUnmounted(() => {
  stopQueuePoll()
  if (_browseIo) { _browseIo.disconnect(); _browseIo = null }
})

async function loadPluginsPage() {
  await loadInstalled()
  pollQueue()
}

// Tab switch
function switchTab(tab: string) {
  activeTab.value = tab
  if (tab === 'installed') loadInstalled()
  else if (tab === 'browse' && (browseData.value.length === 0 || !!browseError.value)) loadBrowse()
}

// Installed
async function loadInstalled() {
  installedLoading.value = true
  installedError.value = ''
  try {
    const [installedData, availableData] = await Promise.all([
      get<Record<string, InstalledRaw>>('/api/plugins/installed'),
      get<AvailablePluginsResponse>('/api/plugins/available'),
    ])

    if (availableData) {
      browseError.value = ''
      applyAvailablePlugins(availableData)
    } else if (!browseData.value.length) {
      browseError.value = t('plugins.browse.load_failed')
    }

    if (!installedData) {
      installedError.value = t('plugins.installed.load_failed')
      return
    }

    const listRaw = availableData ? unpackAvailablePlugins(availableData) : getlistCache
    installedPlugins.value = Object.entries(installedData).map(([dirName, inst]: [string, InstalledRaw]) => {
      const cnrId = inst.cnr_id || ''
      const en = listRaw[cnrId] || {}
      return {
        dirName, cnrId,
        title: en.title || dirName,
        description: en.description || '',
        repository: en.repository || en.reference || (inst.aux_id ? `https://github.com/${inst.aux_id}` : ''),
        author: en.author || (inst.aux_id ? inst.aux_id.split('/')[0] : ''),
        stars: en.stars ?? 0,
        ver: inst.ver || '',
        activeVersion: en.active_version || inst.ver || '',
        cnrLatest: en.cnr_latest || '',
        enabled: inst.enabled !== false,
        updateState: en['update-state'] === 'true' || en['update-state'] === 'True',
      }
    })
  } finally {
    installedLoading.value = false
  }
}

async function loadBrowse(force = false) {
  if (!force && browseData.value.length > 0 && !browseError.value) return
  browseLoading.value = true
  browseError.value = ''
  try {
    const data = await get<AvailablePluginsResponse>('/api/plugins/available')
    if (!data) {
      browseError.value = t('plugins.browse.load_failed')
      return
    }
    applyAvailablePlugins(data)
  } finally {
    browseLoading.value = false
  }
}

const filteredInstalled = computed(() => {
  const q = installedFilter.value.toLowerCase()
  const sf = installedStatusFilter.value
  let result = installedPlugins.value.filter(p => {
    if (q && !p.title.toLowerCase().includes(q) && !p.cnrId.includes(q) && !p.dirName.toLowerCase().includes(q)) return false
    if (sf === 'enabled' && !p.enabled) return false
    if (sf === 'disabled' && p.enabled) return false
    if (sf === 'update' && !p.updateState) return false
    return true
  })
  result.sort((a, b) => {
    if (a.updateState && !b.updateState) return -1
    if (!a.updateState && b.updateState) return 1
    return a.title.localeCompare(b.title)
  })
  return result
})

const installedStats = computed(() => {
  const total = installedPlugins.value.length
  const enabled = installedPlugins.value.filter(p => p.enabled).length
  const updates = installedPlugins.value.filter(p => p.updateState).length
  return t('plugins.installed.stats_text', { total, enabled, update: updates, shown: filteredInstalled.value.length })
})

const currentBrowsePage = computed(() => filteredBrowse.value.slice(0, browseStart.value))

// Actions
async function installPlugin(id: string, version = 'latest') {
  toast(t('plugins.toast.installing_name', { id }))
  const pack = getlistCache[id] || {}
  const payload: Record<string, unknown> = { id, version: pack.version || 'unknown', selected_version: version }
  if (pack.files) payload.files = pack.files
  if (pack.repository || pack.reference) payload.repository = pack.repository || pack.reference
  const d = await post<PluginActionResponse>('/api/plugins/install', payload)
  if (d?.message) { toast(d.message); startQueuePoll() }
}

async function uninstallPlugin(id: string, version: string, title: string) {
  if (!await confirm({ message: t('plugins.confirm.uninstall_name', { title: title || id }), variant: 'danger' })) return
  const d = await post<PluginActionResponse>('/api/plugins/uninstall', { id, version })
  if (d?.message) { toast(d.message); startQueuePoll() }
}

async function updatePlugin(id: string, version: string) {
  const d = await post<PluginActionResponse>('/api/plugins/update', { id, version })
  if (d?.message) { toast(d.message); startQueuePoll() }
}

async function updateAll() {
  if (!await confirm({ message: t('plugins.confirm.update_all_confirm') })) return
  const d = await post<PluginActionResponse>('/api/plugins/update_all')
  if (d?.message) { toast(d.message); startQueuePoll() }
}

async function togglePlugin(id: string, version: string) {
  const d = await post<PluginActionResponse>('/api/plugins/disable', { id, version })
  if (d?.message) { toast(d.message); startQueuePoll() }
}

// Git install
async function installFromGit() {
  if (!gitUrl.value.trim()) { toast(t('plugins.git.empty_url')); return }
  if (!gitUrl.value.startsWith('http')) { toast(t('plugins.git.invalid_url')); return }
  gitInstalling.value = true
  gitStatus.value = null
  const d = await post<{ message: string }>('/api/plugins/install_git', { url: gitUrl.value })
  gitInstalling.value = false
  if (!d) {
    gitStatus.value = { ok: false, message: t('plugins.git.request_failed') }
    return
  }
  gitStatus.value = { ok: true, message: d.message }
  gitUrl.value = ''
  startQueuePoll()
}

// Version modal
async function openVersionModal(id: string, title: string) {
  versionModalId.value = id
  versionModalTitle.value = t('plugins.version_picker.title_name', { name: title || id })
  versionModalOpen.value = true
  versionLoading.value = true
  versionList.value = []
  const versions = await get<(string | Record<string, string>)[]>(`/api/plugins/versions/${encodeURIComponent(id)}`)
  if (versions) {
    versionList.value = versions.map(v => typeof v === 'string' ? v : v.version || JSON.stringify(v))
  }
  versionLoading.value = false
}

async function installVersion(version: string) {
  versionModalOpen.value = false
  await installPlugin(versionModalId.value, version)
}

// Queue polling
function startQueuePoll() {
  pollQueue()
  if (queuePollTimer) clearInterval(queuePollTimer)
  queuePollTimer = setInterval(pollQueue, 2000)
}

function stopQueuePoll() {
  if (queuePollTimer) { clearInterval(queuePollTimer); queuePollTimer = null }
}

async function pollQueue() {
  const d = await get<QueueStatusResponse>('/api/plugins/queue_status')
  if (!d) return
  if (d.is_processing && d.total_count && d.total_count > 0) {
    queueProcessing.value = true
    queueStatus.value = t('plugins.queue.status', { done: d.done_count ?? 0, total: d.total_count ?? 0 })
  } else {
    queueProcessing.value = false
    queueStatus.value = ''
    if (queuePollTimer) {
      stopQueuePoll()
      if (activeTab.value === 'installed') loadInstalled()
    }
  }
}

async function checkUpdates() {
  toast(t('plugins.installed.checking_updates'))
  const d = await get<UpdateCheckResponse>('/api/plugins/fetch_updates')
  if (!d) return
  if (d.has_updates) { toast(t('plugins.installed.found_updates')); loadPluginsPage() }
  else toast(t('plugins.installed.all_up_to_date'))
}
</script>

<template>
  <PageHeader icon="extension" :title="t('plugins.title')" />

  <div class="page-body">
    <TabSwitcher :model-value="activeTab" :tabs="tabs" @update:modelValue="switchTab">
      <span v-if="queueProcessing" style="font-size:.78rem;color:var(--amber);margin-left:auto;display:flex;align-items:center;gap:4px">
        <MsIcon name="hourglass_top" /> {{ queueStatus }}
      </span>
    </TabSwitcher>

    <!-- ===== Installed Tab ===== -->
    <div v-show="activeTab === 'installed'">
      <SectionToolbar>
        <template #start>
          <FilterInput v-model="installedFilter" :placeholder="t('plugins.installed.filter_placeholder')" style="flex:1;max-width:400px" />
          <span class="toolbar-status">{{ installedStats }}</span>
        </template>
        <template #end>
          <BaseSelect v-model="installedStatusFilter" :options="[
            { value: 'all', label: t('plugins.installed.all_status') },
            { value: 'enabled', label: t('plugins.installed.enabled') },
            { value: 'disabled', label: t('plugins.installed.disabled') },
            { value: 'update', label: t('plugins.installed.has_update') },
          ]" size="sm" fit />
          <BaseButton size="sm" @click="loadPluginsPage">{{ t('plugins.installed.refresh') }}</BaseButton>
          <BaseButton size="sm" @click="checkUpdates">{{ t('plugins.installed.check_updates') }}</BaseButton>
          <BaseButton variant="primary" size="sm" @click="updateAll">{{ t('plugins.installed.update_all') }}</BaseButton>
        </template>
      </SectionToolbar>

      <AlertBanner v-if="installedError" tone="danger" dense>{{ installedError }}</AlertBanner>
      <LoadingCenter v-if="installedLoading && installedPlugins.length === 0">{{ t('common.status.loading') }}</LoadingCenter>
      <EmptyState v-else-if="installedError && installedPlugins.length === 0" icon="error" :message="installedError" />
      <EmptyState v-else-if="filteredInstalled.length === 0" icon="search_off" :message="t('plugins.installed.no_match')" />
      <div v-else class="plugin-list">
        <div v-for="p in filteredInstalled" :key="p.dirName" class="plugin-item">
          <div class="plugin-item-header">
            <div class="plugin-item-title">
              <a v-if="p.repository" :href="p.repository" target="_blank">{{ p.title }}</a>
              <span v-else>{{ p.title }}</span>
            </div>
            <span v-if="p.updateState" class="plugin-badge update">{{ t('plugins.installed.has_update') }}</span>
            <span v-if="!p.enabled" class="plugin-badge disabled">{{ t('plugins.installed.disabled') }}</span>
            <span v-else class="plugin-badge installed">{{ t('plugins.installed.installed_badge') }}</span>
          </div>
          <div v-if="p.description" class="plugin-item-desc">{{ p.description }}</div>
          <div class="plugin-item-meta">
            <span><MsIcon name="extension" /> {{ p.cnrId || p.dirName }}</span>
            <span style="color:var(--cyan)">
              <template v-if="p.activeVersion === 'nightly'"><MsIcon name="build" /> {{ displayVer(p) }}</template>
              <template v-else>v{{ displayVer(p) }}</template>
            </span>
            <span v-if="p.cnrLatest" style="color:var(--t3)">(latest: {{ p.cnrLatest }})</span>
            <span v-if="p.stars > 0"><MsIcon name="star" /> {{ p.stars }}</span>
            <span v-if="p.author"><MsIcon name="person" /> {{ p.author }}</span>
            <div class="plugin-item-actions">
              <BaseButton v-if="p.updateState" variant="success" size="sm" @click="updatePlugin(p.cnrId || p.dirName, p.ver)">{{ t('plugins.installed.update') }}</BaseButton>
              <BaseButton size="sm" @click="openVersionModal(p.cnrId || p.dirName, p.title)">{{ t('plugins.installed.version') }}</BaseButton>
              <BaseButton v-if="!p.enabled" variant="primary" size="sm" @click="togglePlugin(p.cnrId || p.dirName, p.ver)">{{ t('plugins.installed.enable') }}</BaseButton>
              <BaseButton v-else size="sm" @click="togglePlugin(p.cnrId || p.dirName, p.ver)">{{ t('plugins.installed.disable') }}</BaseButton>
              <BaseButton variant="danger" size="sm" square @click="uninstallPlugin(p.cnrId || p.dirName, p.ver, p.title)"><MsIcon name="delete" /></BaseButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Browse Tab ===== -->
    <div v-show="activeTab === 'browse'">
      <SectionToolbar>
        <template #start>
          <FilterInput v-model="browseQuery" :placeholder="t('plugins.browse.search_placeholder')" style="flex:1;max-width:500px" />
          <span class="toolbar-status">{{ browseStats }}</span>
        </template>
        <template #end>
          <BaseButton size="sm" :disabled="browseLoading" @click="loadBrowse(true)">{{ t('common.btn.refresh') }}</BaseButton>
          <BaseSelect v-model="browseSort" :options="[
            { value: 'stars', label: t('plugins.browse.sort_stars') },
            { value: 'update', label: t('plugins.browse.sort_update') },
            { value: 'name', label: t('plugins.browse.sort_name') },
          ]" size="sm" fit />
        </template>
      </SectionToolbar>

      <AlertBanner v-if="browseError" tone="danger" dense>{{ browseError }}</AlertBanner>
      <LoadingCenter v-if="browseLoading && browseData.length === 0">{{ t('common.status.loading') }}</LoadingCenter>
      <EmptyState v-else-if="browseError && browseData.length === 0" icon="error" :message="browseError" />
      <EmptyState v-else-if="currentBrowsePage.length === 0" icon="search_off" :message="t('plugins.browse.no_match')" />
      <div v-else class="plugin-list">
        <div v-for="p in currentBrowsePage" :key="p.id" class="plugin-item">
          <div class="plugin-item-header">
            <div class="plugin-item-title">
              <a v-if="p.repository || p.reference" :href="p.repository || p.reference" target="_blank">{{ p.title || p.id }}</a>
              <span v-else>{{ p.title || p.id }}</span>
            </div>
            <span v-if="p.state === 'enabled'" class="plugin-badge installed">{{ t('plugins.browse.installed_badge') }}</span>
            <span v-else-if="p.state === 'disabled'" class="plugin-badge disabled">{{ t('plugins.browse.disabled_badge') }}</span>
            <span v-else class="plugin-badge not-installed">{{ t('plugins.browse.not_installed') }}</span>
          </div>
          <div v-if="p.description" class="plugin-item-desc">{{ p.description }}</div>
          <div class="plugin-item-meta">
            <span><MsIcon name="extension" /> {{ p.id }}</span>
            <span v-if="p.version">v{{ p.version }}</span>
            <span v-if="(p.stars ?? 0) > 0"><MsIcon name="star" /> {{ p.stars }}</span>
            <span v-if="p.author"><MsIcon name="person" /> {{ p.author }}</span>
            <span v-if="p._last_update"><MsIcon name="schedule" /> {{ p._last_update.slice(0, 10) }}</span>
            <div class="plugin-item-actions" v-if="!p.state || p.state === 'not-installed'">
              <BaseButton variant="primary" size="sm" @click="installPlugin(p.id)">{{ t('plugins.browse.install') }}</BaseButton>
              <BaseButton size="sm" @click="openVersionModal(p.id, p.title || p.id)">{{ t('plugins.installed.version') }}</BaseButton>
            </div>
            <span v-else style="font-size:.78rem;color:var(--green)"><MsIcon name="check_circle" /> {{ t('plugins.browse.already_installed') }}</span>
          </div>
        </div>
      </div>
      <div ref="browseListEnd" style="height:1px" />
    </div>

    <!-- ===== Git Tab ===== -->
    <div v-show="activeTab === 'git'">
      <BaseCard density="roomy">
        <h3 style="margin-bottom:12px;font-size:clamp(0.95rem,1.1vw,1.15rem)">
          <MsIcon name="link" /> {{ t('plugins.git.title') }}
        </h3>
        <p style="font-size:.82rem;color:var(--t2);margin-bottom:12px">{{ t('plugins.git.desc') }}</p>
        <FormField>
          <FieldControlRow>
            <input v-model="gitUrl" type="text" class="form-input" :placeholder="t('plugins.git.placeholder')" @keydown.enter="installFromGit">
            <BaseButton variant="primary" @click="installFromGit" :disabled="gitInstalling" style="padding:8px 20px">
              {{ gitInstalling ? t('plugins.git.installing_btn') : t('plugins.git.install') }}
            </BaseButton>
          </FieldControlRow>
        </FormField>
        <AlertBanner v-if="gitStatus" :tone="gitStatus.ok ? 'success' : 'danger'" dense>{{ gitStatus.message }}</AlertBanner>
      </BaseCard>
    </div>

    <!-- Version Modal -->
    <BaseModal v-model="versionModalOpen" :title="versionModalTitle" width="480px">
      <LoadingCenter v-if="versionLoading" />
      <EmptyState v-else-if="versionList.length === 0" density="compact" :message="t('plugins.version_picker.no_version_nightly')" />
      <div v-else style="max-height:50vh;overflow-y:auto">
        <div v-for="ver in versionList" :key="ver" class="version-row">
          <span>{{ ver }}</span>
          <BaseButton variant="primary" size="sm" @click="installVersion(ver)">{{ t('plugins.toast.install_version') }}</BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>


/* Vue-unique: queue processing indicator */
.queue-indicator { display: flex; align-items: center; gap: 6px; font-size: .78rem; color: var(--amber); margin-bottom: 8px; }

/* Vue-unique: plugin list flex container */
.plugin-list { display: flex; flex-direction: column; }

/* Vue-unique: version picker rows */
.version-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--bd); font-size: .88rem; }

/* ── Plugin Items ── */
.plugin-item { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: clamp(14px, 1.2vw, 20px) clamp(16px, 1.5vw, 24px); margin-bottom: clamp(8px, 0.6vw, 12px); transition: border-color .15s; }
.plugin-item:hover { border-color: rgba(124, 92, 252, .3); }
.plugin-item-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.plugin-item-title { font-size: .92rem; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-item-title a { color: var(--t1); text-decoration: none; }
.plugin-item-title a:hover { color: var(--ac); }
.plugin-item-desc { font-size: .8rem; color: var(--t2); line-height: 1.5; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.plugin-item-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: .75rem; color: var(--t3); }
.plugin-item-meta > span { display: inline-flex; align-items: center; gap: 4px; }
.plugin-item-actions { display: flex; gap: 6px; margin-left: auto; flex-shrink: 0; }
.plugin-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
.plugin-badge.installed { background: rgba(74, 222, 128, .15); color: var(--green); }
.plugin-badge.update { background: rgba(251, 191, 36, .15); color: var(--amber); }
.plugin-badge.disabled { background: rgba(152, 152, 176, .15); color: var(--t3); }
.plugin-badge.not-installed { background: rgba(96, 165, 250, .15); color: var(--blue); }
</style>
