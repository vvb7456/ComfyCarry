<script setup lang="ts">
/**
 * TunnelPage — 服务与日志单页。
 * 配置已移至 设置页 → Tunnel (/settings/tunnel); 本页只负责:
 * 服务状态卡片、自定义服务管理 (增删)、日志。
 * 未配置时空态给「打开设置」入口。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useClipboard } from '@/composables/useClipboard'
import { apiErrorText } from '@/utils/apiError'
import LogPanel from '@/components/ui/LogPanel.vue'
import AddCard from '@/components/ui/AddCard.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import type { TunnelData, TunnelActionResponse } from '@/types/tunnel'

defineOptions({ name: 'TunnelPage' })

const { t } = useI18n({ useScope: 'global' })
const router = useRouter()
const { get, post, del } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()
const { copy } = useClipboard()

// Tunnel data
const data = ref<TunnelData | null>(null)

// Add service modal
const addSvcModal = ref(false)
const addSvcName = ref('')
const addSvcPort = ref('')
const addSvcSuffix = ref('')
const addSvcProto = ref('http')
const addSvcPreview = computed(() => {
  if (data.value && addSvcSuffix.value) return `${addSvcSuffix.value}-${data.value.subdomain}.${data.value.domain}`
  return t('tunnel.config.enter_suffix')
})

// Log stream
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

// ── 服务操作 (cloudflared 启停) ──
async function tunnelStop() {
  if (!await confirm({ message: t('tunnel.confirm.stop_cloudflared') })) return
  const d = await post<TunnelActionResponse>('/api/tunnel/stop')
  toast(d?.ok ? t('tunnel.toast.cf_stopped') : apiErrorText(d, t('tunnel.toast.stop_failed')), d?.ok ? 'success' : 'error')
  setTimeout(loadTunnelStatus, 1500)
}

async function tunnelStart() {
  if (!await post('/api/tunnel/start')) return
  toast(t('tunnel.toast.cf_starting'), 'info')
  setTimeout(loadTunnelStatus, 2000)
}

async function tunnelRestart(skipConfirm = false) {
  if (!skipConfirm && !await confirm({ message: t('tunnel.confirm.restart_cloudflared') })) return
  if (!await post('/api/tunnel/restart')) return
  toast(t('tunnel.toast.cf_restarting'), 'info')
  setTimeout(loadTunnelStatus, 3000)
}

function tunnelStartByMode() {
  if (isPublicMode.value) {
    tunnelStart()
    return
  }
  tunnelRestart(true)
}

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

// Status computeds
const isPublicMode = computed(() => data.value?.tunnel_mode === 'public')
const tunnelStatus = computed(() => {
  if (!data.value) return 'unknown'
  return data.value.effective_status || 'unknown'
})

const iconMap: Record<string, string> = { dashboard: 'monitoring', comfyui: 'palette', comfycarry: 'monitoring', jupyter: 'book_2', jupyterlab: 'book_2', ssh: 'lock' }
function svcIcon(name: string) { return iconMap[name.toLowerCase()] || 'language' }
const nameMap: Record<string, string> = { dashboard: 'Dashboard', comfyui: 'ComfyUI', jupyter: 'JupyterLab', ssh: 'SSH' }
function svcName(name: string) { return nameMap[name.toLowerCase()] || name }

const svcStatus = computed<{ status: 'running' | 'loading' | 'stopped'; label: string }>(() => {
  const st = tunnelStatus.value
  if (st === 'online') return { status: 'running', label: t('tunnel.services.route_ready') }
  if (st === 'connecting' || st === 'starting') return { status: 'loading', label: t('tunnel.status.connecting') }
  return { status: 'stopped', label: t('tunnel.status.offline') }
})

function buildSshCmd(url: string) {
  const hostname = url.replace(/^https?:\/\//, '')
  return `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${hostname}`
}

async function copySshCmd(url: string) {
  if (!url) return
  await copy(buildSshCmd(url))
}

// Computed services list for status tab
const publicServices = computed(() => {
  if (!isPublicMode.value || !data.value?.public?.urls) return []
  return Object.entries(data.value.public.urls).map(([key, url]) => ({ key, url }))
})

const customServices = computed(() => {
  const d = data.value
  if (!d || !d.services?.length) return []
  return d.services.map(svc => ({
    ...svc,
    url: d.urls?.[svc.name] || (svc.suffix ? `https://${svc.suffix}-${d.subdomain}.${d.domain}` : `https://${d.subdomain}.${d.domain}`),
  }))
})

const connInfo = computed(() => {
  if (!data.value?.tunnel?.connections?.length) return t('tunnel.status.no_connection')
  return data.value.tunnel.connections.map((c: { colo_name?: string }) => c.colo_name || '?').join(', ')
})
</script>

<template>
  <div class="page-body">
    <div class="page-header-row">
      <div class="page-title-wrap">
        <h1 class="page-title">{{ t('tunnel.title') }}</h1>
      </div>
      <span class="page-header-row__spacer" />
      <span v-if="data && (data.configured || data.tunnel_mode === 'public')" class="page-actions">
        <template v-if="tunnelStatus === 'online' || tunnelStatus === 'connecting'">
          <BaseButton size="sm" @click="tunnelStop"><MsIcon name="stop" /> {{ t('common.btn.stop') }}</BaseButton>
          <BaseButton size="sm" @click="() => tunnelRestart()"><MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}</BaseButton>
        </template>
        <BaseButton v-else size="sm" @click="tunnelStartByMode"><MsIcon name="play_arrow" /> {{ t('common.btn.start') }}</BaseButton>
      </span>
    </div>

    <!-- Loading state -->
    <LoadingCenter v-if="!data" style="padding:60px 0" />

    <!-- Status info -->
    <div v-else-if="data && (data.configured || data.tunnel_mode === 'public')" id="tunnel-status-section">
      <SectionHeader icon="link" flush>
        {{ t('tunnel.services.title') }}
        <span class="section-subtitle">
          <template v-if="isPublicMode">{{ t('tunnel.config.public.title') }} · {{ data.public?.random_id || '?' }}</template>
          <template v-else>{{ data.subdomain }}.{{ data.domain }}{{ data.tunnel?.tunnel_id ? ' · ' + data.tunnel.tunnel_id.slice(0, 8) + '...' : '' }} · {{ t('tunnel.services.node') }}: {{ connInfo }}</template>
        </span>
      </SectionHeader>

      <!-- Service cards — public mode -->
      <div class="tunnel-services" v-if="isPublicMode">
        <template v-for="{ key, url } in publicServices" :key="key">
          <!-- SSH special -->
          <div v-if="key === 'ssh'" class="tunnel-svc-card tunnel-svc-card--ssh" @click="copySshCmd(url)">
            <div class="tunnel-svc-row">
              <MsIcon :name="svcIcon(key)" />
              <span class="tunnel-svc-name">{{ svcName(key) }}</span>
              <span class="tunnel-svc-status">
                <StatusDot :status="svcStatus.status" size="sm" />
                {{ svcStatus.label }}
              </span>
            </div>
            <code class="tunnel-svc-detail tunnel-svc-detail--cmd text-truncate">{{ buildSshCmd(url) }}</code>
            <div class="tunnel-svc-footer">
              <span class="tunnel-svc-port">:22 · TCP</span>
              <span class="tunnel-svc-hint">{{ t('tunnel.services.click_copy') }}</span>
            </div>
          </div>
          <!-- Regular service -->
          <a v-else :href="url" target="_blank" class="tunnel-svc-card">
            <div class="tunnel-svc-row">
              <MsIcon :name="svcIcon(key)" />
              <span class="tunnel-svc-name">{{ svcName(key) }}</span>
              <span class="tunnel-svc-status">
                <StatusDot :status="svcStatus.status" size="sm" />
                {{ svcStatus.label }}
              </span>
            </div>
            <span class="tunnel-svc-detail">{{ url }}</span>
          </a>
        </template>
      </div>

      <!-- Service cards — custom mode -->
      <div class="tunnel-services" v-else-if="data">
        <template v-for="svc in customServices" :key="svc.name">
          <div v-if="svc.name.toLowerCase() === 'ssh'" class="tunnel-svc-card tunnel-svc-card--ssh" @click="copySshCmd(svc.url)">
            <div class="tunnel-svc-actions">
              <BaseButton variant="danger" size="sm" square @click.stop="removeService(svc.suffix)"><MsIcon name="delete" /></BaseButton>
            </div>
            <div class="tunnel-svc-row">
              <MsIcon name="lock" />
              <span class="tunnel-svc-name">SSH</span>
              <span class="tunnel-svc-status">
                <StatusDot :status="svcStatus.status" size="sm" />
                {{ svcStatus.label }}
              </span>
            </div>
            <code class="tunnel-svc-detail tunnel-svc-detail--cmd text-truncate">{{ buildSshCmd(svc.url) }}</code>
            <div class="tunnel-svc-footer">
              <span class="tunnel-svc-port">:{{ svc.port }} · {{ svc.suffix || '' }}.{{ data.domain }}</span>
              <span class="tunnel-svc-hint">{{ t('tunnel.services.click_copy') }}</span>
            </div>
          </div>
          <a v-else :href="svc.url" target="_blank" class="tunnel-svc-card">
            <div class="tunnel-svc-actions" @click.stop="" v-if="svc.suffix">
              <BaseButton variant="danger" size="sm" square @click="removeService(svc.suffix)"><MsIcon name="delete" /></BaseButton>
            </div>
            <div class="tunnel-svc-row">
              <MsIcon :name="svcIcon(svc.name)" />
              <span class="tunnel-svc-name">{{ svc.name }}</span>
              <span v-if="svc.custom" class="custom-badge">{{ t('tunnel.services.custom_badge') }}</span>
              <span class="tunnel-svc-status">
                <StatusDot :status="svcStatus.status" size="sm" />
                {{ svcStatus.label }}
              </span>
            </div>
            <span class="tunnel-svc-detail">{{ svc.url }}</span>
            <span class="tunnel-svc-port">:{{ svc.port }} · {{ svc.protocol }}</span>
          </a>
        </template>
        <!-- Add card -->
        <AddCard class="tunnel-svc-card" :label="t('tunnel.services.add_service')" @click="openAddSvc" />
      </div>
    </div>

    <!-- Not configured hint -->
    <div v-else class="not-configured-hint">
      <BaseCard density="roomy">
        <EmptyState icon="language" :message="t('tunnel.setup_hint.not_configured')">
          <BaseButton variant="primary" size="sm" @click="router.push({ name: 'settings', query: { section: 'connect', focus: 'tunnel' } })">
            <MsIcon name="settings" /> {{ t('tunnel.setup_hint.open_settings') }}
          </BaseButton>
        </EmptyState>
      </BaseCard>
    </div>

    <!-- Log -->
    <SectionHeader icon="receipt_long">{{ t('tunnel.log.title') }}</SectionHeader>
    <LogPanel :lines="logLines" :status="logStatus" :has-more="logHasMore" :loading-more="logLoadingMore" :prepending="logPrepending" :on-scroll="logOnScroll" />

    <!-- Add Service Modal -->
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
          <div style="font-size:.72rem;color:var(--t3)">
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
/* Vue-unique: flex row inside service card */
.tunnel-svc-row { display: flex; align-items: center; gap: 8px; }

/* Vue-unique: custom service indicator */
.custom-badge { font-size: .6rem; background: var(--ac); color: var(--t-inv); padding: 1px 5px; border-radius: 3px; }

/* Vue-unique: config form layout */
.not-configured-hint { margin-bottom: 16px; }

/* ── Service Cards ── */
.tunnel-services { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(260px, 20vw, 360px), 1fr)); gap: clamp(12px, 1vw, 20px); margin-top: 8px; }
.tunnel-svc-card { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: var(--t1); transition: border-color .2s, box-shadow .2s; position: relative; }
.tunnel-svc-card .tunnel-svc-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; opacity: 0; pointer-events: none; transition: opacity .2s; }
.tunnel-svc-card:hover .tunnel-svc-actions { opacity: 1; pointer-events: auto; }
.tunnel-svc-card:hover { border-color: var(--ac); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac) 20%, transparent); }
/* SSH card: clickable */
.tunnel-svc-card--ssh { cursor: pointer; }
.tunnel-svc-detail--cmd { display: block; word-break: normal; }
.tunnel-svc-footer { display: flex; align-items: center; justify-content: space-between; }
.tunnel-svc-hint { font-size: .65rem; color: var(--t3); flex-shrink: 0; }
/* Section subtitle inline with title */
.section-subtitle { font-size: .75rem; color: var(--t3); font-weight: 400; }
.tunnel-svc-name { font-weight: 600; font-size: .95rem; }
.tunnel-svc-detail { font-size: .78rem; color: var(--ac); word-break: break-all; }
.tunnel-svc-port { font-size: .72rem; color: var(--t3); font-family: 'IBM Plex Mono', monospace; }
.tunnel-svc-status { display: inline-flex; align-items: center; gap: 4px; font-size: .72rem; margin-top: 2px; }
</style>
