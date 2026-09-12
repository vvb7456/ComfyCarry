<script setup lang="ts">
/**
 * SSHPage — SSH 单列页 (C05)。
 *
 * 结构: 页头 (停止/重启 + 设置) → Hero → 运行事实 → 连接命令 → 授权公钥 → 日志。
 * 合并原「服务 & 日志 / 公钥管理」两个 Tab: 公钥区始终可管理, 即使服务停止;
 * 连接命令区只在 sshd 运行时出现 (停止时状态与启动由 Hero 承担)。
 *
 * Hero 状态机:
 *   running(ok)        运行中, 主操作「复制连接命令」
 *   starting(warn+busy) 启动中, 无操作
 *   stopping(warn+busy) 停止中, 无操作
 *   restarting(warn+busy) 重启中, 无操作
 *   stopped(off)       已停止, 主操作「启动 SSH」
 *
 * 连接命令沿用原有 connectCmd 状态机 (先看 sshd 是否运行, 再取 /api/tunnel/status):
 *   有隧道 SSH 映射 → cloudflared ProxyCommand; 无映射 → 本机端口直连。
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ServiceHero from '@/components/ui/ServiceHero.vue'
import ListRow from '@/components/ui/ListRow.vue'
import LogPanel from '@/components/ui/LogPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SSHSettingsModal from '@/components/ssh/SSHSettingsModal.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useLogStream } from '@/composables/useLogStream'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useClipboard } from '@/composables/useClipboard'
import { apiErrorText, apiMessageText, type ApiErrorBody } from '@/utils/apiError'
import type { SSHKey, SSHStatus } from '@/types/ssh'

defineOptions({ name: 'SSHPage' })

const { t } = useI18n({ useScope: 'global' })
const { get, post, del } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()
const { copy } = useClipboard()

// ─── State ────────────────────────────────────────────────────────────────────

const status = ref<SSHStatus | null>(null)
const statusLoading = ref(true)
const connectCmd = ref<string | null>(null)
const connectCmdLoading = ref(true)
const connectCmdState = ref<'loading' | 'tunnel' | 'local' | 'not_running'>('loading')
const keys = ref<SSHKey[]>([])
const keysLoading = ref(false)
const deletingFp = ref<string | null>(null)

const actionLoading = ref<'start' | 'stop' | 'restart' | null>(null)
const acting = computed(() => actionLoading.value !== null)

const settingsOpen = ref(false)

// 添加公钥 (行内表单, 支持多行批量)
const showAddKey = ref(false)
const newKeysText = ref('')
const addingKey = ref(false)

// ─── 日志流 ───────────────────────────────────────────────────────────────────

// ── 日志流 ──
const logOpen = ref(true)
const { lines: logLines, status: logStatus, hasMore: logHasMore, loadingMore: logLoadingMore, prepending: logPrepending, onScroll: logOnScroll, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/ssh/logs',
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
  const data = await get<SSHStatus>('/api/ssh/status', { silent: true })
  if (data) {
    status.value = data
    statusLoading.value = false
  }
}

/** 本机直连命令: 无隧道时按本地容器场景生成, 端口回落 ssh 默认 22。 */
function localSshCmd(): string {
  return 'ssh root@localhost'
}

async function loadConnectCmd() {
  connectCmdLoading.value = true
  if (status.value && !status.value.running) {
    connectCmdLoading.value = false
    connectCmd.value = null
    connectCmdState.value = 'not_running'
    return
  }
  const data = await get<{ urls?: Record<string, string>; tunnel_mode?: string; public?: { urls?: Record<string, string> } }>('/api/tunnel/status', { silent: true })
  connectCmdLoading.value = false
  if (!data) {
    connectCmd.value = localSshCmd()
    connectCmdState.value = 'local'
    return
  }

  let sshHost: string | null = null

  // 自定义隧道地址 (按服务名索引)
  const urls = data.urls || {}
  for (const [name, url] of Object.entries(urls)) {
    if ((name as string).toLowerCase() === 'ssh') {
      sshHost = (url as string).replace(/^https?:\/\//, '').replace(/\/$/, '')
      break
    }
  }

  // 公共隧道地址
  if (!sshHost && data.tunnel_mode === 'public' && data.public?.urls) {
    const pubUrls = data.public.urls
    const sshUrl = pubUrls.ssh || pubUrls.SSH
    if (sshUrl) {
      sshHost = sshUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    }
  }

  if (sshHost) {
    connectCmd.value = `ssh -o ProxyCommand="cloudflared access ssh --hostname %h" root@${sshHost}`
    connectCmdState.value = 'tunnel'
  } else {
    connectCmd.value = localSshCmd()
    connectCmdState.value = 'local'
  }
}

/** 自动刷新: 仅在 running 发生变化时才重取连接命令, 避免每轮都打 tunnel 接口。 */
async function refreshStatus() {
  const prevRunning = status.value?.running
  await loadStatus()
  if (status.value?.running !== prevRunning) await loadConnectCmd()
}

async function loadKeys() {
  keysLoading.value = true
  const data = await get<{ keys: SSHKey[] }>('/api/ssh/keys')
  keysLoading.value = false
  if (data) keys.value = data.keys || []
}

// ─── Auto-refresh ─────────────────────────────────────────────────────────────

const refresher = useAutoRefresh(refreshStatus, 10000)

// ─── Service actions ──────────────────────────────────────────────────────────

async function sshAction(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' && !await confirm({
    title: t('ssh.confirm.stop.title'),
    message: t('ssh.confirm.stop.message'),
    confirmText: t('common.btn.stop'),
  })) return
  actionLoading.value = action
  const data = await post<ApiErrorBody & { ok?: boolean; running?: boolean; pid?: number | null }>(`/api/ssh/${action}`, {})
  actionLoading.value = null
  if (!data) return
  if (!data?.ok) {
    toast(apiErrorText(data, t('ssh.err.fallback')), 'error')
  } else {
    toast(apiMessageText(data, t('ssh.toast.action_ok')), 'success')
    await loadStatus()
    await loadConnectCmd()
  }
}

// ─── SSH keys ─────────────────────────────────────────────────────────────────

function keyBadges(key: SSHKey): string[] {
  return [key.type, key.source === 'env' ? t('ssh.keys.source_env') : t('ssh.keys.source_saved')]
}

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
    showAddKey.value = false
    await loadKeys()
  }
}

// 弹窗关闭 (按钮 / 遮罩 / Esc) 时清空输入
watch(showAddKey, (open) => {
  if (!open) newKeysText.value = ''
})

async function deleteKey(fingerprint: string) {
  if (!await confirm({
    title: t('ssh.confirm.delete_key.title'),
    message: t('ssh.confirm.delete_key.message'),
    confirmText: t('common.btn.delete'),
  })) return
  deletingFp.value = fingerprint
  const data = await del<ApiErrorBody & { ok?: boolean; keys?: SSHKey[] }>('/api/ssh/keys', { fingerprint })
  deletingFp.value = null
  if (!data) return
  if (!data?.ok) {
    toast(apiErrorText(data, t('ssh.err.fallback')), 'error')
  } else {
    toast(t('ssh.toast.key_deleted'), 'success')
    keys.value = keys.value.filter(k => k.fingerprint !== fingerprint)
  }
}

// ─── Hero 状态机 ──────────────────────────────────────────────────────────────

type HeroState = 'running' | 'starting' | 'stopping' | 'restarting' | 'stopped'

const heroState = computed<HeroState>(() => {
  if (actionLoading.value === 'start') return 'starting'
  if (actionLoading.value === 'restart') return 'restarting'
  if (actionLoading.value === 'stop') return 'stopping'
  return status.value?.running ? 'running' : 'stopped'
})

const heroTone = computed(() => ({
  running: 'ok',
  starting: 'warn',
  stopping: 'warn',
  restarting: 'warn',
  stopped: 'off',
}[heroState.value] as 'ok' | 'warn' | 'off'))

const heroBusy = computed(() => ['starting', 'stopping', 'restarting'].includes(heroState.value))
const heroTitle = computed(() => t(`ssh.hero.${heroState.value}.title`))
const heroSubtitle = computed(() => t(`ssh.hero.${heroState.value}.subtitle`))
const heroAction = computed<'copy' | 'start' | null>(() => {
  if (heroState.value === 'running') return 'copy'
  if (heroState.value === 'stopped') return 'start'
  return null
})

// ─── 运行事实 ─────────────────────────────────────────────────────────────────

const authFact = computed(() => {
  const s = status.value
  if (!s) return ''
  if (s.pw_follow) return t('ssh.facts.auth_follow')
  if (s.password_auth) return t('ssh.facts.auth_password')
  return t('ssh.facts.auth_key_only')
})

const factsList = computed<{ label: string; value: string }[]>(() => {
  const s = status.value
  if (!s) return []
  // 配置事实停机仍显示, 运行期字段随状态显示
  const out: { label: string; value: string }[] = [
    { label: t('ssh.facts.port'), value: String(s.port) },
    { label: t('ssh.facts.auth'), value: authFact.value },
    { label: t('ssh.facts.connections'), value: String(s.active_connections) },
  ]
  if (s.running && (connectCmdState.value === 'tunnel' || connectCmdState.value === 'local')) {
    out.push({
      label: t('ssh.facts.tunnel'),
      value: connectCmdState.value === 'tunnel' ? t('ssh.facts.tunnel_on') : t('ssh.facts.tunnel_off'),
    })
  }
  return out
})

// ─── Copy ─────────────────────────────────────────────────────────────────────

function copyCmd() {
  if (!connectCmd.value) return
  copy(connectCmd.value)
}

function onSettingsChanged() {
  void loadStatus()
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  void loadStatus().then(loadConnectCmd)
  void loadKeys()
  logStart()
  refresher.start({ immediate: false })
})

onUnmounted(() => {
  logStop()
  refresher.stop()
})
</script>

<template>
  <div class="page-body">
    <div class="page-header-row">
      <div class="page-title-wrap">
        <h1 class="page-title">{{ t('ssh.title') }}</h1>
      </div>
      <span class="page-header-row__spacer" />
      <span v-if="status?.running" class="page-actions">
        <BaseButton size="sm" :loading="actionLoading === 'stop'" :disabled="acting" @click="sshAction('stop')">
          <MsIcon name="stop" /> {{ t('common.btn.stop') }}
        </BaseButton>
        <BaseButton size="sm" :loading="actionLoading === 'restart'" :disabled="acting" @click="sshAction('restart')">
          <MsIcon name="restart_alt" /> {{ t('common.btn.restart') }}
        </BaseButton>
      </span>
      <BaseButton variant="ghost" size="sm" :aria-label="t('ssh.settings.title')" @click="settingsOpen = true">
        <MsIcon name="settings" /> {{ t('common.btn.settings') }}
      </BaseButton>
    </div>

    <div class="page-col">
      <LoadingCenter v-if="statusLoading && !status" style="padding:60px 0" />

      <template v-else-if="status">
        <!-- Hero + 运行事实 -->
        <ServiceHero
          icon="key"
          :title="heroTitle"
          :subtitle="heroSubtitle"
          :tone="heroTone"
          :busy="heroBusy"
        >
          <template v-if="heroAction" #actions>
            <BaseButton v-if="heroAction === 'copy'" variant="primary" @click="copyCmd">
              <MsIcon name="content_copy" /> {{ t('ssh.hero.action.copy') }}
            </BaseButton>
            <BaseButton
              v-else
              variant="primary"
              :loading="actionLoading === 'start'"
              :disabled="acting"
              @click="sshAction('start')"
            >
              {{ t('ssh.hero.action.start') }}
            </BaseButton>
          </template>
          <template v-if="factsList.length" #facts>
            <span v-for="fact in factsList" :key="fact.label">{{ fact.label }}<b>{{ fact.value }}</b></span>
          </template>
        </ServiceHero>

        <!-- 连接命令 (仅运行时) -->
        <section v-if="status.running" class="ssh-block">
          <SectionHeader icon="link">{{ t('ssh.connect.title') }}</SectionHeader>
          <div class="connect-card">
            <span v-if="connectCmdLoading" class="connect-loading">{{ t('ssh.connect.loading') }}</span>
            <template v-else-if="connectCmd">
              <div class="connect-row">
                <code class="connect-code">{{ connectCmd }}</code>
                <BaseButton variant="ghost" size="sm" icon-only :aria-label="t('ssh.connect.copy_cmd')" @click="copyCmd">
                  <MsIcon name="content_copy" />
                </BaseButton>
              </div>
              <div v-if="connectCmdState === 'tunnel'" class="connect-hint">
                {{ t('ssh.connect.need_cloudflared') }}
                <a class="link" href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" target="_blank" rel="noopener">cloudflared<MsIcon name="open_in_new" /></a>
              </div>
              <div v-else class="connect-hint">{{ t('ssh.connect.local_hint') }}</div>
            </template>
          </div>
        </section>

        <!-- 授权公钥 (停机仍可管理) -->
        <section class="ssh-block">
          <SectionHeader icon="key">
            {{ t('ssh.keys.title') }}
            <span class="ssh-count">{{ keys.length }}</span>
            <template #actions>
              <BaseButton size="sm" @click="showAddKey = true">
                <MsIcon name="add" /> {{ t('ssh.keys.add_btn') }}
              </BaseButton>
            </template>
          </SectionHeader>

          <LoadingCenter v-if="keysLoading && !keys.length" style="padding:24px 0" />
          <ul v-else-if="keys.length" class="list-plain ssh-keys">
            <ListRow
              v-for="key in keys"
              :key="key.fingerprint"
              icon="fingerprint"
              :title="key.comment || t('ssh.keys.unnamed')"
              :badges="keyBadges(key)"
              :facts="[key.fingerprint]"
            >
              <template #actions>
                <BaseButton
                  variant="danger"
                  size="sm"
                  icon-only
                  :aria-label="t('ssh.keys.delete_btn')"
                  :loading="deletingFp === key.fingerprint"
                  @click="deleteKey(key.fingerprint)"
                >
                  <MsIcon name="delete" />
                </BaseButton>
              </template>
            </ListRow>
          </ul>
          <EmptyState v-else icon="key" :message="t('ssh.keys.empty')" density="compact" />
        </section>

        <!-- 日志 (默认展开, 折叠标题与分区标题同构) -->
        <section class="ssh-block">
          <SectionHeader icon="terminal" collapsible v-model:expanded="logOpen">
            {{ t('ssh.log.title') }}
          </SectionHeader>
          <LogPanel
            v-show="logOpen"
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

    <!-- 页内设置: SSH 密码跟随 -->
    <SSHSettingsModal v-model="settingsOpen" @changed="onSettingsChanged" />

    <!-- 添加公钥: 页脚主操作 -->
    <BaseModal v-model="showAddKey" :title="t('ssh.keys.add_btn')" size="md">
      <textarea
        v-model="newKeysText"
        class="form-textarea form-textarea--mono"
        style="height:120px;resize:vertical"
        :placeholder="t('ssh.keys.add_placeholder')"
      />
      <template #footer>
        <BaseButton @click="showAddKey = false">{{ t('common.btn.cancel') }}</BaseButton>
        <BaseButton variant="primary" :disabled="!newKeysText.trim()" :loading="addingKey" @click="addKey">
          {{ t('ssh.keys.add_submit') }}
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
/* 分区节奏: Hero → 连接命令 → 授权公钥 → 日志 (--section-gap, 与总览一致) */
.ssh-block {
  margin-top: var(--section-gap);
}

.ssh-count {
  margin-left: 6px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--t3);
}

/* ── 连接命令 ── */
.connect-card {
  padding: 14px 16px;
  border: 1px solid var(--bd);
  border-radius: var(--r);
  background: var(--bg2);
}

.connect-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.connect-code {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border-radius: var(--rs);
  background: var(--bg);
  color: var(--t1);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow-x: auto;
  white-space: nowrap;
}

.connect-hint {
  margin-top: 8px;
  font-size: var(--text-xs);
  color: var(--t3);
}

.connect-hint a {
  color: var(--ac);
  text-decoration: none;
}

.connect-hint a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.connect-loading {
  font-size: var(--text-sm);
  color: var(--t3);
}

/* ── 公钥 ── 指纹用等宽 (ListRow facts 默认 tabular, 这里收紧为 mono) */
.ssh-keys :deep(.list-row__facts) {
  font-family: var(--font-mono);
}
</style>
