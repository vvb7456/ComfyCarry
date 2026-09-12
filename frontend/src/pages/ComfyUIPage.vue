<script setup lang="ts">
/**
 * ComfyUIPage — ComfyUI 单列页 (C08)。
 *
 * 页签收敛为运行 / 插件。运行页顺序: Hero → 运行事实 → 当前执行 → GPU →
 * 版本与启动 → 日志。页头承接停止/重启 (在线时) 与设置 (参数弹窗)。
 *
 * Hero 状态机取 ComfyStatus.online / pm2_status 与执行跟踪:
 *   idle(ok)        在线空闲, 主操作「打开 ComfyUI」
 *   executing(ok)   在线执行中, 副标题带等待队列; 操作「打开」+「中断执行」
 *   starting(warn+busy) 启动/重启请求进行中, 或 pm2 在线但 HTTP 未就绪
 *   stopped(off)    pm2 停止/不存在, 主操作「启动 ComfyUI」
 *   failed(bad)     pm2 errored, 主操作「重试」
 *
 * 地址解析沿用隧道优先、本地直连兜底。参数表单迁入 ComfyParamsModal,
 * 主页只保留一行由已保存配置生成的启动命令; 参数保存成功后即时更新。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import { useSystemStats } from '@/composables/useSystemStats'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import PageTopStack from '@/components/ui/PageTopStack.vue'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import ServiceHero from '@/components/ui/ServiceHero.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ComfyProgressBar from '@/components/ui/ComfyProgressBar.vue'
import ConsoleSection from '@/components/comfyui/ConsoleSection.vue'
import GpuMetricsCard from '@/components/comfyui/GpuMetricsCard.vue'
import VersionCard from '@/components/comfyui/VersionCard.vue'
import ComfyParamsModal from '@/components/comfyui/ComfyParamsModal.vue'
import PluginsTab from '@/components/comfyui/PluginsTab.vue'
import { buildLaunchCommand, extractExtraArgs } from '@/components/comfyui/paramsCommand'
import type { ComfyParamsResponse, ComfyStatus } from '@/types/comfyui'

defineOptions({ name: 'ComfyUIPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// ── 页签 ───────────────────────────────────────────────────────
const activeTab = ref('run')
const topStack = ref<InstanceType<typeof PageTopStack> | null>(null)
const tabs = computed(() => [
  { key: 'run', label: t('comfyui.tabs.run'), icon: 'terminal' },
  { key: 'plugins', label: t('comfyui.tabs.plugins'), icon: 'extension' },
])

// ── 状态 ───────────────────────────────────────────────────────
const status = ref<ComfyStatus | null>(null)
const actionLoading = ref<'start' | 'stop' | 'restart' | 'interrupt' | null>(null)
const acting = computed(() => actionLoading.value !== null)
const paramsOpen = ref(false)

const queuePending = computed(() => status.value?.queue_pending || 0)
const queueTotal = computed(() => (status.value?.queue_running || 0) + (status.value?.queue_pending || 0))

// 隧道优先、本地直连兜底; ComfyUI 离线时地址不可达, 不显示。
const comfyUrl = ref('')
const effectiveComfyUrl = computed(() => {
  if (!status.value?.online) return ''
  if (comfyUrl.value) return comfyUrl.value
  const port = status.value?.port || 8188
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${port}`
})

const addressHost = computed(() => {
  const url = effectiveComfyUrl.value
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
})

async function loadComfyUrl() {
  const d = await get<{ urls?: Record<string, string>; public?: { urls?: Record<string, string> } }>(
    '/api/tunnel/status',
    { silent: true },
  )
  const urls: Record<string, string> = { ...(d?.urls || {}), ...(d?.public?.urls || {}) }
  const hit = Object.entries(urls).find(([name]) => name.toLowerCase().includes('comfyui'))
  comfyUrl.value = hit ? hit[1] : ''
}

async function loadStatus() {
  const d = await get<ComfyStatus>('/api/comfyui/status', { silent: true })
  if (d) status.value = d
}

// ── 启动命令 (由已保存配置生成) ────────────────────────────────
const launchCommand = ref('')

async function loadLaunchCommand() {
  const d = await get<ComfyParamsResponse>('/api/comfyui/params', { silent: true })
  if (!d) return
  const schema = d.schema || {}
  const current = d.current || {}
  launchCommand.value = buildLaunchCommand(schema, current, extractExtraArgs(d.raw_args || [], schema))
}

// ── 执行跟踪 + SSE ─────────────────────────────────────────────
const tracker = useExecTracker()
const execState = computed(() => tracker.state.value)

// 系统指标 (共享单例, 3s 轮询) — GPU 卡片消费
const { stats: sysStats } = useSystemStats()

const sse = useComfySSE(tracker, {
  onEvent(evt, result) {
    // 终态提示 (完成 / 中断 / 出错) 由 App 级 useExecNotifications 统一发出 ——
    // 页面只负责自己的可视化刷新, 避免多订阅者各弹一条。
    if (result?.finished && result.type === 'execution_done') {
      loadStatus()
    }
  },
})

const refresh = useAutoRefresh(loadStatus, 10000)

onMounted(() => {
  loadStatus()
  loadComfyUrl()
  loadLaunchCommand()
  refresh.start({ immediate: false })
  sse.start()
})

onUnmounted(() => {
  refresh.stop()
  sse.stop()
})

// ── Hero 状态机 ────────────────────────────────────────────────
type HeroState = 'idle' | 'executing' | 'starting' | 'stopped' | 'failed'

const executing = computed(() => execState.value != null)

const heroState = computed<HeroState>(() => {
  if (actionLoading.value === 'start' || actionLoading.value === 'restart') return 'starting'
  const s = status.value
  if (!s) return 'starting'
  if (s.online) return executing.value ? 'executing' : 'idle'
  if (s.pm2_status === 'errored') return 'failed'
  if (s.pm2_status === 'launching' || s.pm2_status === 'online') return 'starting'
  return 'stopped'
})

const heroTone = computed(() => ({
  idle: 'ok',
  executing: 'ok',
  starting: 'warn',
  stopped: 'off',
  failed: 'bad',
}[heroState.value] as 'ok' | 'warn' | 'off' | 'bad'))

const heroBusy = computed(() => heroState.value === 'starting')
const heroTitle = computed(() => t(`comfyui.hero.${heroState.value}.title`))
const heroSubtitle = computed(() => {
  if (heroState.value === 'executing') {
    return queuePending.value > 0
      ? t('comfyui.hero.executing.subtitle_pending', { count: queuePending.value })
      : t('comfyui.hero.executing.subtitle')
  }
  return t(`comfyui.hero.${heroState.value}.subtitle`)
})

// ── 运行事实 ───────────────────────────────────────────────────
const factsList = computed<{ label: string; value: string }[]>(() => {
  const s = status.value
  if (!s) return []
  const out: { label: string; value: string }[] = []
  // 配置事实: 端口停机仍显示
  if (s.port) out.push({ label: t('comfyui.facts.port'), value: String(s.port) })
  if (!s.online) return out
  // 运行期字段随状态显示
  if (addressHost.value) out.push({ label: t('comfyui.facts.address'), value: addressHost.value })
  const version = s.system?.comfyui_version
  if (version) out.push({ label: t('comfyui.facts.version'), value: version.startsWith('v') ? version : `v${version}` })
  out.push({ label: t('comfyui.facts.queue'), value: String(queueTotal.value) })
  return out
})

// ── 服务操作 ───────────────────────────────────────────────────
async function comfyStart() {
  // 走 /api/comfyui/restart (delete+start): 启动前校验参数, errored 进程也能自愈。
  actionLoading.value = 'start'
  const d = await post<{ ok?: boolean }>('/api/comfyui/restart')
  actionLoading.value = null
  if (!d?.ok) return
  toast(t('comfyui.msg.starting'), 'info')
  setTimeout(loadStatus, 3000)
}

async function comfyStop() {
  if (!await confirm({
    title: t('comfyui.confirm.stop.title'),
    message: t('comfyui.confirm.stop.message'),
    confirmText: t('common.btn.stop'),
  })) return
  actionLoading.value = 'stop'
  const d = await post('/api/services/comfy/stop')
  actionLoading.value = null
  if (!d) return
  toast(t('comfyui.msg.stopped'), 'success')
  setTimeout(loadStatus, 1000)
}

async function comfyRestart() {
  if (!await confirm({
    title: t('comfyui.confirm.restart.title'),
    message: t('comfyui.confirm.restart.message'),
    confirmText: t('common.btn.restart'),
  })) return
  // /api/comfyui/restart 用已保存参数做 pm2 delete + start, 保留 --log。
  actionLoading.value = 'restart'
  const d = await post<{ ok?: boolean }>('/api/comfyui/restart')
  actionLoading.value = null
  if (!d?.ok) return
  toast(t('comfyui.msg.restarting'), 'info')
  setTimeout(loadStatus, 5000)
}

async function comfyInterrupt() {
  actionLoading.value = 'interrupt'
  const d = await post('/api/comfyui/interrupt')
  actionLoading.value = null
  if (!d) return
  toast(t('comfyui.msg.interrupt_sent'), 'warning')
}

// ── 参数保存 / 版本切换 ────────────────────────────────────────
function onParamsSaved(command: string) {
  if (!command) {
    void loadLaunchCommand()
    return
  }
  launchCommand.value = command.startsWith('main.py') ? command : `main.py ${command}`
}

function onVersionSwitched() {
  setTimeout(loadStatus, 5000)
}
</script>

<template>
  <div class="page-body">
    <PageTopStack ref="topStack" :enabled="activeTab === 'plugins'">
      <TabSwitcher :title="t('comfyui.title')" :model-value="activeTab" :tabs="tabs" @update:model-value="activeTab = $event">
        <template #extra>
          <span v-if="status?.online" class="page-actions">
            <BaseButton size="sm" :loading="actionLoading === 'stop'" :disabled="acting" @click="comfyStop">
              <MsIcon name="stop" /> {{ t('common.btn.stop') }}
            </BaseButton>
            <BaseButton size="sm" :loading="actionLoading === 'restart'" :disabled="acting" @click="comfyRestart">
              <MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}
            </BaseButton>
          </span>
          <BaseButton
            variant="ghost"
            size="sm"
            :aria-label="t('comfyui.params.title')"
            @click="paramsOpen = true"
          >
            <MsIcon name="settings" /> {{ t('common.btn.settings') }}
          </BaseButton>
        </template>
      </TabSwitcher>
    </PageTopStack>

    <div v-show="activeTab === 'run'" class="page-col">
      <LoadingCenter v-if="!status" style="padding:60px 0" />

      <template v-else>
        <!-- Hero + 运行事实 -->
        <ServiceHero
          icon="terminal"
          :title="heroTitle"
          :subtitle="heroSubtitle"
          :tone="heroTone"
          :busy="heroBusy"
        >
          <template v-if="heroState !== 'starting'" #actions>
            <template v-if="heroState === 'idle' || heroState === 'executing'">
              <BaseButton variant="primary" :href="effectiveComfyUrl" target="_blank" rel="noopener">
                <MsIcon name="open_in_new" /> {{ t('comfyui.hero.action.open') }}
              </BaseButton>
              <BaseButton
                v-if="heroState === 'executing'"
                :loading="actionLoading === 'interrupt'"
                :disabled="acting"
                @click="comfyInterrupt"
              >
                {{ t('comfyui.hero.action.interrupt') }}
              </BaseButton>
            </template>
            <BaseButton
              v-else-if="heroState === 'stopped'"
              variant="primary"
              :loading="actionLoading === 'start'"
              :disabled="acting"
              @click="comfyStart"
            >
              {{ t('comfyui.hero.action.start') }}
            </BaseButton>
            <BaseButton
              v-else-if="heroState === 'failed'"
              variant="primary"
              :loading="actionLoading === 'start'"
              :disabled="acting"
              @click="comfyStart"
            >
              {{ t('common.btn.retry') }}
            </BaseButton>
          </template>
          <template v-if="factsList.length" #facts>
            <span v-for="fact in factsList" :key="fact.label">{{ fact.label }}<b>{{ fact.value }}</b></span>
          </template>
        </ServiceHero>

        <!-- 当前执行 (仅在线) -->
        <section v-if="status.online" class="comfy-block">
          <SectionHeader icon="bolt">
            {{ t('comfyui.sections.current_execution') }}
            <span v-if="queuePending > 0" class="comfy-hint">{{ t('comfyui.exec.queue_waiting', { count: queuePending }) }}</span>
          </SectionHeader>
          <ComfyProgressBar :state="execState" :elapsed="tracker.elapsed.value" />
        </section>

        <!-- GPU -->
        <section class="comfy-block">
          <SectionHeader icon="monitor_heart">{{ t('comfyui.sections.gpu') }}</SectionHeader>
          <LoadingCenter v-if="!sysStats" style="padding:20px 0" />
          <template v-else-if="sysStats.gpu.length">
            <GpuMetricsCard v-for="(gpu, i) in sysStats.gpu" :key="gpu.index ?? i" :gpu="gpu" />
          </template>
          <EmptyState v-else density="compact" icon="monitor_heart" :message="t('comfyui.gpu.empty')" />
        </section>

        <!-- 版本与启动 -->
        <section class="comfy-block">
          <SectionHeader icon="new_releases">{{ t('comfyui.sections.version') }}</SectionHeader>
          <VersionCard :command="launchCommand" @switched="onVersionSwitched" />
        </section>

        <!-- 日志 -->
        <section class="comfy-block">
          <ConsoleSection />
        </section>
      </template>
    </div>

    <div v-show="activeTab === 'plugins'" class="tab-panel">
      <PluginsTab :online="status?.online" :active="activeTab === 'plugins'" :toolbar-target="topStack?.toolbarTarget" />
    </div>

    <!-- 启动参数弹窗 (常驻: 表单状态保留在组件内) -->
    <ComfyParamsModal v-model="paramsOpen" @saved="onParamsSaved" />
  </div>
</template>

<style scoped>
/* 分区节奏: Hero → 当前执行 → GPU → 版本 → 日志 (--section-gap, 与总览一致) */
.comfy-block {
  margin-top: var(--section-gap);
}

.comfy-hint {
  margin-left: 6px;
  color: var(--t3);
  font-size: var(--text-xs);
  font-weight: 400;
}
</style>
