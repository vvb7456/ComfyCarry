<script setup lang="ts">
/**
 * 设置页面板模块 — 两个即时动作模块:
 *   1. 登录与认证: 修改登录密码 (modal) / API Key (只读+重生成)
 *   2. 配置管理: 导出配置 / 导入配置
 * SSH 密码跟随已迁入 SSH 页页内设置 (C05), 生成域已迁回各功能页。
 * onMounted 加载 /api/settings; API Key 行失败就地重试。
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsModule from '@/components/settings/SettingsModule.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SecretInput from '@/components/ui/SecretInput.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FormField from '@/components/form/FormField.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { apiErrorText, apiMessageText, type ApiErrorBody } from '@/utils/apiError'
import { errorMessage } from '@/utils/errorMessage'

defineOptions({ name: 'SettingsSectionPanel' })

const { t } = useI18n({ useScope: 'global' })
const { get, post } = useApiFetch()
const { toast } = useToast()
const { confirm } = useConfirm()

const pwModalOpen = ref(false)
const pwCurrent = ref('')
const pwNew = ref('')
const pwConfirm = ref('')
const pwSubmitting = ref(false)

const apiKey = ref('')
const apiKeyRevealed = ref(false)
const regenLoading = ref(false)
const apiKeyLoading = ref(true)
const apiKeyError = ref(false)

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
  if (!await confirm({
    title: t('settings.confirm.regenerate_key.title'),
    message: t('settings.confirm.regenerate_key.message'),
    confirmText: t('settings.confirm.regenerate_key.button'),
  })) return
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
  } catch (e: unknown) {
    toast(`${t('settings.config.export_failed')}: ${errorMessage(e)}`, 'error')
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

    // 含工作区状态的导入会替换生成页配置, 而当前可能正有任务在跑 (其工作流图
    // 由旧配置编译)。故确认文案必须说清后果, 确认后先停止再导入。
    const hasState = !!config.generate_state
    const confirmed = hasState
      ? await confirm({
          // title 与普通导入共用一份 (同一个动作, 不该有两套说法)
          title: t('settings.confirm.import_config.title'),
          message: t('settings.confirm.import_state.message'),
          confirmText: t('settings.confirm.import_state.button'),
          variant: 'danger',
        })
      : await confirm({
          title: t('settings.confirm.import_config.title'),
          message: t('settings.confirm.import_config.message', { date: config._exported_at || t('settings.config.unknown_date') }),
          confirmText: t('settings.confirm.import_config.button'),
          variant: 'danger',
        })
    if (!confirmed) return

    if (hasState) {
      // 停止当前任务并清空队列: 队列里的 pending 由旧配置编译, 不应继续跑。
      // interrupt 端点内部对后台会话会走完整的 stop_session (置 idle +
      // interrupt + 清队列); 非后台模式下原生 interrupt 不清队列, 故显式补一次。
      await post('/api/comfyui/interrupt', {}, { silent: true })
      await post('/api/comfyui/queue/clear', {}, { silent: true })
    }

    const data = await post<{ message?: string }>('/api/settings/import-config', JSON.parse(text))
    if (!data) return
    toast(apiMessageText(data), 'success')

    // 导入后无条件重载并回到总览。不就地复用当前页面:
    // 导入替换了大量设置 (密码/密钥/同步/Tunnel/工作区状态), 各页面持有的都是
    // 旧值, 逐个通知既易漏又会残留; 整页重载最干净, 也顺带清掉生成页的执行态
    // 与预览态。工作区状态那条路径另有服务端「需重新装载」守卫兜底, 防止旧
    // 标签页的自动保存把导入结果覆盖回去。
    // 用 '/' 而非 '/#/dashboard': 根路径对路由模式不敏感 (hash 与 history 都落到
    // 首页路由, 且 '/' 本就重定向到 /dashboard), 不会因将来改模式而失效。
    window.location.href = '/'
  } catch (e: unknown) {
    toast(`${t('settings.config.import_failed')}: ${errorMessage(e)}`, 'error')
  }
}

onMounted(() => {
  void loadSettings().finally(() => { apiKeyLoading.value = false })
})
</script>

<template>
    <SettingsModule :title="t('settings.domains.auth')">
      <div v-if="apiKeyError" class="settings-lines">
        <EmptyState icon="error_outline" :message="t('common.load_failed')">
          <BaseButton size="sm" @click="loadSettings">{{ t('common.btn.retry') }}</BaseButton>
        </EmptyState>
      </div>

      <div v-else class="settings-lines">
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.password.row_label') }}</div>
            <div class="settings-row__desc">{{ t('settings.password.row_desc') }}</div>
          </div>
          <div class="settings-row__control settings-row__control--auto">
            <BaseButton size="sm" @click="pwModalOpen = true">
              {{ t('settings.password.change_btn') }}
            </BaseButton>
          </div>
        </div>

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

    <SettingsModule :title="t('settings.domains.configmgmt')">
      <div class="settings-lines">
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.config.export_title') }}</div>
            <div class="settings-row__desc">{{ t('settings.config.export_desc') }}</div>
          </div>
          <div class="settings-row__control settings-row__control--auto">
            <BaseButton size="sm" @click="exportConfig">
              <MsIcon name="download" /> {{ t('settings.config.export_btn') }}
            </BaseButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row__text">
            <div class="settings-row__label">{{ t('settings.config.import_title') }}</div>
            <div class="settings-row__desc">{{ t('settings.config.import_desc') }}</div>
          </div>
          <div class="settings-row__control settings-row__control--auto">
            <BaseButton size="sm" @click="($refs.importFileInput as HTMLInputElement)?.click()">
              <MsIcon name="upload" /> {{ t('settings.config.import_btn') }}
            </BaseButton>
          </div>
          <input ref="importFileInput" type="file" accept=".json" @change="importConfig" style="display:none" />
        </div>
      </div>
  </SettingsModule>

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
        <template #default="{ id, describedby, invalid }">
          <SecretInput
            :id="id"
            v-model="pwCurrent"
            is-password
            :placeholder="t('settings.password.current_placeholder')"
            autocomplete="current-password"
            input-class="form-input"
            :aria-describedby="describedby"
            :aria-invalid="invalid"
          />
        </template>
      </FormField>
      <FormField :label="t('settings.password.new')">
        <template #default="{ id, describedby, invalid }">
          <SecretInput
            :id="id"
            v-model="pwNew"
            is-password
            :placeholder="t('settings.password.new_placeholder')"
            autocomplete="new-password"
            input-class="form-input"
            :aria-describedby="describedby"
            :aria-invalid="invalid"
          />
        </template>
      </FormField>
      <FormField :label="t('settings.password.confirm')">
        <template #default="{ id, describedby, invalid }">
          <SecretInput
            :id="id"
            v-model="pwConfirm"
            is-password
            :placeholder="t('settings.password.confirm_placeholder')"
            autocomplete="new-password"
            input-class="form-input"
            :aria-describedby="describedby"
            :aria-invalid="invalid"
          />
        </template>
      </FormField>
    </form>
    <template #footer>
      <BaseButton variant="primary" :loading="pwSubmitting" @click="changePassword">
        {{ t('settings.password.update_btn') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.mono-input {
  font-family: var(--font-mono);
  font-size: .82rem;
  letter-spacing: .5px;
  padding-right: 72px;
}
</style>
