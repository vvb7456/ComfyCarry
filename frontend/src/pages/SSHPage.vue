<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import AddCard from '@/components/ui/AddCard.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import StatCard from '@/components/ui/StatCard.vue'
import Spinner from '@/components/ui/Spinner.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import FormField from '@/components/form/FormField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import HeaderStatusBadge from '@/components/layout/HeaderStatusBadge.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import type { SSHKey, SSHStatus } from '@/types/ssh'

defineOptions({ name: 'SSHPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post, del } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// ─── State ────────────────────────────────────────────────────────────────────

const activeTab = ref('status')
const tabs = computed(() => [
  { key: 'status', label: t('ssh.tabs.status'), icon: 'link' },
  { key: 'config', label: t('ssh.tabs.config'), icon: 'settings' },
])

const status = ref<SSHStatus | null>(null)
const statusLoading = ref(true)
const connectCmd = ref<string | null>(null)
const connectCmdLoading = ref(true)
const connectCmdState = ref<'loading' | 'ready' | 'not_running' | 'tunnel_missing'>('loading')
const keys = ref<SSHKey[]>([])
const keysLoading = ref(false)

// action loading
const actionLoading = ref<'start' | 'stop' | 'restart' | null>(null)

// add-key form
const showAddKey = ref(false)
const newKeysText = ref('')
const addingKey = ref(false)

// password form
const pwSync = ref(false)
const pwNew = ref('')
const pwConfirm = ref('')
const pwSubmitting = ref(false)

// log stream
const { lines: logLines, status: logStatus, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/ssh/logs?lines=200',
  streamUrl: '/api/ssh/logs/stream',
  classify(line) {
    if (/error|fatal|fail/i.test(line)) return 'log-error'
    if (/warn|invalid|refused/i.test(line)) return 'log-warn'
    if (/accepted|session opened|publickey/i.test(line)) return 'log-info'
    return ''
  },
})

// ─── API calls ────────────────────────────────────────────────────────────────

async function loadStatus() {
  const data = await get<SSHStatus>('/api/ssh/status')
  if (data) {
    status.value = data
    statusLoading.value = false
  }
}

async function loadConnectCmd() {
  connectCmdLoading.value = true
  if (status.value && !status.value.running) {
    connectCmdLoading.value = false
    connectCmd.value = null
    connectCmdState.value = 'not_running'
    return
  }
  const data = await get<{ urls?: Record<string, string>; tunnel_mode?: string; public?: { urls?: Record<string, string> } }>('/api/tunnel/status')
  connectCmdLoading.value = false
  if (!data) {
    connectCmd.value = null
    connectCmdState.value = 'tunnel_missing'
    return
  }

  let sshHost: string | null = null

  // Check custom tunnel urls (keyed by service name)
  const urls = data.urls || {}
  for (const [name, url] of Object.entries(urls)) {
    if ((name as string).toLowerCase() === 'ssh') {
      sshHost = (url as string).replace(/^https?:\/\//, '').replace(/\/$/, '')
      break
    }
  }

  // Check public tunnel urls
  if (!sshHost && data.tunnel_mode === 'public' && data.public?.urls) {
    const pubUrls = data.public.urls
    const sshUrl = pubUrls.ssh || pubUrls.SSH
    if (sshUrl) {
      sshHost = sshUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    }
  }

  if (sshHost) {
    connectCmd.value = `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${sshHost}`
    connectCmdState.value = 'ready'
  } else {
    connectCmd.value = null
    connectCmdState.value = 'tunnel_missing'
  }
}

async function loadKeys() {
  keysLoading.value = true
  const data = await get<{ keys: SSHKey[] }>('/api/ssh/keys')
  keysLoading.value = false
  if (data) keys.value = data.keys || []
}

// ─── Tab switch ───────────────────────────────────────────────────────────────

function onTabChange(tab: string) {
  activeTab.value = tab
  if (tab === 'status') {
    logStart()
    refresher.resume()
  } else {
    logStop()
    refresher.pause()
    loadKeys()
  }
}

// ─── Auto-refresh (status tab only) ──────────────────────────────────────────

const refresher = useAutoRefresh(loadStatus, 10000)

// ─── Service actions ──────────────────────────────────────────────────────────

async function sshAction(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' && !await confirm({ message: t('ssh.confirm.stop') })) return
  actionLoading.value = action
  const data = await post<{ message?: string; error?: string }>(`/api/ssh/${action}`, {})
  actionLoading.value = null
  if (!data) return
  if (data.error) {
    toast(data.error, 'error')
  } else {
    toast(data.message || t('ssh.toast.action_ok'), 'success')
    await loadStatus()
    await loadConnectCmd()
  }
}

// ─── SSH keys ─────────────────────────────────────────────────────────────────

async function addKey() {
  const text = newKeysText.value.trim()
  if (!text) return
  addingKey.value = true
  const data = await post<{ added: number; errors: string[] }>('/api/ssh/keys', { keys: text })
  addingKey.value = false
  if (!data) return
  if (data.errors?.length) toast(data.errors.join(', '), 'error')
  if (data.added > 0) {
    toast(t('ssh.toast.key_added', { n: data.added }), 'success')
    newKeysText.value = ''
    showAddKey.value = false
    await loadKeys()
  }
}

async function deleteKey(fingerprint: string) {
  if (!await confirm({ message: t('ssh.confirm.delete_key'), variant: 'danger' })) return
  const data = await del<{ error?: string }>('/api/ssh/keys', { fingerprint })
  if (!data) return
  if (data.error) {
    toast(data.error, 'error')
  } else {
    toast(t('ssh.toast.key_deleted'), 'success')
    keys.value = keys.value.filter(k => k.fingerprint !== fingerprint)
  }
}

// ─── Password ─────────────────────────────────────────────────────────────────

function onPwSyncChange() {
  if (pwSync.value) {
    pwNew.value = ''
    pwConfirm.value = ''
  }
}

async function setPassword() {
  let password: string
  if (pwSync.value) {
    password = '_sync_dashboard_password_'
  } else {
    if (!pwNew.value) { toast(t('ssh.toast.pw_empty'), 'error'); return }
    if (pwNew.value.length < 4) { toast(t('ssh.password.too_short'), 'error'); return }
    if (pwNew.value !== pwConfirm.value) { toast(t('ssh.toast.pw_mismatch'), 'error'); return }
    password = pwNew.value
  }
  pwSubmitting.value = true
  const data = await post<{ error?: string; sshd_restarted?: boolean }>('/api/ssh/password', { password })
  pwSubmitting.value = false
  if (!data) return
  if (data.error) { toast(data.error, 'error'); return }
  let msg = pwSync.value ? t('ssh.password.synced') : t('ssh.password.set_success')
  if (data.sshd_restarted) msg += t('ssh.password.sshd_restarted_suffix')
  toast(msg, 'success')
  pwNew.value = ''
  pwConfirm.value = ''
  await loadStatus()
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

function copyCmd() {
  if (!connectCmd.value) return
  navigator.clipboard.writeText(connectCmd.value).then(() => {
    toast(t('common.clipboard_copied'), 'success')
  })
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

loadStatus().then(loadConnectCmd)
logStart()
refresher.start({ immediate: false })

onUnmounted(() => {
  logStop()
  refresher.stop()
})
</script>

<template>
  <div class="ssh-page">
    <PageHeader icon="key" :title="t('ssh.title')">
      <template #badge>
        <HeaderStatusBadge
          v-if="status"
          :running="status.running"
          :running-label="t('ssh.status.running')"
          :stopped-label="t('ssh.status.stopped')"
        />
        <Spinner v-else-if="statusLoading" size="sm" />
      </template>
      <template #controls>
        <span v-if="status">
          <BaseButton v-if="!status.running" :disabled="actionLoading !== null" @click="sshAction('start')">
            <MsIcon name="play_arrow" /> {{ t('ssh.actions.start') }}
          </BaseButton>
          <template v-else>
            <BaseButton :disabled="actionLoading !== null" @click="sshAction('stop')">
              <MsIcon name="stop" /> {{ t('ssh.actions.stop') }}
            </BaseButton>
            <BaseButton :disabled="actionLoading !== null" @click="sshAction('restart')">
              <MsIcon name="restart_alt" /> {{ t('ssh.actions.restart') }}
            </BaseButton>
          </template>
        </span>
      </template>
    </PageHeader>

    <div class="page-body">
      <!-- Tabs -->
      <TabSwitcher :tabs="tabs" v-model="activeTab" @update:model-value="onTabChange" />

      <!-- ─── Status Tab ───────────────────────────────────────────────── -->
      <div v-show="activeTab === 'status'">
        <!-- Stat cards -->
        <LoadingCenter v-if="statusLoading && !status">
          {{ t('common.status.loading') }}
        </LoadingCenter>
        <div v-else-if="status" class="stat-grid">
          <StatCard :label="t('ssh.status.service')" :status="status.running ? 'running' : 'stopped'" value-size="sm">
            <template #value>{{ status.running ? t('ssh.status.running') : t('ssh.status.stopped') }}</template>
            <template #sub>{{ status.running ? `PID: ${status.pid || '-'}` : t('ssh.status.service_not_running') }}</template>
          </StatCard>
          <StatCard :label="t('ssh.status.port')" value-size="sm">
            <template #value>{{ status.port }}</template>
            <template #sub>TCP</template>
          </StatCard>
          <StatCard :label="t('ssh.status.connections')" value-size="sm">
            <template #value>{{ status.active_connections }}</template>
            <template #sub>ESTABLISHED</template>
          </StatCard>
          <StatCard :label="t('ssh.status.password_auth')" :status="status.password_auth ? 'running' : 'stopped'" value-size="sm">
            <template #value>{{ status.password_auth ? t('common.status.enabled') : t('common.status.disabled') }}</template>
            <template #sub>
              {{ t('ssh.status.root_password') }}:
              <span :style="{ color: status.password_set ? 'var(--green)' : 'var(--amber)' }">
                {{ status.password_set ? t('ssh.status.pw_set') : t('ssh.status.not_set') }}
              </span>
            </template>
          </StatCard>
        </div>

        <!-- SSH connect command -->
        <SectionHeader icon="content_paste" flush>{{ t('ssh.connect.title') }}</SectionHeader>
        <BaseCard density="default">
          <div v-if="connectCmdLoading" style="color:var(--t3);font-size:.85rem">
            {{ t('ssh.connect.loading') }}
          </div>
          <template v-else-if="connectCmdState === 'ready' && connectCmd">
            <div class="connect-cmd-row">
              <code class="connect-cmd-code">{{ connectCmd }}</code>
              <BaseButton variant="ghost" size="sm" square :title="t('common.btn.copy')" @click="copyCmd">
                <MsIcon name="content_copy" />
              </BaseButton>
            </div>
            <div class="connect-cmd-hint">
              {{ t('ssh.connect.need_cloudflared') }}
              <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" target="_blank" rel="noopener">cloudflared</a>
            </div>
          </template>
          <div v-else-if="connectCmdState === 'not_running'" class="connect-cmd-fallback">
            <div><MsIcon name="info" /> {{ t('ssh.connect.not_running') }}</div>
          </div>
          <div v-else class="connect-cmd-fallback">
            <div><MsIcon name="info" /> {{ t('ssh.connect.tunnel_not_configured') }}{{ t('ssh.connect.check_platform') }}</div>
            <code class="connect-cmd-code">{{ t('ssh.connect.hint') }}</code>
          </div>
        </BaseCard>

        <!-- Log -->
        <SectionHeader icon="receipt_long">{{ t('ssh.log.title') }}</SectionHeader>
        <LogPanel :lines="logLines" :status="logStatus" />
      </div>

      <!-- ─── Config Tab ───────────────────────────────────────────────── -->
      <div v-show="activeTab === 'config'" class="ssh-auth-grid">
        <!-- SSH Keys column -->
        <div>
          <SectionHeader icon="lock" flush>{{ t('ssh.keys.title') }}</SectionHeader>

          <!-- Key list -->
          <LoadingCenter v-if="keysLoading" style="padding:24px 0" />
          <template v-else>
            <div v-for="key in keys" :key="key.fingerprint" class="ssh-key-card">
              <div class="ssh-key-info">
                <div class="ssh-key-type">
                  <MsIcon name="key" />
                  {{ key.type }}
                  <span class="ssh-source-badge" :class="key.source === 'env' ? 'ssh-source-badge--env' : 'ssh-source-badge--config'">
                    {{ key.source === 'env' ? t('ssh.keys.env_var') : t('ssh.keys.saved') }}
                  </span>
                </div>
                <div class="ssh-key-fp">{{ key.fingerprint }}</div>
                <div v-if="key.comment" class="ssh-key-comment">{{ key.comment }}</div>
              </div>
              <BaseButton
                variant="danger"
                size="sm"
                square
                :title="t('ssh.keys.delete_btn')"
                @click="deleteKey(key.fingerprint)"
              >
                <MsIcon name="delete" />
              </BaseButton>
            </div>

            <!-- Add key form (inserted above the add-card so the add-card remains last) -->
            <Transition name="slide-down">
              <div v-if="showAddKey" class="ssh-add-key-card">
                <textarea
                  v-model="newKeysText"
                  class="form-textarea form-textarea--mono"
                  style="height:100px;resize:vertical"
                  :placeholder="t('ssh.keys.add_placeholder')"
                />
                <div style="display:flex;justify-content:flex-end;margin-top:8px;gap:8px">
                  <BaseButton size="sm" @click="showAddKey = false">{{ t('common.btn.cancel') }}</BaseButton>
                  <BaseButton variant="primary" size="sm" :disabled="addingKey || !newKeysText.trim()" @click="addKey">
                    <Spinner v-if="addingKey" size="sm" />
                    {{ t('ssh.keys.add_submit') }}
                  </BaseButton>
                </div>
              </div>
            </Transition>

            <!-- Add-card (always kept as the last item) -->
            <AddCard class="ssh-key-card" size="compact" :label="t('ssh.keys.add_btn')" @click="showAddKey = true" />
          </template>
        </div>

        <!-- Password column -->
        <div>
          <SectionHeader icon="lock" flush>{{ t('ssh.password.title') }}</SectionHeader>
          <BaseCard density="default">
            <form @submit.prevent="setPassword" autocomplete="off">
              <input
                type="text"
                name="username"
                autocomplete="username"
                tabindex="-1"
                aria-hidden="true"
                style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"
              />
              <div style="display:flex;flex-direction:column;gap:10px">
                <SecretInput
                  v-model="pwNew"
                  is-password
                  :disabled="pwSync"
                  autocomplete="new-password"
                  :placeholder="pwSync ? t('ssh.password.use_comfycarry') : t('ssh.password.new')"
                  input-class="form-input"
                />
                <SecretInput
                  v-model="pwConfirm"
                  is-password
                  :disabled="pwSync"
                  autocomplete="new-password"
                  :placeholder="pwSync ? t('ssh.password.use_comfycarry') : t('ssh.password.confirm')"
                  input-class="form-input"
                />

                <div style="display:flex;justify-content:space-between;align-items:center">
                  <label class="form-checkbox-label">
                    <input
                      type="checkbox"
                      v-model="pwSync"
                      @change="onPwSyncChange"
                      class="form-checkbox"
                    />
                    <span style="font-size:.82rem">{{ t('ssh.password.use_comfycarry') }}</span>
                    <HelpTip :text="t('ssh.password.help')" />
                  </label>
                  <BaseButton type="submit" variant="primary" size="sm" :disabled="pwSubmitting">
                    <Spinner v-if="pwSubmitting" size="sm" />
                    {{ pwSync ? t('ssh.password.sync_btn') : t('ssh.password.set_btn') }}
                  </BaseButton>
                </div>
              </div>
            </form>
          </BaseCard>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>


/* Vue-unique: page wrapper */
.ssh-page { display: flex; flex-direction: column; height: 100%; }

/* Vue-unique: SSH connect command display */
.connect-cmd-row { display: flex; align-items: center; gap: 8px; }
.connect-cmd-code { flex: 1; font-family: 'IBM Plex Mono', monospace; font-size: .8rem; color: var(--t1); background: var(--bg); padding: 8px 12px; border-radius: var(--rs); overflow-x: auto; white-space: nowrap; }
.connect-cmd-hint { font-size: .72rem; color: var(--t3); margin-top: 4px; }
.connect-cmd-hint a { color: var(--ac); }
.connect-cmd-fallback { display: flex; flex-direction: column; gap: 6px; color: var(--t3); font-size: .82rem; }

/* Vue-unique: SSH key source badge */
.ssh-source-badge { font-size: .68rem; padding: 1px 6px; border-radius: 3px; margin-left: 6px; }
.ssh-source-badge--env { background: var(--bg4); color: var(--amber); }
.ssh-source-badge--config { background: var(--bg4); color: var(--cyan); }

/* Vue-unique: checkbox label row */
.form-checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }

/* Vue-unique: form input (page-level variant) */
.form-input { width: 100%; font-size: .85rem; background: var(--bg); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 12px; color: var(--t1); outline: none; box-sizing: border-box; }
.form-input:focus { border-color: var(--ac); }

/* Vue-unique: slide-down transition */
.slide-down-enter-active,
.slide-down-leave-active { transition: all .2s ease; overflow: hidden; }
.slide-down-enter-from,
.slide-down-leave-to { max-height: 0; opacity: 0; }
.slide-down-enter-to,
.slide-down-leave-from { max-height: 300px; opacity: 1; }

/* ── SSH Auth Grid ── */
.ssh-auth-grid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(16px, 1.5vw, 28px); align-items: start; }
@media (max-width: 900px) { .ssh-auth-grid { grid-template-columns: 1fr; } }

/* ── Key Cards ── */
.ssh-key-card { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: 12px 14px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }
.ssh-key-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ssh-key-type { font-size: .82rem; font-weight: 600; color: var(--t1); display: flex; align-items: center; gap: 6px; }
.ssh-key-fp { font-family: 'IBM Plex Mono', monospace; font-size: .75rem; color: var(--t2); word-break: break-all; }
.ssh-key-comment { font-size: .72rem; color: var(--t3); }
.ssh-add-key-card { background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--r); padding: 14px; margin-bottom: 8px; }
</style>
