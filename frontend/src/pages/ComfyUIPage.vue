<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import PageTopStack from '@/components/ui/PageTopStack.vue'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import UnsavedBanner from '@/components/ui/UnsavedBanner.vue'
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
const topStack = ref<InstanceType<typeof PageTopStack> | null>(null)
const tabs = computed(() => [
  { key: 'overview', label: t('comfyui.tabs.overview'), icon: 'monitoring' },
  { key: 'settings', label: t('comfyui.tabs.settings'), icon: 'tune' },
  { key: 'plugins', label: t('comfyui.tabs.plugins'), icon: 'extension' },
])

// Status (shared - used in header badge + ConsoleSection)
const status = ref<ComfyStatus | null>(null)

// 页头「打开 ComfyUI」链接。优先取隧道地址，无隧道时兜底本地直连
// (端口来自后端 COMFYUI_URL 解析, ComfyUI 离线时地址不可达, 不显示)。
const comfyUrl = ref('')
const effectiveComfyUrl = computed(() => {
  if (!status.value?.online) return ''
  if (comfyUrl.value) return comfyUrl.value
  const port = status.value?.port || 8188
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${port}`
})

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
const paramsDirty = computed(() => !!paramsRef.value?.isDirty)
const paramsSaving = computed(() => !!paramsRef.value?.saving)

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
  // 走 /api/comfyui/restart (delete+start): 启动前校验参数, errored 进程也能
  // 自愈; 不能用 /api/services/comfy/start —— pm2 start 沿用旧 dump 配置绕过校验。
  if (!await post('/api/comfyui/restart')) return
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

// ── 未保存守卫 (banner + tab/路由拦截) ────────────────────────────────────
// banner 保存按钮: 走 saveParams(true) 带二次确认 (与旧交互一致)
async function saveFromBanner(): Promise<boolean> {
  const ok = await paramsRef.value?.saveParams(true) ?? false
  if (ok) setTimeout(() => { loadStatus(); paramsRef.value?.loadParams() }, 5000)
  return ok
}

// 守卫确认里的"保存": 跳过二次 confirm (confirm 本身已是保存意图)
async function saveFromGuard(): Promise<boolean> {
  const ok = await paramsRef.value?.saveParams(false) ?? false
  if (ok) setTimeout(() => { loadStatus(); paramsRef.value?.loadParams() }, 5000)
  return ok
}

async function discardChanges() {
  await paramsRef.value?.loadParams()
}

const guard = useUnsavedGuard({
  isDirty: paramsDirty,
  saveAction: saveFromGuard,
  discardAction: discardChanges,
  texts: () => ({
    title: t('comfyui.console.unsaved_confirm_title'),
    message: t('comfyui.console.unsaved_confirm_msg'),
    confirmSave: t('comfyui.console.unsaved_confirm_save_restart'),
    confirmDiscard: t('comfyui.console.unsaved_confirm_discard'),
    cancel: t('comfyui.console.unsaved_confirm_cancel'),
  }),
})
guard.guardRouteLeave()

async function onTabChange(next: string) {
  if (activeTab.value === 'settings' && next !== 'settings' && paramsDirty.value) {
    if (!(await guard.guardTabSwitch())) return
  }
  activeTab.value = next
}
</script>

<template>
  <div class="page-body">
    <PageTopStack ref="topStack" :enabled="activeTab === 'plugins'">
      <TabSwitcher :title="t('comfyui.title')" :model-value="activeTab" :tabs="tabs" @update:model-value="onTabChange">
        <template #title-extra>
          <a
            v-if="effectiveComfyUrl"
            :href="effectiveComfyUrl"
            target="_blank"
            rel="noopener"
            :title="t('comfyui.open')"
            class="title-launch-icon"
          >
            <MsIcon name="open_in_new" size="xs" />
          </a>
        </template>

        <template #extra>
          <span v-if="status" class="page-actions">
            <template v-if="status.online">
              <BaseButton size="sm" @click="comfyStop"><MsIcon name="stop" /> {{ t('common.btn.stop') }}</BaseButton>
              <BaseButton size="sm" @click="comfyRestart"><MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}</BaseButton>
            </template>
            <BaseButton v-else size="sm" @click="comfyStart"><MsIcon name="play_arrow" /> {{ t('common.btn.start') }}</BaseButton>
          </span>
        </template>
      </TabSwitcher>
    </PageTopStack>

    <!-- 未保存守卫 banner (仅 settings tab 显示) -->
    <UnsavedBanner
      :visible="activeTab === 'settings' && paramsDirty"
      :message="t('comfyui.console.unsaved_changes')"
      :save-label="t('comfyui.settings.save_restart')"
      :discard-label="t('comfyui.console.unsaved_confirm_discard')"
      :saving="paramsSaving"
      @save="saveFromBanner"
      @discard="discardChanges"
    />

    <div v-show="activeTab === 'overview'" class="tab-panel">
      <ConsoleSection
        :status="status"
        :exec-state="execState"
        :elapsed="tracker.elapsed.value"
      />
    </div>

    <div v-show="activeTab === 'settings'" class="tab-panel settings-centered">
      <ParamsCard ref="paramsRef" :active="activeTab === 'settings'" />
    </div>

    <div v-show="activeTab === 'plugins'" class="tab-panel">
      <PluginsTab :online="status?.online" :active="activeTab === 'plugins'" :toolbar-target="topStack?.toolbarTarget" />
    </div>
  </div>
</template>
