<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import ConsoleSection from '@/components/comfyui/ConsoleSection.vue'
import ParamsCard from '@/components/comfyui/ParamsCard.vue'
import PluginsTab from '@/components/comfyui/PluginsTab.vue'
import type { ComfyStatus } from '@/types/comfyui'

defineOptions({ name: 'ComfyUIPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// 页面按用户任务划分为三个稳定工作区。插件目录是浏览目的地，不是临时任务抽屉。
const activeTab = ref('overview')
const tabs = computed(() => [
  { key: 'overview', label: t('comfyui.tabs.overview'), icon: 'monitoring' },
  { key: 'settings', label: t('comfyui.tabs.settings'), icon: 'tune' },
  { key: 'plugins', label: t('comfyui.tabs.plugins'), icon: 'extension' },
])

// Status (shared - used in header badge + ConsoleSection)
const status = ref<ComfyStatus | null>(null)

// 页头「打开 ComfyUI」链接。地址只有隧道配好之后才存在 (后端不提供本地直连兜底:
// 端口可配、RunPod 又在反代后面), 解析不出来时标题就退回纯文本。
const comfyUrl = ref('')

async function loadComfyUrl() {
  const d = await get<{ urls?: Record<string, string>; public?: { urls?: Record<string, string> } }>(
    '/api/tunnel/status',
  )
  const urls: Record<string, string> = { ...(d?.urls || {}), ...(d?.public?.urls || {}) }
  const hit = Object.entries(urls).find(([name]) => name.toLowerCase().includes('comfyui'))
  comfyUrl.value = hit ? hit[1] : ''
}

// Exec + SSE (shared - used for toasts + ConsoleSection progress bar)
const tracker = useExecTracker()
const execState = computed(() => tracker.state.value)

const paramsRef = ref<InstanceType<typeof ParamsCard> | null>(null)

const sse = useComfySSE(tracker, {
  onEvent(evt, result) {
    if (result?.finished) {
      if (result.type === 'execution_done') {
        const elapsed = result.data?.elapsed ? ` (${result.data.elapsed}s)` : ''
        toast(`${t('comfyui.toast.gen_complete')}${elapsed}`, 'success')
        loadStatus()
      } else if (result.type === 'execution_interrupted') {
        toast(t('comfyui.toast.exec_interrupted'), 'warning')
      }
    }
  },
})

const refresh = useAutoRefresh(loadStatus, 10000)

onMounted(() => {
  loadStatus()
  loadComfyUrl()
  refresh.start({ immediate: false })
  sse.start()
})

onUnmounted(() => {
  refresh.stop()
  sse.stop()
})

async function loadStatus() {
  const d = await get<ComfyStatus>('/api/comfyui/status')
  if (d) status.value = d
}

// Header actions
async function comfyStart() {
  if (!await post('/api/services/comfy/start')) return
  toast(t('comfyui.toast.starting'), 'info')
  setTimeout(() => { loadStatus(); paramsRef.value?.loadParams() }, 3000)
}

async function comfyStop() {
  if (!await confirm({ message: t('comfyui.confirm.stop') })) return
  if (!await post('/api/services/comfy/stop')) return
  toast(t('comfyui.toast.stopped'), 'success')
  setTimeout(loadStatus, 1000)
}

async function comfyRestart() {
  if (!await confirm({ message: t('comfyui.confirm.restart') })) return
  // saveParams(false) 走 POST /api/comfyui/params, 后端 restart_comfyui 做
  // pm2 delete + start --log (清 pm2 环境变量让 --log 生效)。
  // 不能再额外调 /api/services/comfy/restart (pm2 restart 会丢 --log)。
  if (!await paramsRef.value?.saveParams(false)) return
  toast(t('comfyui.toast.restarting'), 'info')
  setTimeout(() => { loadStatus(); paramsRef.value?.loadParams() }, 5000)
}
</script>

<template>
  <PageHeader
    :title="t('comfyui.title')"
    :service="status ? {
      status: status.pm2_status === 'online' ? 'running' : 'stopped',
      label: status.pm2_status === 'online' ? t('comfyui.status.running') : t('comfyui.status.stopped'),
    } : undefined"
    :launch="comfyUrl && status?.online
      ? { href: comfyUrl, label: t('comfyui.open') }
      : undefined"
  >
    <template #actions>
      <span v-if="status">
        <template v-if="status.online">
          <BaseButton @click="comfyStop"><MsIcon name="stop" /> {{ t('common.btn.stop') }}</BaseButton>
          <BaseButton @click="comfyRestart"><MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}</BaseButton>
        </template>
        <BaseButton v-else @click="comfyStart"><MsIcon name="play_arrow" /> {{ t('common.btn.start') }}</BaseButton>
      </span>
    </template>
  </PageHeader>

  <div class="page-body">
    <TabSwitcher v-model="activeTab" :tabs="tabs" />

    <div v-show="activeTab === 'overview'">
      <ConsoleSection
        :status="status"
        :exec-state="execState"
        :elapsed="tracker.elapsed.value"
      />
    </div>

    <div v-show="activeTab === 'settings'" class="settings-workspace">
      <ParamsCard ref="paramsRef" :active="activeTab === 'settings'" />
    </div>

    <div v-show="activeTab === 'plugins'">
      <PluginsTab :online="status?.online" :active="activeTab === 'plugins'" />
    </div>
  </div>
</template>

<style scoped>
.settings-workspace {
  display: grid;
  gap: var(--sp-4);
  width: 100%;
}
</style>
