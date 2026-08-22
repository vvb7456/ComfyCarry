<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { usePluginFiltering } from '@/composables/usePluginFiltering'
import { usePluginQueue } from '@/composables/usePluginQueue'
import { usePluginEvents } from '@/composables/usePluginEvents'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText, apiMessageText } from '@/utils/apiError'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import SectionToolbar from '@/components/ui/SectionToolbar.vue'
import FilterInput from '@/components/ui/FilterInput.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import UnsavedBanner from '@/components/ui/UnsavedBanner.vue'
import PluginCard from './PluginCard.vue'
import GitInstallModal from './GitInstallModal.vue'
import type {
  AvailablePluginsResponse,
  CMQueueStatusData,
  InstalledRaw,
  PendingRestartPack,
  PendingRestartResponse,
  PluginActionResponse,
  PluginData,
  PluginInfo,
} from '@/types/plugins'

defineOptions({ name: 'PluginsTab' })

const props = defineProps<{
  online?: boolean
  active?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const loading = ref(false)
const error = ref('')
const loaded = ref(false)
let getlistCache: Record<string, PluginInfo> = {}

const gitModalOpen = ref(false)
const versionModalOpen = ref(false)
const versionModalTitle = ref('')
const versionModalId = ref('')
const versionList = ref<string[]>([])
const versionLoading = ref(false)

// ── 待重启事实 (服务端 diff: 启动快照 vs 当前磁盘) ──────────
const pendingRestart = ref<PendingRestartPack[]>([])
const restartDismissed = ref(false)
const restarting = ref(false)
const pendingIds = computed(() => new Set(pendingRestart.value.map(p => p.id)))

// ── 行级操作状态: uiId → { id, op, ts } ─────────────────────
// ts 用于 onIdle 兜底清理时的宽限判断 (SSE done 丢失时防永久 spinner)
type OpKind = 'install' | 'uninstall' | 'update' | 'toggle'
const activeOps = ref<Record<string, { id: string, op: OpKind, ts: number }>>({})
const rowErrors = ref<Record<string, string>>({})

function genUiId(): string {
  return crypto?.randomUUID?.() ?? `dash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function rowOp(id: string): OpKind | undefined {
  for (const op of Object.values(activeOps.value)) {
    if (op.id === id) return op.op
  }
  return undefined
}

/** SSE 断线等导致 done 事件丢失时, 队列空闲后清理超时未决的操作标记 */
function clearStaleOps() {
  const now = Date.now()
  for (const [uiId, op] of Object.entries(activeOps.value)) {
    if (now - op.ts > 15000) delete activeOps.value[uiId]
  }
}

// ── Manager 队列事件 (bridge 转发的 cm-queue-status) ────────
function onQueueEvent(data: CMQueueStatusData) {
  if (data.status !== 'done') return
  const result = data.nodepack_result || {}
  if (Object.keys(result).length === 0) return
  for (const [uiId, res] of Object.entries(result)) {
    const op = activeOps.value[uiId]
    if (!op) continue // 非本页发起的操作 (向导页/Git 弹窗等)
    delete activeOps.value[uiId]
    if (res !== 'success' && res !== 'skip') {
      rowErrors.value[op.id] = res
    }
  }
  restartDismissed.value = false
  loadData()
}

const { start: startEvents, stop: stopEvents } = usePluginEvents(onQueueEvent)

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
  onIdle: () => { clearStaleOps(); return loadData() },
})

async function loadData(force = false) {
  // force: restartNow 在 ComfyUI 恢复后立即调用, 此时父组件的 online prop 可能
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
    loaded.value = true
  } finally {
    loading.value = false
  }
}

function activateWorkspace() {
  if (!props.active || props.online === false) return
  // 每次激活都全量刷新: pending_restart 是服务端事实, 若只在首次加载时拉取,
  // 用户从别处重启 ComfyUI (参数页/手动) 后回到本页会看到陈旧的横幅状态
  loadData()
  pollQueue()
  startEvents()
}

onMounted(activateWorkspace)
watch([() => props.active, () => props.online], ([active]) => {
  if (active) activateWorkspace()
  else stopEvents()
})

// diff 从无到有 (新变更完成) 时重新亮横幅, 覆盖之前的"稍后"
watch(pendingRestart, (now, prev) => {
  if (now.length > 0 && prev.length === 0) restartDismissed.value = false
})

// ── 操作提交 ────────────────────────────────────────────────
async function submitOp(op: OpKind, endpoint: string, payload: Record<string, unknown>) {
  const id = String(payload.id ?? '')
  const uiId = genUiId()
  payload.ui_id = uiId
  activeOps.value[uiId] = { id, op, ts: Date.now() }
  delete rowErrors.value[id]
  const d = await post<PluginActionResponse>(endpoint, payload)
  if (d?.ok) {
    toast(apiMessageText(d), 'success')
    startQueuePoll()
  } else {
    delete activeOps.value[uiId]
  }
}

async function installPlugin(id: string, version = 'latest') {
  toast(t('plugins.toast.installing_name', { id }), 'info')
  const pack = getlistCache[id] || {}
  const payload: Record<string, unknown> = { id, version: pack.version || 'unknown', selected_version: version }
  if (pack.files) payload.files = pack.files
  if (pack.repository || pack.reference) payload.repository = pack.repository || pack.reference
  await submitOp('install', '/api/plugins/install', payload)
}

async function uninstallPlugin(p: PluginData) {
  if (!await confirm({ message: t('plugins.confirm.uninstall_name', { title: p.title || p.id }), variant: 'danger' })) return
  await submitOp('uninstall', '/api/plugins/uninstall', {
    id: p.id,
    version: p.ver,
    // Manager 在 version=="unknown" 时用 files[0] 的 basename 推导目录名;
    // 传目录名/仓库地址兜底, 避免上游 KeyError
    files: p.ver === 'unknown' ? [p.repository || p.dirName] : undefined,
  })
}

async function updatePlugin(p: PluginData) {
  await submitOp('update', '/api/plugins/update', { id: p.id, version: p.ver })
}

async function togglePlugin(p: PluginData) {
  // Manager 无 enable 端点: 启用走 /enable (install+skip_post_install), 禁用走 /disable
  const target = p.enabled ? 'disable' : 'enable'
  await submitOp('toggle', `/api/plugins/${target}`, {
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

// ── 重启 ComfyUI 使变更生效 ─────────────────────────────────
async function restartNow() {
  if (restarting.value) return
  restarting.value = true
  try {
    const d = await post<PluginActionResponse>('/api/comfyui/restart', {})
    if (!d?.ok) {
      toast(apiErrorText(d) || t('plugins.restart.restarting'), 'error')
      return
    }
    toast(t('plugins.restart.restarting'), 'info')
    // 有界轮询等待恢复在线 (冷启动加载 custom_nodes 可能 30s+); 上限 3 分钟
    let backOnline = false
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const s = await get<{ online?: boolean }>('/api/comfyui/status')
      if (s?.online) { backOnline = true; break }
    }
    await loadData(true)
    if (backOnline) {
      toast(t('plugins.restart.done'), 'success')
    } else {
      toast(t('plugins.restart.timeout'), 'error')
    }
  } finally {
    restarting.value = false
  }
}
</script>

<template>
  <EmptyState
    v-if="online === false && !restarting"
    icon="cloud_off"
    :title="t('comfyui.plugins.offline_title')"
    :message="t('comfyui.plugins.offline_desc')"
  />

  <!-- banner 发起的重启: 停机是预期内的, 显示等待态而不是"未运行" -->
  <LoadingCenter v-else-if="restarting" size="lg">{{ t('plugins.restart.restarting') }}</LoadingCenter>

  <template v-else>
    <UnsavedBanner
      :visible="pendingRestart.length > 0 && !restartDismissed"
      :message="t('plugins.restart.banner_msg')"
      :save-label="t('plugins.restart.now')"
      :discard-label="t('plugins.restart.later')"
      :saving="restarting"
      @save="restartNow"
      @discard="restartDismissed = true"
    />

    <SectionToolbar>
      <template #start>
        <FilterInput v-model="filter" :placeholder="t('plugins.browse.search_placeholder')" />
        <span class="toolbar-status">
          {{ stats }}
          <template v-if="queueProcessing">
            &nbsp;· <MsIcon name="hourglass_top" /> {{ queueStatus }}
          </template>
        </span>
      </template>
      <template #end>
        <BaseButton size="sm" :disabled="loading" @click="() => loadData()">{{ t('plugins.installed.refresh') }}</BaseButton>
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

    <AlertBanner v-if="error" tone="danger" dense>{{ error }}</AlertBanner>
    <LoadingCenter v-if="loading && unifiedPlugins.length === 0">{{ t('common.status.loading') }}</LoadingCenter>
    <EmptyState v-else-if="currentPage.length === 0" icon="search_off" :message="t('plugins.installed.no_match')" />
    <div v-else class="plugin-list">
      <PluginCard
        v-for="p in currentPage"
        :key="p.id"
        :plugin="p"
        :op="rowOp(p.id)"
        :error="rowErrors[p.id]"
        :pending="pendingIds.has(p.id)"
        @install="installPlugin(p.id)"
        @uninstall="uninstallPlugin(p)"
        @update="updatePlugin(p)"
        @toggle="togglePlugin(p)"
        @version="openVersionModal(p.id, p.title)"
      />
    </div>
    <div ref="listEndEl" class="plugins-list-end" />
  </template>

  <GitInstallModal v-model="gitModalOpen" @installed="startQueuePoll" />

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
.plugin-list { display: flex; flex-direction: column; }
.plugins-list-end { height: 1px; }
.version-list { max-height: 50vh; overflow-y: auto; }
.version-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--bd); font-size: .88rem; }
</style>
