<script setup lang="ts">
/**
 * 设置分区: 面板 — 两个即时动作模块 (单页 v3: L2 模块 + 行, 无草稿态无守卫):
 *   1. 登录与认证: 修改登录密码 (modal) / SSH 使用面板密码 (开关) / API Key (只读+重生成)
 *   2. 配置管理: 导出配置 / 导入配置
 * 重新初始化已归位 About 区 (SettingsAboutFooter, 与原版一致)。
 * onMounted 加载 /api/settings 与 /api/ssh/status (SSH 开关初始态取 pw_follow,
 * 加载中禁用); API Key 行失败就地重试, SSH 开关失败同。
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsModule from '@/components/settings/SettingsModule.vue'
import SettingsGroupToggleRow from '@/components/settings/SettingsGroupToggleRow.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FormField from '@/components/form/FormField.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText, apiMessageText, type ApiErrorBody } from '@/utils/apiError'
import type { SSHStatus } from '@/types/ssh'

defineOptions({ name: 'SettingsSectionPanel' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

// ─── Password state (modal) ──────────────────────────────────────────────────

const pwModalOpen = ref(false)
const pwCurrent = ref('')
const pwNew = ref('')
const pwConfirm = ref('')
const pwSubmitting = ref(false)

function openPwModal() {
  pwCurrent.value = ''
  pwNew.value = ''
  pwConfirm.value = ''
  pwModalOpen.value = true
}

// ─── SSH 密码跟随 (即时开关, 无 dirty; spec §5.1) ────────────────────────────

const sshPwFollow = ref(false)
const sshPwFollowLoading = ref(true)
const sshPwFollowError = ref(false)
const sshPwFollowSubmitting = ref(false)

async function loadSshFollow() {
  sshPwFollowError.value = false
  const data = await get<SSHStatus>('/api/ssh/status')
  if (!data) {
    sshPwFollowError.value = true
    sshPwFollowLoading.value = false
    return
  }
  sshPwFollow.value = !!data.pw_follow
  sshPwFollowLoading.value = false
}

type PwFollowResponse = ApiErrorBody & { ok?: boolean; password_auth_enabled?: boolean }

/** password-follow 专用请求。不走 useApiFetch: 409 lockout_risk 要按状态码
 *  分支进确认框, 且错误提示由本组件按分支处理, 避免 useApiFetch 的自动
 *  toast 在确认流程里双重弹出 (封装方式同 OAuthWizard 的 oauthFetch)。 */
async function pwFollowFetch(body: { enabled: boolean; force?: boolean }) {
  try {
    const res = await fetch('/api/ssh/password-follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401) {
      window.location.href = '/login'
      return { status: 401, data: null as PwFollowResponse | null }
    }
    let data: PwFollowResponse | null = null
    try { data = await res.json() as PwFollowResponse } catch { /* 空响应体 */ }
    return { status: res.status, data }
  } catch {
    return { status: 0, data: null as PwFollowResponse | null }
  }
}

/** 应用开关。v-model 已乐观更新, 失败/取消在这里回弹。 */
async function applyPwFollow(enabled: boolean, force = false) {
  sshPwFollowSubmitting.value = true
  const { status, data } = await pwFollowFetch({ enabled, force })
  sshPwFollowSubmitting.value = false

  // 无公钥锁死防护: 后端 409 未做任何变更 → danger 确认后 force 重发, 取消回弹
  if (status === 409 && data?.error_key === 'ssh.err.lockout_risk') {
    const go = await confirm({
      title: t('settings.ssh_password.lockout_title'),
      message: t('settings.ssh_password.lockout_confirm'),
      variant: 'danger',
      confirmText: t('settings.ssh_password.lockout_btn'),
    })
    if (go) { await applyPwFollow(false, true); return }
    sshPwFollow.value = true
    return
  }

  if (status !== 200 || !data?.ok) {
    // 后端 error_key (ssh.err.*) 已接 i18n, apiErrorText 翻译; 网络层失败落回兜底
    toast(apiErrorText(data, t('ssh.err.fallback')), 'error')
    sshPwFollow.value = !enabled
    return
  }
  sshPwFollow.value = data.password_auth_enabled ?? enabled
  toast(t(enabled ? 'settings.ssh_password.enabled_toast' : 'settings.ssh_password.disabled_toast'), 'success')
}

// ─── API Key state ───────────────────────────────────────────────────────────

const apiKey = ref('')
const apiKeyRevealed = ref(false)
const regenLoading = ref(false)
const apiKeyLoading = ref(true)
const apiKeyError = ref(false)

// ─── Load / actions ──────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await get<{ api_key?: string }>('/api/settings')
  if (!data) {
    apiKeyError.value = true
    return
  }
  apiKeyError.value = false
  if (data.api_key) apiKey.value = data.api_key
}

async function changePassword() {
  if (!pwCurrent.value) { toast(t('settings.password.err_current'), 'error'); return }
  if (!pwNew.value) { toast(t('settings.password.err_new'), 'error'); return }
  if (pwNew.value.length < 4) { toast(t('settings.password.err_min_length'), 'error'); return }
  if (pwNew.value !== pwConfirm.value) { toast(t('settings.password.err_mismatch'), 'error'); return }
  pwSubmitting.value = true
  const data = await post<ApiErrorBody & { message?: string; error?: string }>('/api/settings/password', {
    current: pwCurrent.value,
    new: pwNew.value,
  })
  pwSubmitting.value = false
  if (!data) return
  if (data.error_key || data.error) {
    toast(apiErrorText(data, t('settings.password.err_current')), 'error')
  } else {
    toast(apiMessageText(data), 'success')
    pwModalOpen.value = false
  }
}

async function regenerateApiKey() {
  if (!await confirm({ message: t('settings.api_key.regenerate_confirm') })) return
  regenLoading.value = true
  const data = await post<{ ok?: boolean; api_key?: string; error?: string }>('/api/settings/api-key', {})
  regenLoading.value = false
  if (!data) return
  if (data.ok && data.api_key) {
    apiKey.value = data.api_key
    apiKeyRevealed.value = true
    toast(t('settings.api_key.regenerated'), 'success')
  } else {
    toast(apiErrorText(data, t('settings.api_key.regenerate_failed')), 'error')
  }
}

async function exportConfig() {
  try {
    const res = await fetch('/api/settings/export-config')
    if (!res.ok) { toast(t('settings.config.export_failed'), 'error'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `comfycarry-config-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast(t('settings.config.exported'), 'success')
  } catch (e: any) {
    toast(`${t('settings.config.export_failed')}: ${e.message}`, 'error')
  }
}

async function importConfig(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(event.target as HTMLInputElement).value = ''
  try {
    const text = await file.text()
    const config = JSON.parse(text)
    if (!config._version) { toast(t('settings.config.invalid_format'), 'error'); return }
    if (!await confirm({ message: t('settings.config.import_confirm', { date: config._exported_at || t('settings.config.unknown_date') }) })) return
    const data = await post<{ message?: string }>('/api/settings/import-config', JSON.parse(text))
    if (!data) return
    toast(apiMessageText(data), 'success')
    await loadSettings()
  } catch (e: any) {
    toast(`${t('settings.config.import_failed')}: ${e.message}`, 'error')
  }
}

onMounted(() => {
  void loadSettings().finally(() => { apiKeyLoading.value = false })
  void loadSshFollow()
})
</script>

<template>
  <!-- 模块 1: 登录与认证 (即时动作, 无 dirty) -->
    <SettingsModule id="settings-focus-password" :title="t('settings.domains.auth')">
      <div v-if="apiKeyError" class="settings-lines">
        <EmptyState icon="cloud_off" :message="t('common.load_failed')">
          <BaseButton size="sm" @click="loadSettings">{{ t('common.btn.retry') }}</BaseButton>
        </EmptyState>
      </div>

      <div v-else class="settings-lines">
        <!-- 修改登录密码 (modal 即时动作) -->
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.password.row_label') }}</div>
            <div class="settings-row__desc">{{ t('settings.password.row_desc') }}</div>
          </div>
          <div class="settings-row__control">
            <BaseButton size="sm" @click="pwModalOpen = true">
              {{ t('settings.password.change_btn') }}
            </BaseButton>
          </div>
        </div>

        <!-- SSH 使用面板密码 (即时开关, spec §5.1; lockout 走 force 流程) -->
        <div v-if="sshPwFollowError" class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.ssh_password.label') }}</div>
          </div>
          <div class="settings-row__control">
            <BaseButton size="sm" @click="loadSshFollow">{{ t('common.btn.retry') }}</BaseButton>
          </div>
        </div>
        <SettingsGroupToggleRow
          v-else
          :label="t('settings.ssh_password.label')"
          :desc="t('settings.ssh_password.desc')"
          :help="t('settings.ssh_password.help')"
          :model-value="sshPwFollow"
          :disabled="sshPwFollowLoading || sshPwFollowSubmitting"
          @update:model-value="applyPwFollow"
        />

        <!-- API Key (只读 + 重新生成) -->
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">
              {{ t('settings.api_key.title') }}
              <HelpTip :text="t('settings.api_key.help')" />
            </div>
            <div class="settings-row__desc">{{ t('settings.api_key.row_desc') }}</div>
          </div>
          <div class="settings-row__control settings-row__control--stack">
            <div class="settings-row__control-row">
              <SecretInput
                v-if="!apiKeyLoading"
                v-model="apiKey"
                v-model:revealed="apiKeyRevealed"
                readonly
                copyable
                input-class="form-input mono-input"
              />
              <div v-else class="settings-skeleton__line settings-skeleton__line--control" />
              <BaseButton
                size="sm"
                :loading="regenLoading"
                :title="t('settings.api_key.regenerate')"
                @click="regenerateApiKey"
              >
                <MsIcon name="autorenew" />
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </SettingsModule>

    <!-- 模块 2: 配置管理 (即时动作, 无 dirty) -->
    <SettingsModule id="settings-focus-config" :title="t('settings.domains.configmgmt')">
      <div class="settings-lines">
        <div class="settings-action">
          <div class="settings-action__text">
            <div class="settings-action__title">{{ t('settings.config.export_title') }}</div>
            <div class="settings-row__desc">{{ t('settings.config.export_desc') }}</div>
          </div>
          <BaseButton size="sm" @click="exportConfig">
            <MsIcon name="download" /> {{ t('settings.config.export_btn') }}
          </BaseButton>
        </div>
        <div class="settings-action">
          <div class="settings-action__text">
            <div class="settings-action__title">{{ t('settings.config.import_title') }}</div>
            <div class="settings-row__desc">{{ t('settings.config.import_desc') }}</div>
          </div>
          <BaseButton size="sm" @click="($refs.importFileInput as HTMLInputElement)?.click()">
            <MsIcon name="upload" /> {{ t('settings.config.import_btn') }}
          </BaseButton>
          <input ref="importFileInput" type="file" accept=".json" @change="importConfig" style="display:none" />
        </div>
      </div>
  </SettingsModule>

  <!-- 改密 modal -->
  <BaseModal v-model="pwModalOpen" :title="t('settings.password.title')" icon="lock">
    <form @submit.prevent="changePassword" autocomplete="off">
      <input
        type="text"
        name="username"
        autocomplete="username"
        tabindex="-1"
        aria-hidden="true"
        style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"
      />
      <FormField :label="t('settings.password.current')">
        <SecretInput
          v-model="pwCurrent"
          is-password
          :placeholder="t('settings.password.current_placeholder')"
          autocomplete="current-password"
          input-class="form-input"
        />
      </FormField>
      <FormField :label="t('settings.password.new')">
        <SecretInput
          v-model="pwNew"
          is-password
          :placeholder="t('settings.password.new_placeholder')"
          autocomplete="new-password"
          input-class="form-input"
        />
      </FormField>
      <FormField :label="t('settings.password.confirm')">
        <SecretInput
          v-model="pwConfirm"
          is-password
          :placeholder="t('settings.password.confirm_placeholder')"
          autocomplete="new-password"
          input-class="form-input"
        />
      </FormField>
    </form>
    <template #footer>
      <BaseButton variant="primary" size="sm" :loading="pwSubmitting" @click="changePassword">
        {{ t('settings.password.update_btn') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
/* Vue-unique: mono variant for API key display */
.mono-input {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .82rem;
  letter-spacing: .5px;
  padding-right: 72px;
}
</style>
