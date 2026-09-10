<script setup lang="ts">
/**
 * TunnelPage — 隧道单列页 (C04)。
 *
 * 结构: 页头 (停止/重启/启动 + 设置) → Hero → 运行事实 → 服务 → 日志。
 * 设置回迁页内 (TunnelSettingsModal): 未配置 Hero 的两个首次配置入口与页头设置
 * 打开同一弹窗, 前者预选对应模式。
 *
 * Hero 状态取后端 effective_status 与配置状态:
 *   unconfigured(off) / connecting(warn+busy) / online(ok) / stopped(off) / failed(bad)。
 * 运行事实 (模式 / 隧道标识 / 连接节点) 位于 Hero 卡片下方; 配置事实停机仍显示,
 * 连接节点等运行期字段随状态显示, 缺失不渲染。
 *
 * 服务行用 ListRow: HTTP 真实打开 (在线时), SSH 复制连接命令, TCP 复制地址;
 * 自定义模式保留添加服务与自定义服务删除 (内置不可删)。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useClipboard } from '@/composables/useClipboard'
import { apiErrorText } from '@/utils/apiError'
import ServiceHero from '@/components/ui/ServiceHero.vue'
import ListRow from '@/components/ui/ListRow.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import TunnelSettingsModal from '@/components/tunnel/TunnelSettingsModal.vue'
import type { TunnelData, TunnelActionResponse } from '@/types/tunnel'

defineOptions({ name: 'TunnelPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post, del } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()
const { copy } = useClipboard()

// ── Tunnel data ──
const data = ref<TunnelData | null>(null)

// ── 页内设置弹窗 ──
const settingsOpen = ref(false)
const settingsPreset = ref<'off' | 'public' | 'custom' | null>(null)

function openSettings(mode: 'off' | 'public' | 'custom' | null = null) {
  settingsPreset.value = mode
  settingsOpen.value = true
}

// ── 添加服务弹窗 ──
const addSvcModal = ref(false)
const addSvcName = ref('')
const addSvcPort = ref('')
const addSvcSuffix = ref('')
const addSvcProto = ref('http')
const addSvcPreview = computed(() => {
  if (data.value && addSvcSuffix.value) return `${addSvcSuffix.value}-${data.value.subdomain}.${data.value.domain}`
  return t('tunnel.config.enter_suffix')
})

// ── 日志流 ──
const { lines: logLines, status: logStatus, hasMore: logHasMore, loadingMore: logLoadingMore, prepending: logPrepending, onScroll: logOnScroll, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/tunnel/logs',
  streamUrl: '/api/tunnel/logs/stream',
  classify(line) {
    if (/error|ERR|exception/i.test(line)) return 'log-error'
    if (/warn/i.test(line)) return 'log-warn'
    if (/connection|register|route|ingress/i.test(line)) return 'log-info'
    return ''
  },
})

const refresh = useAutoRefresh(loadTunnelStatus, 10000)

onMounted(() => {
  loadTunnelStatus()
  refresh.start({ immediate: false })
  logStart()
})

onUnmounted(() => {
  refresh.stop()
  logStop()
})

async function loadTunnelStatus() {
  const d = await get<TunnelData>('/api/tunnel/status?refresh=1')
  if (d) data.value = d
}

// ── 状态判定 ──
type HeroState = 'unconfigured' | 'connecting' | 'online' | 'stopped' | 'failed'

const isPublicMode = computed(() => data.value?.tunnel_mode === 'public')
const isCustomMode = computed(() => data.value?.tunnel_mode === 'custom')
const configured = computed(() => !!data.value && (data.value.configured || isPublicMode.value))

const heroState = computed<HeroState>(() => {
  const d = data.value
  if (!d || !(d.configured || d.tunnel_mode === 'public')) return 'unconfigured'
  const st = d.effective_status
  if (st === 'online') return 'online'
  if (st === 'connecting' || st === 'starting') return 'connecting'
  // offline 时区分「进程报错」与「正常停止」; 后端未给 error 状态, 用 pm2 状态判定
  if (st === 'error' || st === 'failed' || d.cloudflared === 'errored') return 'failed'
  return 'stopped'
})

const heroTone = computed(() => ({
  unconfigured: 'off',
  connecting: 'warn',
  online: 'ok',
  stopped: 'off',
  failed: 'bad',
}[heroState.value] as 'off' | 'warn' | 'ok' | 'bad'))

const heroBusy = computed(() => heroState.value === 'connecting')
const heroOnline = computed(() => heroState.value === 'online')

const heroTitle = computed(() => t(`tunnel.hero.${heroState.value}.title`))
const heroSubtitle = computed(() => heroState.value === 'online'
  ? t('tunnel.hero.online.subtitle', { count: serviceCount.value })
  : t(`tunnel.hero.${heroState.value}.subtitle`))

const heroHasActions = computed(() => ['unconfigured', 'stopped', 'failed'].includes(heroState.value))

// ── 服务列表 ──
interface ServiceRow {
  key: string
  title: string
  icon: string
  port: number | null
  protocol: string
  url: string
  suffix: string
  custom: boolean
  isSsh: boolean
  isTcp: boolean
}

const iconMap: Record<string, string> = {
  dashboard: 'monitoring', comfycarry: 'monitoring', comfyui: 'palette',
  jupyter: 'book_2', jupyterlab: 'book_2', ssh: 'key',
}
const nameMap: Record<string, string> = {
  dashboard: 'Dashboard', comfycarry: 'ComfyCarry', comfyui: 'ComfyUI',
  jupyter: 'JupyterLab', jupyterlab: 'JupyterLab', ssh: 'SSH',
}
function svcIcon(name: string) { return iconMap[name.toLowerCase()] || 'language' }
function svcName(name: string) { return nameMap[name.toLowerCase()] || name }

/** 公共节点 url 键 → 后端默认服务 (取真实端口/协议); 匹配不到时用内置兜底 */
const PUBLIC_ALIASES: Record<string, string[]> = {
  dashboard: ['comfycarry', 'dashboard'],
  comfyui: ['comfyui'],
  jupyter: ['jupyterlab', 'jupyter'],
  ssh: ['ssh'],
}
const PUBLIC_FALLBACK: Record<string, { port: number; protocol: string }> = {
  dashboard: { port: 5000, protocol: 'http' },
  comfyui: { port: 8188, protocol: 'http' },
  jupyter: { port: 8888, protocol: 'http' },
  ssh: { port: 22, protocol: 'ssh' },
}
function publicMeta(key: string, d: TunnelData): { port: number | null; protocol: string } {
  const aliases = PUBLIC_ALIASES[key.toLowerCase()] || [key.toLowerCase()]
  const match = d.services?.find(s => aliases.includes(s.name.toLowerCase()))
  if (match) return { port: match.port, protocol: match.protocol }
  const fb = PUBLIC_FALLBACK[key.toLowerCase()]
  return fb ? { port: fb.port, protocol: fb.protocol } : { port: null, protocol: 'http' }
}

const serviceRows = computed<ServiceRow[]>(() => {
  const d = data.value
  if (!d || !configured.value) return []
  if (isPublicMode.value) {
    const urls = d.public?.urls || {}
    return Object.entries(urls).map(([key, url]) => {
      const meta = publicMeta(key, d)
      const isSsh = meta.protocol === 'ssh'
      return {
        key, title: svcName(key), icon: svcIcon(key),
        port: meta.port, protocol: meta.protocol, url,
        suffix: '', custom: false, isSsh, isTcp: false,
      }
    })
  }
  return (d.services || []).map(svc => {
    const url = d.urls?.[svc.name] || (svc.suffix ? `https://${svc.suffix}-${d.subdomain}.${d.domain}` : `https://${d.subdomain}.${d.domain}`)
    return {
      key: svc.name, title: svc.name, icon: svcIcon(svc.name),
      port: svc.port, protocol: svc.protocol, url,
      suffix: svc.suffix, custom: svc.custom,
      isSsh: svc.protocol === 'ssh', isTcp: svc.protocol === 'tcp',
    }
  })
})

const serviceCount = computed(() => serviceRows.value.length)

function rowFacts(row: ServiceRow): string[] {
  const facts: string[] = []
  if (row.port != null && row.protocol) facts.push(`${row.protocol.toUpperCase()} · :${row.port}`)
  if (row.url) facts.push(row.isSsh ? buildSshCmd(row.url) : row.url)
  return facts
}

// ── 运行事实 ──
const connInfo = computed(() => {
  const conns = data.value?.tunnel?.connections
  if (!conns?.length) return ''
  return conns.map(c => c.colo_name).filter(Boolean).join(', ')
})

const factsList = computed<{ label: string; value: string }[]>(() => {
  const d = data.value
  if (!d || !configured.value) return []
  const out: { label: string; value: string }[] = []
  out.push({
    label: t('tunnel.facts.mode'),
    value: isPublicMode.value ? t('tunnel.facts.mode_public') : t('tunnel.facts.mode_custom'),
  })
  const id = isPublicMode.value
    ? (d.public?.random_id || '')
    : (d.tunnel?.tunnel_id ? `${d.tunnel.tunnel_id.slice(0, 8)}…` : (d.subdomain && d.domain ? `${d.subdomain}.${d.domain}` : ''))
  if (id) out.push({ label: t('tunnel.facts.tunnel_id'), value: id })
  if (connInfo.value) out.push({ label: t('tunnel.facts.node'), value: connInfo.value })
  return out
})

// ── 服务操作 (cloudflared 启停) ──
const pendingAction = ref<'start' | 'stop' | 'restart' | null>(null)
const acting = computed(() => pendingAction.value !== null)

async function tunnelStop() {
  if (!await confirm({ message: t('tunnel.confirm.stop_cloudflared') })) return
  pendingAction.value = 'stop'
  const d = await post<TunnelActionResponse>('/api/tunnel/stop')
  pendingAction.value = null
  toast(d?.ok ? t('tunnel.toast.cf_stopped') : apiErrorText(d, t('tunnel.toast.stop_failed')), d?.ok ? 'success' : 'error')
  setTimeout(loadTunnelStatus, 1500)
}

async function tunnelStart() {
  pendingAction.value = 'start'
  const d = await post<TunnelActionResponse>('/api/tunnel/start')
  pendingAction.value = null
  if (!d?.ok) { toast(apiErrorText(d, t('tunnel.toast.start_failed')), 'error'); return }
  toast(t('tunnel.toast.cf_starting'), 'info')
  setTimeout(loadTunnelStatus, 2000)
}

async function tunnelRestart(skipConfirm = false) {
  if (!skipConfirm && !await confirm({ message: t('tunnel.confirm.restart_cloudflared') })) return
  pendingAction.value = 'restart'
  const d = await post<TunnelActionResponse>('/api/tunnel/restart')
  pendingAction.value = null
  if (!d?.ok) { toast(apiErrorText(d, t('tunnel.toast.restart_failed')), 'error'); return }
  toast(t('tunnel.toast.cf_restarting'), 'info')
  setTimeout(loadTunnelStatus, 3000)
}

function tunnelStartByMode() {
  if (isPublicMode.value) tunnelStart()
  else tunnelRestart(true)
}

function onSettingsSaved() {
  loadTunnelStatus()
}

// ── 服务行操作 ──
function buildSshCmd(url: string) {
  const hostname = url.replace(/^https?:\/\//, '')
  return `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${hostname}`
}

async function copyRow(row: ServiceRow) {
  if (!row.url) return
  await copy(row.isSsh ? buildSshCmd(row.url) : row.url)
}

function copyAria(row: ServiceRow) {
  return row.isSsh ? t('tunnel.services.copy_ssh') : t('tunnel.services.copy_addr', { name: row.title })
}
function openAria(row: ServiceRow) { return t('tunnel.services.open', { name: row.title }) }
function removeAria(row: ServiceRow) { return t('tunnel.services.remove', { name: row.title }) }

async function removeService(suffix: string) {
  if (!await confirm({ message: t('tunnel.confirm.remove_custom_service', { suffix }), variant: 'danger' })) return
  const d = await del<TunnelActionResponse>(`/api/tunnel/services/${encodeURIComponent(suffix)}`)
  if (d?.ok) { toast(t('tunnel.toast.service_removed'), 'success'); setTimeout(loadTunnelStatus, 2000) }
  else toast(apiErrorText(d, t('tunnel.toast.remove_failed')), 'error')
}

async function submitAddSvc() {
  if (!addSvcName.value || !addSvcPort.value || !addSvcSuffix.value) { toast(t('tunnel.config.fill_all'), 'warning'); return }
  const d = await post<TunnelActionResponse>('/api/tunnel/services', { name: addSvcName.value, port: parseInt(addSvcPort.value), suffix: addSvcSuffix.value, protocol: addSvcProto.value })
  if (d?.ok) { toast(t('tunnel.toast.service_added'), 'success'); addSvcModal.value = false; setTimeout(loadTunnelStatus, 2000) }
  else toast(apiErrorText(d, t('tunnel.toast.add_failed')), 'error')
}

function openAddSvc() {
  addSvcName.value = ''; addSvcPort.value = ''; addSvcSuffix.value = ''; addSvcProto.value = 'http'
  addSvcModal.value = true
}
</script>

<template>
  <div class="page-body">
    <div class="page-header-row">
      <div class="page-title-wrap">
        <h1 class="page-title">{{ t('tunnel.title') }}</h1>
      </div>
      <span class="page-header-row__spacer" />
      <span v-if="configured" class="page-actions">
        <template v-if="heroState === 'online' || heroState === 'connecting'">
          <BaseButton size="sm" :loading="pendingAction === 'stop'" :disabled="acting" @click="tunnelStop"><MsIcon name="stop" /> {{ t('common.btn.stop') }}</BaseButton>
          <BaseButton size="sm" :loading="pendingAction === 'restart'" :disabled="acting" @click="tunnelRestart()"><MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}</BaseButton>
        </template>
        <BaseButton v-else size="sm" :loading="pendingAction === 'start'" :disabled="acting" @click="tunnelStartByMode"><MsIcon name="play_arrow" /> {{ t('common.btn.start') }}</BaseButton>
      </span>
      <BaseButton variant="ghost" size="sm" icon-only :aria-label="t('tunnel.settings.title')" @click="openSettings()">
        <MsIcon name="settings" />
      </BaseButton>
    </div>

    <div class="page-col">
      <LoadingCenter v-if="!data" style="padding:60px 0" />

      <template v-else>
        <!-- Hero + 运行事实 -->
        <ServiceHero
          icon="language"
          :title="heroTitle"
          :subtitle="heroSubtitle"
          :tone="heroTone"
          :busy="heroBusy"
        >
          <template v-if="heroHasActions" #actions>
            <template v-if="heroState === 'unconfigured'">
              <BaseButton variant="primary" @click="openSettings('public')">{{ t('tunnel.hero.action.connect_public') }}</BaseButton>
              <BaseButton @click="openSettings('custom')">{{ t('tunnel.hero.action.connect_custom') }}</BaseButton>
            </template>
            <BaseButton v-else-if="heroState === 'stopped'" variant="primary" :loading="pendingAction === 'start'" @click="tunnelStartByMode">{{ t('tunnel.hero.action.start') }}</BaseButton>
            <BaseButton v-else-if="heroState === 'failed'" variant="primary" :loading="pendingAction === 'start'" @click="tunnelStartByMode">{{ t('tunnel.hero.action.retry') }}</BaseButton>
          </template>
          <template v-if="factsList.length" #facts>
            <span v-for="fact in factsList" :key="fact.label">{{ fact.label }}<b>{{ fact.value }}</b></span>
          </template>
        </ServiceHero>

        <!-- 服务 -->
        <section v-if="configured" class="tunnel-block">
          <SectionHeader icon="link">
            {{ t('tunnel.services.title') }}
            <span class="tunnel-count">{{ serviceCount }}</span>
            <template #actions>
              <BaseButton v-if="isCustomMode" size="sm" @click="openAddSvc">
                <MsIcon name="add" /> {{ t('tunnel.services.add_service') }}
              </BaseButton>
            </template>
          </SectionHeader>
          <ul v-if="serviceRows.length" class="list-plain">
            <ListRow
              v-for="row in serviceRows"
              :key="row.key"
              :icon="row.icon"
              :title="row.title"
              :facts="rowFacts(row)"
            >
              <template #actions>
                <BaseButton variant="ghost" size="sm" icon-only :aria-label="copyAria(row)" @click="copyRow(row)">
                  <MsIcon name="content_copy" />
                </BaseButton>
                <BaseButton
                  v-if="!row.isSsh && !row.isTcp && heroOnline && row.url"
                  variant="ghost" size="sm" icon-only :aria-label="openAria(row)"
                  :href="row.url" target="_blank"
                >
                  <MsIcon name="open_in_new" />
                </BaseButton>
                <BaseButton
                  v-if="isCustomMode && row.custom"
                  variant="danger" size="sm" icon-only :aria-label="removeAria(row)"
                  :disabled="acting" @click="removeService(row.suffix)"
                >
                  <MsIcon name="delete" />
                </BaseButton>
              </template>
            </ListRow>
          </ul>
          <EmptyState v-else icon="link" :message="t('tunnel.services.empty')" density="compact" />
        </section>

        <!-- 日志 (默认展开) -->
        <section v-if="configured" class="tunnel-block">
          <LogPanel
            :title="t('tunnel.log.title')"
            collapsible
            :lines="logLines"
            :status="logStatus"
            :has-more="logHasMore"
            :loading-more="logLoadingMore"
            :prepending="logPrepending"
            :on-scroll="logOnScroll"
          />
        </section>
      </template>
    </div>

    <!-- 页内设置 -->
    <TunnelSettingsModal v-model="settingsOpen" :preset-mode="settingsPreset" @saved="onSettingsSaved" />

    <!-- 添加服务弹窗 -->
    <BaseModal v-model="addSvcModal" :title="t('tunnel.add_service.title')" size="md">
      <FormField :label="t('tunnel.add_service.name')" density="compact">
        <input v-model="addSvcName" type="text" :placeholder="t('tunnel.add_service.name_placeholder')" class="form-input">
      </FormField>
      <FormField :label="t('tunnel.add_service.port')" density="compact">
        <input v-model="addSvcPort" type="number" :placeholder="t('tunnel.add_service.port_placeholder')" class="form-number">
      </FormField>
      <FormField :label="t('tunnel.add_service.suffix')" density="compact">
        <input v-model="addSvcSuffix" type="text" :placeholder="t('tunnel.add_service.suffix_placeholder')" class="form-input">
        <template #below>
          <div class="add-svc-preview">
            {{ t('tunnel.add_service.generated_domain') }}: <code>{{ addSvcPreview }}</code>
          </div>
        </template>
      </FormField>
      <FormField :label="t('tunnel.add_service.protocol')" density="compact">
        <BaseSelect v-model="addSvcProto" :options="[
          { value: 'http', label: 'HTTP' },
          { value: 'https', label: 'HTTPS' },
          { value: 'tcp', label: 'TCP' },
          { value: 'ssh', label: 'SSH' },
        ]" />
      </FormField>
      <template #footer>
        <BaseButton size="sm" @click="addSvcModal = false">{{ t('common.btn.cancel') }}</BaseButton>
        <BaseButton variant="primary" size="sm" @click="submitAddSvc">{{ t('common.btn.add') }}</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
/* 分区节奏: Hero → 服务 → 日志 28px */
.tunnel-block {
  margin-top: 28px;
}

.tunnel-count {
  margin-left: 6px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--t3);
}

.add-svc-preview {
  font-size: var(--text-xs);
  color: var(--t3);
}
</style>
