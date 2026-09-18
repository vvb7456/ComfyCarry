<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { usePluginFiltering } from '@/composables/usePluginFiltering'
import { useToast } from '@/composables/useToast'
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
import PluginOpModal, { type PluginOpRequest } from './PluginOpModal.vue'
import type {
  AvailablePluginsResponse,
  InstalledRaw,
  PendingRestartPack,
  PendingRestartResponse,
  PluginData,
  PluginInfo,
} from '@/types/plugins'

defineOptions({ name: 'PluginsTab' })

const props = defineProps<{
  online?: boolean
  active?: boolean
  toolbarTarget?: HTMLElement | null
}>()

const { t } = useI18n({ useScope: 'global' })
const { get } = useApiFetch()
const { toast } = useToast()

const loading = ref(false)
const error = ref('')
let getlistCache: Record<string, PluginInfo> = {}

const versionModalOpen = ref(false)
const versionModalTitle = ref('')
const versionModalId = ref('')
const versionList = ref<string[]>([])
const versionLoading = ref(false)
const selectedVersion = ref('')

const versionOptions = computed(() =>
  versionList.value.map(v => ({ value: v, label: v })),
)

// ── 待重启事实 (服务端 diff: 启动快照 vs 当前磁盘) ──────────
// 卡片"待重启"角标; 提醒与重启动作由 PluginOpModal 在操作完成时接手。
const pendingRestart = ref<PendingRestartPack[]>([])
const pendingIds = computed(() => new Set(pendingRestart.value.map(p => p.id)))

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

async function loadData(force = false) {
  // force: PluginOpModal 重启完成后可能立即调用, 此时父组件的 online prop 可能
  // 还停留在停机期 (10s 轮询滞后), 不能因陈旧的 offline 状态放弃刷新
  if (!force && (loading.value || props.online === false)) return
  loading.value = true
  error.value = ''
  try {
    const [installedData, availableData, prData] = await Promise.all([
      get<Record<string, InstalledRaw>>('/api/plugins/installed'),
      get<AvailablePluginsResponse>('/api/plugins/available'),
      get<PendingRestartResponse>('/api/plugins/pending_restart'),
    ])
    pendingRestart.value = prData?.packs ?? []

    if (availableData) getlistCache = setAvailablePlugins(availableData)
    if (!installedData) {
      error.value = t('plugins.installed.load_failed')
      return
    }

    setInstalledPlugins(installedData, getlistCache)
  } finally {
    loading.value = false
  }
}

function activateWorkspace() {
  if (!props.active || props.online === false) return
  // 每次激活都全量刷新: pending_restart 是服务端事实, 若只在首次加载时拉取,
  // 用户从别处重启 ComfyUI (参数页/手动) 后回到本页会看到陈旧的角标状态
  loadData()
}

onMounted(activateWorkspace)
watch([() => props.active, () => props.online], ([active]) => {
  if (active) activateWorkspace()
})

// ── 阻塞执行弹窗: 所有插件操作统一走这里 (confirm → 执行 → 结果) ──

const opModal = ref<InstanceType<typeof PluginOpModal> | null>(null)
const opModalOpen = ref(false)

function submitOp(kind: PluginOpRequest['kind'], title: string, endpoint: string, payload: Record<string, unknown>) {
  void opModal.value?.open({ kind, title, endpoint, payload })
}

/** 弹窗收尾 (含后台继续): 刷新列表与待重启角标 */
function onOpFinished(_ok: boolean) {
  void loadData(true)
}

async function installPlugin(id: string, version = 'latest') {
  const pack = getlistCache[id] || {}
  const title = pack.title || id
  const payload: Record<string, unknown> = { id, version: pack.version || 'unknown', selected_version: version }
  if (pack.files) payload.files = pack.files
  if (pack.repository || pack.reference) payload.repository = pack.repository || pack.reference
  submitOp('install', title, '/api/plugins/install', payload)
}

async function uninstallPlugin(p: PluginData) {
  submitOp('uninstall', p.title || p.id, '/api/plugins/uninstall', {
    id: p.id,
    version: p.ver,
    // Manager 在 version=="unknown" 时用 files[0] 的 basename 推导目录名;
    // 传目录名/仓库地址兜底, 避免上游 KeyError
    files: p.ver === 'unknown' ? [p.repository || p.dirName] : undefined,
  })
}

async function updatePlugin(p: PluginData) {
  submitOp('update', p.title || p.id, '/api/plugins/update', { id: p.id, version: p.ver })
}

async function togglePlugin(p: PluginData) {
  // Manager 无 enable 端点: 启用走 /enable (install+skip_post_install), 禁用走 /disable
  const target = p.enabled ? 'disable' : 'enable'
  submitOp('toggle', p.title || p.id, `/api/plugins/${target}`, {
    id: p.id,
    version: p.ver,
    files: p.ver === 'unknown' ? [p.repository || p.dirName] : undefined,
  })
}

async function openVersionModal(id: string, title: string) {
  versionModalId.value = id
  versionModalTitle.value = t('plugins.version_picker.title_name', { name: title || id })
  versionModalOpen.value = true
  versionLoading.value = true
  versionList.value = []
  selectedVersion.value = ''
  const versions = await get<(string | Record<string, string>)[]>(`/api/plugins/versions/${encodeURIComponent(id)}`)
  if (versions) {
    versionList.value = versions.map(v => typeof v === 'string' ? v : v.version || JSON.stringify(v))
    selectedVersion.value = versionList.value[0] ?? ''
  }
  versionLoading.value = false
}

function installVersion(version: string) {
  versionModalOpen.value = false
  void installPlugin(versionModalId.value, version)
}

// ── Git 安装: URL 收集 → 阻塞执行弹窗 ────────────────────────

const gitModalOpen = ref(false)
const gitUrl = ref('')

function submitGitInstall() {
  const url = gitUrl.value.trim()
  if (!url.startsWith('http')) {
    toast(t('plugins.git.invalid_url'), 'warning')
    return
  }
  gitModalOpen.value = false
  submitOp('git', url, '/api/plugins/install_git', { url })
}
</script>

<template>
  <EmptyState
    v-if="online === false"
    icon="cloud_off"
    :title="t('comfyui.plugins.offline_title')"
    :message="t('comfyui.plugins.offline_desc')"
  />

  <template v-else>
    <Teleport :to="toolbarTarget || 'body'" :disabled="!toolbarTarget || !active">
      <SectionToolbar>
        <template #start>
          <FilterInput v-model="filter" :placeholder="t('plugins.browse.search_placeholder')" />
          <span class="toolbar-status">
            {{ stats }}
          </span>
        </template>
        <template #end>
          <BaseButton variant="ghost" size="sm" icon-only :aria-label="t('plugins.installed.refresh')" :disabled="loading" @click="() => loadData()">
            <MsIcon name="refresh" />
          </BaseButton>
          <BaseButton size="sm" @click="gitModalOpen = true"><MsIcon name="link" /> {{ t('plugins.tabs.git') }}</BaseButton>
          <BaseSelect v-model="statusFilter" :options="[
            { value: 'all', label: t('plugins.installed.all_status') },
            { value: 'installed', label: t('plugins.installed.installed_badge') },
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
    </Teleport>

    <AlertBanner v-if="error" tone="danger" dense>{{ error }}</AlertBanner>
    <LoadingCenter v-if="loading && unifiedPlugins.length === 0">{{ t('common.status.loading') }}</LoadingCenter>
    <EmptyState v-else-if="currentPage.length === 0" icon="search_off" :message="t('plugins.installed.no_match')" />
    <ul v-else class="list-plain">
      <PluginCard
        v-for="p in currentPage"
        :key="p.id"
        :plugin="p"
        :pending="pendingIds.has(p.id)"
        @install="installPlugin(p.id)"
        @uninstall="uninstallPlugin(p)"
        @update="updatePlugin(p)"
        @toggle="togglePlugin(p)"
        @version="openVersionModal(p.id, p.title)"
      />
    </ul>
    <div :ref="(el) => { listEndEl = (el as HTMLElement | null) }" class="plugins-list-end" />
  </template>

  <!-- Git URL 收集弹窗: 提交转阻塞执行弹窗 -->
  <BaseModal v-model="gitModalOpen" :title="t('plugins.git.title')" width="560px">
    <p style="font-size:.82rem;color:var(--t2);margin-bottom:12px">
      <MsIcon name="link" /> {{ t('plugins.git.desc') }}
    </p>
    <form class="git-row" @submit.prevent="submitGitInstall">
      <input v-model="gitUrl" type="text" class="form-input" :placeholder="t('plugins.git.placeholder')">
      <BaseButton variant="primary" type="submit" style="padding:8px 20px" :disabled="!gitUrl.trim().startsWith('http')">
        {{ t('plugins.git.install') }}
      </BaseButton>
    </form>
  </BaseModal>

  <!-- 版本选择弹窗 -->
  <BaseModal v-model="versionModalOpen" :title="versionModalTitle" width="520px">
    <LoadingCenter v-if="versionLoading" />
    <EmptyState v-else-if="versionList.length === 0" density="compact" :message="t('plugins.version_picker.no_version_nightly')" />
    <BaseSelect
      v-else
      v-model="selectedVersion"
      :options="versionOptions"
      :placeholder="t('plugins.version_picker.placeholder')"
      :search-placeholder="t('plugins.version_picker.search')"
      :empty-text="t('plugins.version_picker.empty')"
      :max-list-height="260"
      searchable
      teleport
    />
    <template #footer>
      <BaseButton @click="versionModalOpen = false">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton variant="primary" :disabled="!selectedVersion" @click="installVersion(selectedVersion)">
        {{ t('plugins.msg.install_version') }}
      </BaseButton>
    </template>
  </BaseModal>

  <!-- 阻塞执行弹窗 (常驻挂载; open() 由操作触发) -->
  <PluginOpModal ref="opModal" v-model="opModalOpen" @finished="onOpFinished" />
</template>

<style scoped>
.plugins-list-end { height: 1px; }

.git-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.git-row .form-input { flex: 1; }
</style>