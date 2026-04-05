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
import HeaderStatusBadge from '@/components/layout/HeaderStatusBadge.vue'
import ConsoleTab from '@/components/comfyui/ConsoleTab.vue'
import SettingsTab from '@/components/comfyui/SettingsTab.vue'
import PluginsTab from '@/components/comfyui/PluginsTab.vue'
import type { ComfyStatus } from '@/types/comfyui'

defineOptions({ name: 'ComfyUIPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// Tabs
const activeTab = ref('console')
const comfyTabs = computed(() => [
  { key: 'console', label: t('comfyui.tabs.console'), icon: 'terminal' },
  { key: 'plugins', label: t('comfyui.tabs.plugins'), icon: 'package_2' },
  { key: 'settings', label: t('comfyui.tabs.settings'), icon: 'settings' },
])

// Status (shared — used in header badge + ConsoleTab)
const status = ref<ComfyStatus | null>(null)

// Exec + SSE (shared — used for toasts + ConsoleTab progress bar)
const tracker = useExecTracker()
const execState = computed(() => tracker.state.value)

const consoleTabRef = ref<InstanceType<typeof ConsoleTab> | null>(null)
const settingsTabRef = ref<InstanceType<typeof SettingsTab> | null>(null)

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
  setTimeout(() => { loadStatus(); settingsTabRef.value?.loadParams() }, 3000)
}

async function comfyStop() {
  if (!await confirm({ message: t('comfyui.confirm.stop') })) return
  if (!await post('/api/services/comfy/stop')) return
  toast(t('comfyui.toast.stopped'), 'success')
  setTimeout(loadStatus, 1000)
}

async function comfyRestart() {
  if (!await confirm({ message: t('comfyui.confirm.restart') })) return
  if (!await settingsTabRef.value?.saveParams(false)) return
  if (!await post('/api/services/comfy/restart')) return
  toast(t('comfyui.toast.restarting'), 'info')
  setTimeout(() => { loadStatus(); settingsTabRef.value?.loadParams() }, 5000)
}
</script>

<template>
  <PageHeader icon="terminal" :title="t('comfyui.title')">
    <template #badge>
      <HeaderStatusBadge
        v-if="status"
        :running="status.pm2_status === 'online'"
        :running-label="t('comfyui.status.running')"
        :stopped-label="t('comfyui.status.stopped')"
      />
    </template>
    <template #controls>
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
    <TabSwitcher v-model="activeTab" :tabs="comfyTabs" />

    <div v-show="activeTab === 'console'">
      <ConsoleTab
        ref="consoleTabRef"
        :status="status"
        :exec-state="execState"
        :elapsed="tracker.elapsed.value"
      />
    </div>

    <div v-show="activeTab === 'settings'">
      <SettingsTab
        ref="settingsTabRef"
        :status="status"
      />
    </div>

    <div v-show="activeTab === 'plugins'">
      <PluginsTab :online="!!status?.online" />
    </div>
  </div>
</template>
