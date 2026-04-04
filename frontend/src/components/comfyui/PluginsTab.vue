<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { usePluginFiltering } from '@/composables/usePluginFiltering'
import { usePluginQueue } from '@/composables/usePluginQueue'
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
import type {
  AvailablePluginsResponse,
  InstalledRaw,
  PluginActionResponse,
  PluginData,
  PluginInfo,
} from '@/types/plugins'

defineOptions({ name: 'PluginsTab' })

const props = defineProps<{
  online?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// ── State ──
const loading = ref(false)
const error = ref('')
let getlistCache: Record<string, PluginInfo> = {}

// Modals
const gitModalOpen = ref(false)
const versionModalOpen = ref(false)
const versionModalTitle = ref('')
const versionModalId = ref('')
const versionList = ref<string[]>([])
const versionLoading = ref(false)

const {
  filter,
  statusFilter,
  sortBy,
  listEndEl,
  unifiedPlugins,
  filteredPlugins,
  currentPage,
  setAvailablePlugins,
  setInstalledPlugins,
} = usePluginFiltering()
const stats = computed(() => t('plugins.browse.stats_text', { count: filteredPlugins.value.length }))
const {
  queueProcessing,
  queueStatus,
  pollQueue,
  startQueuePoll,
} = usePluginQueue({
  get,
  formatStatus: (done, total) => t('plugins.queue.status', { done, total }),
  onIdle: loadData,
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
      getlistCache = setAvailablePlugins(availableData)
    }

    if (!installedData) {
      error.value = t('plugins.installed.load_failed')
      return
    }

    setInstalledPlugins(installedData, getlistCache)
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
  if (val && unifiedPlugins.value.length === 0) {
    loadData()
    pollQueue()
  }
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
</script>

<template>
  <SectionToolbar>
    <template #start>
      <FilterInput v-model="filter" :placeholder="t('plugins.browse.search_placeholder')" class="plugins-filter-input" />
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
  <div ref="listEndEl" class="plugins-list-end" />

  <!-- Git Install Modal -->
  <GitInstallModal v-model="gitModalOpen" @installed="startQueuePoll" />

  <!-- Version Picker Modal -->
  <BaseModal v-model="versionModalOpen" :title="versionModalTitle" width="480px">
    <LoadingCenter v-if="versionLoading" />
    <EmptyState v-else-if="versionList.length === 0" density="compact" :message="t('plugins.version_picker.no_version_nightly')" />
    <div v-else class="version-list">
      <div v-for="ver in versionList" :key="ver" class="version-row">
        <span>{{ ver }}</span>
        <BaseButton variant="primary" size="sm" @click="installVersion(ver)">{{ t('plugins.toast.install_version') }}</BaseButton>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.plugins-filter-input {
  flex: 1;
  max-width: 400px;
}

.plugin-list { display: flex; flex-direction: column; }
.plugins-list-end { height: 1px; }
.version-list { max-height: 50vh; overflow-y: auto; }
.version-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--bd); font-size: .88rem; }
</style>
