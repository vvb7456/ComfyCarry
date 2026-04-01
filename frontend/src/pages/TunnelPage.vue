<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import AddCard from '@/components/ui/AddCard.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import ModeCard from '@/components/ui/ModeCard.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import HeaderStatusBadge from '@/components/layout/HeaderStatusBadge.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import FormField from '@/components/form/FormField.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import type {
  TunnelData, TunnelConfigResponse, TunnelSubdomainResponse,
  TunnelCapacityResponse, TunnelValidationResponse, TunnelActionResponse,
} from '@/types/tunnel'

defineOptions({ name: 'TunnelPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post, del } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const activeTab = ref('status')
const tabs = computed(() => [
  { key: 'status', label: t('tunnel.tabs.status'), icon: 'link' },
  { key: 'config', label: t('tunnel.tabs.config'), icon: 'settings' },
])

// Tunnel data
const data = ref<TunnelData | null>(null)

// Config tab state
const selectedMode = ref<'public' | 'custom' | null>(null)
const cfgToken = ref('')
const cfgDomain = ref('')
const cfgSubdomain = ref('')
const cfgProtocol = ref('auto')
const cfgSaving = ref(false)
const cfgValidating = ref(false)
const cfgValidResult = ref<{ ok: boolean; message: string } | null>(null)
const publicCapacity = ref<{ active: number; max: number; pct: number; available: boolean } | null>(null)
const publicCapacityText = ref('')

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
const logStream = useLogStream({
  historyUrl: '/api/tunnel/logs?lines=200',
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
  logStream.start()
})

onUnmounted(() => {
  refresh.stop()
  logStream.stop()
})

async function loadTunnelStatus() {
  const d = await get<TunnelData>('/api/tunnel/status?refresh=1')
  if (d) data.value = d
}

function switchTab(tab: string) {
  activeTab.value = tab
  if (tab === 'config') loadConfigTab()
}

async function loadConfigTab() {
  cfgValidResult.value = null
  // Load public capacity
  loadPublicCapacity()
  // Set selected mode based on current state
  if (data.value?.tunnel_mode === 'public') selectedMode.value = 'public'
  else if (data.value?.configured) selectedMode.value = 'custom'
  // Load protocol
  if (data.value?.cf_protocol) cfgProtocol.value = data.value.cf_protocol
  // Load config
  const d = await get<TunnelConfigResponse>('/api/tunnel/config')
  if (d) {
    cfgToken.value = d.api_token || ''
    cfgDomain.value = d.domain || ''
    cfgSubdomain.value = d.subdomain || ''
  }
  // If public mode, load public subdomain
  if (selectedMode.value === 'public') {
    const d2 = await get<TunnelSubdomainResponse>('/api/tunnel/public/subdomain')
    if (d2?.ok && d2.subdomain) cfgSubdomain.value = d2.subdomain
  }
  if (selectedMode.value === 'public') {
    cfgDomain.value = 'erocraft.org'
  }
}

async function loadPublicCapacity() {
  publicCapacityText.value = t('tunnel.config.public.capacity_loading')
  publicCapacity.value = null
  const d = await get<TunnelCapacityResponse>('/api/tunnel/public/status')
  if (d?.capacity) {
    const cap = d.capacity
    const pct = Math.round((cap.active_tunnels / cap.max_tunnels) * 100)
    publicCapacity.value = { active: cap.active_tunnels, max: cap.max_tunnels, pct, available: cap.available }
    publicCapacityText.value = ''
  } else {
    publicCapacityText.value = t('tunnel.config.public.capacity_fetch_failed')
  }
}

function selectMode(mode: 'public' | 'custom') {
  selectedMode.value = mode
  if (mode === 'public') {
    cfgDomain.value = 'erocraft.org'
  } else {
    if (cfgDomain.value === 'erocraft.org') cfgDomain.value = data.value?.cf_domain || ''
  }
  cfgValidResult.value = null
}

async function validateToken() {
  if (!cfgToken.value || !cfgDomain.value) {
    cfgValidResult.value = { ok: false, message: t('tunnel.confirm.fill_token_domain') }
    return
  }
  cfgValidating.value = true
  cfgValidResult.value = { ok: true, message: t('tunnel.toast.validating') + '...' }
  const d = await post<TunnelValidationResponse>('/api/tunnel/validate', { api_token: cfgToken.value, domain: cfgDomain.value })
  cfgValidating.value = false
  if (d?.ok) cfgValidResult.value = { ok: true, message: `${d.account_name} · ${d.zone_status}` }
  else cfgValidResult.value = { ok: false, message: d?.message || t('tunnel.toast.validate_failed') }
}

async function saveTunnelConfig() {
  if (cfgSaving.value) return
  cfgSaving.value = true
  try {
    const isPublicActive = data.value?.tunnel_mode === 'public'
    const isCustomConfigured = !!data.value?.configured
    // Save protocol
    if (!await post('/api/tunnel/protocol', { protocol: cfgProtocol.value })) return

    if (selectedMode.value === 'public') {
      const sub = cfgSubdomain.value.trim().toLowerCase()
      if (sub && !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(sub)) {
        toast(t('tunnel.config.subdomain_error'), 'warning'); return
      }
      if (!await post('/api/tunnel/public/subdomain', { subdomain: sub })) return
      if (isPublicActive) {
        if (await confirm({ message: t('tunnel.confirm.config_saved_restart') })) tunnelRestart(true)
        else toast(t('tunnel.confirm.config_saved_next'), 'info')
        return
      }
      if (isCustomConfigured && !await confirm({ message: t('tunnel.confirm.destroy_to_public'), variant: 'danger' })) return
      if (isCustomConfigured && !await post('/api/tunnel/teardown')) return
      await enablePublic()
    } else {
      if (!cfgToken.value || !cfgDomain.value) { toast(t('tunnel.confirm.fill_token_domain'), 'warning'); return }
      if (isPublicActive && !await confirm({ message: t('tunnel.confirm.switch_to_custom') })) return
      if (isPublicActive && !await post('/api/tunnel/public/disable')) return
      if (isCustomConfigured && !await confirm({ message: t('tunnel.confirm.update_restart') })) return
      if (!isCustomConfigured && !isPublicActive && !await confirm({ message: t('tunnel.confirm.create_tunnel') })) return
      toast(t('tunnel.config.applying'), 'info')
      const d = await post<TunnelActionResponse>('/api/tunnel/provision', { api_token: cfgToken.value, domain: cfgDomain.value, subdomain: cfgSubdomain.value })
      if (d?.ok) {
        toast(t('tunnel.toast.config_applied') + ' ' + t('tunnel.toast.auto_refresh') + '...', 'success')
        setTimeout(() => location.reload(), 5000)
      } else {
        toast(d?.error || t('tunnel.toast.save_failed'), 'error')
      }
    }
  } finally {
    cfgSaving.value = false
  }
}

async function enablePublic() {
  toast(t('tunnel.toast.enabling_public'), 'info')
  const d = await post<TunnelActionResponse>('/api/tunnel/public/enable')
  if (d?.ok) {
    toast(t('tunnel.toast.public_enabled'), 'success')
    setTimeout(() => { loadTunnelStatus(); loadConfigTab() }, 2000)
  } else {
    toast(t('tunnel.toast.enable_failed') + ': ' + (d?.error || ''), 'error')
  }
}

async function destroyTunnel() {
  if (selectedMode.value === 'public') {
    if (!await confirm({ message: t('tunnel.confirm.disable_public'), variant: 'danger' })) return
    const d = await post<TunnelActionResponse>('/api/tunnel/public/disable')
    if (d?.ok) { toast(t('tunnel.toast.public_disabled'), 'success'); setTimeout(() => { loadTunnelStatus(); loadConfigTab() }, 1000) }
  } else {
    if (!await confirm({ message: t('tunnel.confirm.remove_tunnel'), variant: 'danger' })) return
    const d = await post<TunnelActionResponse>('/api/tunnel/teardown')
    if (d?.ok) { toast(t('tunnel.toast.removed'), 'success'); setTimeout(loadTunnelStatus, 1000) }
    else toast(t('tunnel.toast.remove_failed') + ': ' + (d?.error || ''), 'error')
  }
}

async function tunnelStop() {
  if (!await confirm({ message: t('tunnel.confirm.stop_cloudflared') })) return
  const d = await post<TunnelActionResponse>('/api/tunnel/stop')
  toast(d?.ok ? t('tunnel.toast.cf_stopped') : (d?.error || t('tunnel.toast.stop_failed')), d?.ok ? 'success' : 'error')
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

// Status computeds
const isPublicMode = computed(() => data.value?.tunnel_mode === 'public')
const tunnelStatus = computed(() => {
  if (!data.value) return 'unknown'
  if (isPublicMode.value) return data.value.cloudflared === 'online' ? 'online' : 'stopped'
  return data.value.effective_status || 'unknown'
})

const iconMap: Record<string, string> = { dashboard: 'monitoring', comfyui: 'palette', comfycarry: 'monitoring', jupyter: 'book_2', jupyterlab: 'book_2', ssh: 'lock' }
function svcIcon(name: string) { return iconMap[name.toLowerCase()] || 'language' }
const nameMap: Record<string, string> = { dashboard: 'Dashboard', comfyui: 'ComfyUI', jupyter: 'JupyterLab', ssh: 'SSH' }
function svcName(name: string) { return nameMap[name.toLowerCase()] || name }

const customSvcStatus = computed<{ status: 'running' | 'loading' | 'stopped'; label: string }>(() => {
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
  const cmd = buildSshCmd(url)
  try {
    await navigator.clipboard.writeText(cmd)
  } catch {
    // Fallback for restricted clipboard contexts
    const ta = document.createElement('textarea')
    ta.value = cmd
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    document.body.removeChild(ta)
  }
  toast(t('common.clipboard_copied'), 'success')
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

// Add service
function openAddSvc() {
  addSvcName.value = ''; addSvcPort.value = ''; addSvcSuffix.value = ''; addSvcProto.value = 'http'
  addSvcModal.value = true
}

async function submitAddSvc() {
  if (!addSvcName.value || !addSvcPort.value || !addSvcSuffix.value) { toast(t('tunnel.config.fill_all'), 'warning'); return }
  const d = await post<TunnelActionResponse>('/api/tunnel/services', { name: addSvcName.value, port: parseInt(addSvcPort.value), suffix: addSvcSuffix.value, protocol: addSvcProto.value })
  if (d?.ok) { toast(t('tunnel.toast.service_added'), 'success'); addSvcModal.value = false; setTimeout(loadTunnelStatus, 2000) }
  else toast(t('tunnel.toast.add_failed') + ': ' + (d?.error || ''), 'error')
}

async function removeService(suffix: string) {
  if (!await confirm({ message: t('tunnel.confirm.remove_custom_service', { suffix }), variant: 'danger' })) return
  const d = await del<TunnelActionResponse>(`/api/tunnel/services/${encodeURIComponent(suffix)}`)
  if (d?.ok) { toast(t('tunnel.toast.service_removed'), 'success'); setTimeout(loadTunnelStatus, 2000) }
  else toast(d?.error || t('tunnel.toast.remove_failed'), 'error')
}

const connInfo = computed(() => {
  if (!data.value?.tunnel?.connections?.length) return t('tunnel.status.no_connection')
  return data.value.tunnel.connections.map((c: { colo_name?: string }) => c.colo_name || '?').join(', ')
})
</script>

<template>
  <PageHeader icon="language" :title="t('tunnel.title')">
    <template #badge>
      <HeaderStatusBadge
        v-if="data"
        :running="data.cloudflared === 'online'"
        :running-label="t('tunnel.status.running')"
        :stopped-label="t('tunnel.status.stopped')"
      />
    </template>
    <template #controls>
      <span v-if="data && (data.configured || data.tunnel_mode === 'public')">
        <template v-if="tunnelStatus === 'online' || tunnelStatus === 'connecting'">
          <BaseButton @click="tunnelStop"><MsIcon name="stop" /> {{ t('tunnel.services.stop') }}</BaseButton>
          <BaseButton @click="() => tunnelRestart()"><MsIcon name="restart_alt" /> {{ t('tunnel.services.restart') }}</BaseButton>
        </template>
        <BaseButton v-else @click="tunnelStartByMode"><MsIcon name="play_arrow" /> {{ t('tunnel.services.start') }}</BaseButton>
      </span>
    </template>
  </PageHeader>

  <div class="page-body">
    <TabSwitcher :model-value="activeTab" :tabs="tabs" @update:modelValue="switchTab" />

    <!-- ===== Status Tab ===== -->
    <div v-show="activeTab === 'status'">
      <!-- Loading state -->
      <LoadingCenter v-if="!data" style="padding:60px 0" />

      <!-- Status info -->
      <div v-if="data && (data.configured || data.tunnel_mode === 'public')" id="tunnel-status-section">
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
                  <StatusDot :status="tunnelStatus === 'online' ? 'running' : 'loading'" size="sm" />
                  {{ tunnelStatus === 'online' ? t('tunnel.status.online') : t('tunnel.status.connecting') }}
                </span>
              </div>
              <code class="tunnel-svc-detail tunnel-svc-detail--cmd">{{ buildSshCmd(url) }}</code>
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
                  <StatusDot :status="tunnelStatus === 'online' ? 'running' : 'loading'" size="sm" />
                  {{ tunnelStatus === 'online' ? t('tunnel.status.online') : t('tunnel.status.connecting') }}
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
                  <StatusDot :status="customSvcStatus.status" size="sm" />
                  {{ customSvcStatus.label }}
                </span>
              </div>
              <code class="tunnel-svc-detail tunnel-svc-detail--cmd">{{ buildSshCmd(svc.url) }}</code>
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
                  <StatusDot :status="customSvcStatus.status" size="sm" />
                  {{ customSvcStatus.label }}
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
      <div v-else-if="data" class="not-configured-hint">
        <BaseCard density="roomy">
          <EmptyState icon="language" :message="t('tunnel.setup_hint.not_configured')">
            <BaseButton variant="primary" size="sm" @click="selectMode('public'); switchTab('config')">
              <MsIcon name="public" /> {{ t('tunnel.setup_hint.quick_public') }}
            </BaseButton>
            <BaseButton size="sm" @click="switchTab('config')">
              <MsIcon name="build" /> {{ t('tunnel.setup_hint.custom_config') }}
            </BaseButton>
          </EmptyState>
        </BaseCard>
      </div>

      <!-- Log -->
      <SectionHeader icon="receipt_long">{{ t('tunnel.log.title') }}</SectionHeader>
      <LogPanel :lines="logStream.lines.value" :status="logStream.status.value" />
    </div>

    <!-- ===== Config Tab ===== -->
    <div v-show="activeTab === 'config'">
      <!-- Mode selector -->
      <div class="mode-grid">
        <!-- Public card -->
        <ModeCard
          icon="public"
          :title="t('tunnel.config.public.title')"
          :description="t('tunnel.config.public.desc')"
          :selected="selectedMode === 'public'"
          :active="data?.tunnel_mode === 'public'"
          :active-label="t('tunnel.config.mode_active')"
          @click="selectMode('public')"
        >
          <template v-if="publicCapacity">
            {{ t('tunnel.config.public.capacity') }}: <strong>{{ publicCapacity.active }}</strong> / {{ publicCapacity.max }} ({{ publicCapacity.pct }}%)
            <template v-if="!publicCapacity.available"> · {{ t('tunnel.config.public.capacity_full') }}</template>
          </template>
          <template v-else>{{ publicCapacityText }}</template>
        </ModeCard>
        <!-- Custom card -->
        <ModeCard
          icon="build"
          :title="t('tunnel.config.custom.title')"
          :description="t('tunnel.config.custom.desc')"
          :selected="selectedMode === 'custom'"
          :active="!!(data?.configured && data?.tunnel_mode !== 'public')"
          :active-label="t('tunnel.config.mode_active')"
          @click="selectMode('custom')"
        >
          {{ t('tunnel.config.custom.requires') }}
        </ModeCard>
      </div>

      <!-- Config details (when mode selected) -->
      <div v-if="selectedMode" class="config-details">
        <!-- Banner -->
        <div class="config-banner">
          <template v-if="selectedMode === 'public'">
            <span v-if="data?.tunnel_mode === 'public'"><MsIcon name="check_circle" size="sm" style="color:var(--green);vertical-align:middle" /> {{ t('tunnel.config.public_hint_active') }}</span>
            <span v-else>{{ t('tunnel.config.public_hint_inactive') }}</span>
          </template>
          <template v-else>
            <span v-if="data?.configured">{{ t('tunnel.config.custom_hint_active') }}</span>
            <span v-else>{{ t('tunnel.config.custom_hint_inactive') }}</span>
          </template>
        </div>

        <div class="cfg-grid">
          <!-- Domain -->
          <BaseCard density="roomy">
            <FormField>
              <template #label>
                {{ t('tunnel.config.domain') }}
                <HelpTip :text="t('tunnel.config.subdomain_help')" />
              </template>
              <div style="display:flex;align-items:stretch">
                <input v-model="cfgSubdomain" type="text" class="form-input" :placeholder="selectedMode === 'public' ? t('tunnel.config.auto_generate') : t('tunnel.config.auto_random')" style="flex:1;min-width:0;border-radius:var(--r) 0 0 var(--r);border-right:none">
                <span class="domain-sep">.</span>
                <input v-model="cfgDomain" type="text" class="form-input" placeholder="mydomain.com" :disabled="selectedMode === 'public'" style="flex:1;min-width:0;border-radius:0 var(--r) var(--r) 0;border-left:none" :style="selectedMode === 'public' ? { opacity: '0.6' } : {}">
              </div>
            </FormField>
          </BaseCard>

          <!-- Protocol -->
          <BaseCard density="roomy">
            <FormField>
              <template #label>
                {{ t('tunnel.config.protocol') }}
                <HelpTip :text="t('tunnel.config.protocol_help')" />
              </template>
              <BaseSelect v-model="cfgProtocol" :options="[
                { value: 'auto', label: t('tunnel.config.protocol_auto') },
                { value: 'http2', label: 'HTTP/2' },
                { value: 'quic', label: 'QUIC' },
              ]" />
            </FormField>
          </BaseCard>

          <!-- CF Token (custom only) -->
          <BaseCard density="roomy" :style="selectedMode === 'public' ? { opacity: '0.4', pointerEvents: 'none' } : {}">
            <FormField>
              <template #label>
                CF API Token
                <HelpTip :text="t('tunnel.config.cf_token_help')" />
              </template>
              <template #label-right>
                <BaseButton size="xs" :disabled="cfgValidating" @click="validateToken">{{ t('tunnel.config.validate') }}</BaseButton>
              </template>
              <SecretInput v-model="cfgToken" autocomplete="off" :placeholder="t('tunnel.config.cf_token_placeholder')" :disabled="selectedMode === 'public'" input-style="width:100%" />
              <template #below>
                <div v-if="cfgValidResult" :style="{ color: cfgValidResult.ok ? 'var(--green)' : 'var(--red)', fontSize: '.78rem', marginTop: '4px' }">
                  {{ cfgValidResult.ok ? '✓' : '✗' }} {{ cfgValidResult.message }}
                </div>
              </template>
            </FormField>
          </BaseCard>
        </div>

        <!-- Actions -->
        <div class="cfg-actions">
          <BaseButton variant="primary" :disabled="cfgSaving" @click="saveTunnelConfig">
            {{ cfgSaving ? t('tunnel.config.saving') : t('tunnel.config.save') }}
          </BaseButton>
          <BaseButton v-if="data?.configured || data?.tunnel_mode === 'public'" variant="danger" @click="destroyTunnel">
            {{ t('tunnel.config.destroy') }}
          </BaseButton>
        </div>
      </div>
    </div>

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
.custom-badge { font-size: .6rem; background: var(--ac); color: #000; padding: 1px 5px; border-radius: 3px; }

/* Vue-unique: mode selection grid */
.mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.not-configured-hint { margin-bottom: 16px; }

/* Vue-unique: config form layout */
.config-details { margin-top: 4px; }
.config-banner { font-size: .78rem; color: var(--t3); margin-bottom: 16px; padding: 8px 12px; background: var(--bg2); border: 1px solid var(--bd); border-radius: var(--r); }
.cfg-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.domain-sep { display: flex; align-items: center; padding: 0 8px; background: var(--bg3); border-top: 1px solid var(--bd); border-bottom: 1px solid var(--bd); color: var(--t3); font-weight: 600; font-size: .9rem; user-select: none; }
.cfg-actions { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 0; border-top: 1px solid var(--bd); margin-top: 16px; }

/* ── Service Cards ── */
.tunnel-services { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(260px, 20vw, 360px), 1fr)); gap: clamp(12px, 1vw, 20px); margin-top: 8px; }
.tunnel-svc-card { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: var(--t1); transition: border-color .2s, box-shadow .2s; position: relative; }
.tunnel-svc-card .tunnel-svc-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; opacity: 0; pointer-events: none; transition: opacity .2s; }
.tunnel-svc-card:hover .tunnel-svc-actions { opacity: 1; pointer-events: auto; }
.tunnel-svc-card:hover { border-color: var(--ac); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac) 20%, transparent); }
/* SSH card: clickable */
.tunnel-svc-card--ssh { cursor: pointer; }
.tunnel-svc-detail--cmd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; word-break: normal; }
.tunnel-svc-footer { display: flex; align-items: center; justify-content: space-between; }
.tunnel-svc-hint { font-size: .65rem; color: var(--t3); flex-shrink: 0; }
/* Section subtitle inline with title */
.section-subtitle { font-size: .75rem; color: var(--t3); font-weight: 400; }
.tunnel-svc-name { font-weight: 600; font-size: .95rem; }
.tunnel-svc-detail { font-size: .78rem; color: var(--ac); word-break: break-all; }
.tunnel-svc-port { font-size: .72rem; color: var(--t3); font-family: 'IBM Plex Mono', monospace; }
.tunnel-svc-status { display: inline-flex; align-items: center; gap: 4px; font-size: .72rem; margin-top: 2px; }

@media (max-width: 768px) {
  .cfg-grid { grid-template-columns: 1fr; }
  .mode-grid { grid-template-columns: 1fr; }
}
</style>
