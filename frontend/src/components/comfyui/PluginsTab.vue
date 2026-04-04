<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import FilterInput from '@/components/ui/FilterInput.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import PluginCard from './PluginCard.vue'
import GitInstallModal from './GitInstallModal.vue'
import type { PluginData } from './PluginCard.vue'
import type {
  InstalledRaw, PluginInfo, BrowseItem,
  PluginActionResponse, QueueStatusResponse,
} from '@/types/plugins'

defineOptions({ name: 'PluginsTab' })

const props = defineProps<{
  online?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// ── Internal installed type ──
interface InstalledPlugin {
  cnrId: string; dirName: string; title: string; description: string
  repository: string; author: string; stars: number; ver: string
  activeVersion: string; cnrLatest: string; enabled: boolean; updateState: boolean
}

// ── State ──
const loading = ref(false)
const error = ref('')
const filter = ref('')
const statusFilter = ref('all')
const sortBy = ref('stars')

const installedPlugins = ref<InstalledPlugin[]>([])
const browseItems = ref<BrowseItem[]>([])
let getlistCache: Record<string, PluginInfo> = {}

const PAGE_SIZE = 40
const browseStart = ref(PAGE_SIZE)
const listEndEl = ref<HTMLElement | null>(null)
let _io: IntersectionObserver | null = null

// Queue
const queueProcessing = ref(false)
const queueStatus = ref('')
let queuePollTimer: ReturnType<typeof setInterval> | null = null

// Modals
const gitModalOpen = ref(false)
const versionModalOpen = ref(false)
const versionModalTitle = ref('')
const versionModalId = ref('')
const versionList = ref<string[]>([])
const versionLoading = ref(false)

// ── Helpers (from original PluginsPage) ──
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

// ── Unified data ──
const unifiedPlugins = computed<PluginData[]>(() => {
  const installedMap = new Map(installedPlugins.value.map(p => [p.cnrId, p]))
  const seen = new Set<string>()
  const result: PluginData[] = []

  // From browse data (available plugins)
  for (const b of browseItems.value) {
    seen.add(b.id)
    const inst = installedMap.get(b.id)
    result.push({
      id: b.id,
      dirName: inst?.dirName || '',
      title: b.title || b.id,
      description: b.description || '',
      repository: b.repository || b.reference || '',
      author: b.author || inst?.author || '',
      stars: b.stars ?? inst?.stars ?? 0,
      ver: inst?.ver || '',
      activeVersion: inst?.activeVersion || '',
      cnrLatest: inst?.cnrLatest || '',
      registryVersion: b.version || '',
      enabled: inst?.enabled ?? false,
      installed: !!inst || b.state === 'enabled' || b.state === 'disabled',
      updateState: inst?.updateState ?? false,
      lastUpdate: b._last_update || '',
    })
  }

  // Installed-only plugins not in browse data
  for (const p of installedPlugins.value) {
    const key = p.cnrId || p.dirName
    if (!seen.has(key)) {
      seen.add(key)
      result.push({
        id: p.cnrId || p.dirName,
        dirName: p.dirName,
        title: p.title,
        description: p.description,
        repository: p.repository,
        author: p.author,
        stars: p.stars,
        ver: p.ver,
        activeVersion: p.activeVersion,
        cnrLatest: p.cnrLatest,
        registryVersion: '',
        enabled: p.enabled,
        installed: true,
        updateState: p.updateState,
        lastUpdate: '',
      })
    }
  }

  return result
})

// ── Filtered & sorted ──
const filteredPlugins = computed<PluginData[]>(() => {
  const q = filter.value.toLowerCase().trim()
  const sf = statusFilter.value
  const _title = (p: PluginData) => p.title.toLowerCase()
  const _desc = (p: PluginData) => p.description.toLowerCase()
  let result = unifiedPlugins.value

  if (q) result = result.filter(p => _title(p).includes(q) || _desc(p).includes(q) || p.id.includes(q))

  if (sf === 'installed') result = result.filter(p => p.installed && p.enabled)
  else if (sf === 'not-installed') result = result.filter(p => !p.installed)
  else if (sf === 'update') result = result.filter(p => p.updateState)
  else if (sf === 'disabled') result = result.filter(p => p.installed && !p.enabled)

  if (sortBy.value === 'stars') return [...result].sort((a, b) => (b.stars || 0) - (a.stars || 0))
  if (sortBy.value === 'update') return [...result].sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate))
  return [...result].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
})

const currentPage = computed(() => filteredPlugins.value.slice(0, browseStart.value))
const stats = computed(() => t('plugins.browse.stats_text', { count: filteredPlugins.value.length }))

// Reset pagination on filter/sort change
watch([filter, statusFilter, sortBy], () => { browseStart.value = PAGE_SIZE })

// Infinite scroll sentinel
watch(listEndEl, (el) => {
  if (_io) { _io.disconnect(); _io = null }
  if (!el) return
  _io = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && browseStart.value < filteredPlugins.value.length) {
      browseStart.value += PAGE_SIZE
    }
  }, { rootMargin: '300px' })
  _io.observe(el)
})

// ── Data loading ──
async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const [installedData, availableData] = await Promise.all([
      get<Record<string, InstalledRaw>>('/api/plugins/installed'),
      get<AvailablePluginsResponse>('/api/plugins/available'),
    ])

    if (availableData) {
      const unpacked = unpackAvailablePlugins(availableData)
      getlistCache = unpacked
      browseItems.value = toBrowseItems(unpacked)
    }

    if (!installedData) {
      error.value = t('plugins.installed.load_failed')
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
    loading.value = false
  }
}

onMounted(() => {
  if (props.online !== false) {
    loadData()
    pollQueue()
  }
})

// Auto-load when coming online
watch(() => props.online, (val) => {
  if (val && installedPlugins.value.length === 0) {
    loadData()
    pollQueue()
  }
})

onUnmounted(() => {
  stopQueuePoll()
  if (_io) { _io.disconnect(); _io = null }
})

// ── Plugin actions ──
async function installPlugin(id: string, version = 'latest') {
  toast(t('plugins.toast.installing_name', { id }), 'info')
  const pack = getlistCache[id] || {}
  const payload: Record<string, unknown> = { id, version: pack.version || 'unknown', selected_version: version }
  if (pack.files) payload.files = pack.files
  if (pack.repository || pack.reference) payload.repository = pack.repository || pack.reference
  const d = await post<PluginActionResponse>('/api/plugins/install', payload)
  if (d?.message) { toast(d.message, 'success'); startQueuePoll() }
}

async function uninstallPlugin(p: PluginData) {
  if (!await confirm({ message: t('plugins.confirm.uninstall_name', { title: p.title || p.id }), variant: 'danger' })) return
  const d = await post<PluginActionResponse>('/api/plugins/uninstall', { id: p.id, version: p.ver })
  if (d?.message) { toast(d.message, 'success'); startQueuePoll() }
}

async function updatePlugin(p: PluginData) {
  const d = await post<PluginActionResponse>('/api/plugins/update', { id: p.id, version: p.ver })
  if (d?.message) { toast(d.message, 'success'); startQueuePoll() }
}

async function togglePlugin(p: PluginData) {
  const d = await post<PluginActionResponse>('/api/plugins/disable', { id: p.id, version: p.ver })
  if (d?.message) { toast(d.message, 'success'); startQueuePoll() }
}

// ── Version modal ──
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

// ── Queue polling ──
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
      loadData()
    }
  }
}
</script>

<template>
  <SectionToolbar>
    <template #start>
      <FilterInput v-model="filter" :placeholder="t('plugins.browse.search_placeholder')" style="flex:1;max-width:400px" />
      <span class="toolbar-status">
        {{ stats }}
        <template v-if="queueProcessing">
          &nbsp;· <MsIcon name="hourglass_top" /> {{ queueStatus }}
        </template>
      </span>
    </template>
    <template #end>
      <BaseButton size="sm" :disabled="loading" @click="loadData">{{ t('plugins.installed.refresh') }}</BaseButton>
      <BaseButton size="sm" @click="gitModalOpen = true"><MsIcon name="link" /> {{ t('plugins.tabs.git') }}</BaseButton>
      <BaseSelect v-model="statusFilter" :options="[
        { value: 'all', label: t('plugins.installed.all_status') },
        { value: 'installed', label: t('plugins.installed.enabled') },
        { value: 'not-installed', label: t('plugins.browse.not_installed') },
        { value: 'update', label: t('plugins.installed.has_update') },
        { value: 'disabled', label: t('plugins.installed.disabled') },
      ]" size="sm" fit />
      <BaseSelect v-model="sortBy" :options="[
        { value: 'stars', label: t('plugins.browse.sort_stars') },
        { value: 'update', label: t('plugins.browse.sort_update') },
        { value: 'name', label: t('plugins.browse.sort_name') },
      ]" size="sm" fit />
    </template>
  </SectionToolbar>

  <AlertBanner v-if="error" tone="danger" dense>{{ error }}</AlertBanner>
  <LoadingCenter v-if="loading && unifiedPlugins.length === 0">{{ t('common.status.loading') }}</LoadingCenter>
  <EmptyState v-else-if="currentPage.length === 0" icon="search_off" :message="t('plugins.installed.no_match')" />
  <div v-else class="plugin-list">
    <PluginCard
      v-for="p in currentPage"
      :key="p.id"
      :plugin="p"
      @install="installPlugin(p.id)"
      @uninstall="uninstallPlugin(p)"
      @update="updatePlugin(p)"
      @toggle="togglePlugin(p)"
      @version="openVersionModal(p.id, p.title)"
    />
  </div>
  <div ref="listEndEl" style="height:1px" />

  <!-- Git Install Modal -->
  <GitInstallModal v-model="gitModalOpen" @installed="startQueuePoll" />

  <!-- Version Picker Modal -->
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
</template>

<style scoped>
.plugin-list { display: flex; flex-direction: column; }
.version-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--bd); font-size: .88rem; }
</style>
